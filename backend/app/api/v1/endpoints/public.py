"""Public storefront and platform commercial endpoints."""

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import ProgrammingError

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import require_superadmin
from app.core.security import create_password_reset_token, decode_email_verified_token, hash_password
from app.integrations.email.email_service import email_service
from app.models.business import (
    Branch,
    ClassStatus,
    GymClass,
    Membership,
    MembershipStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Plan,
    PlanDuration,
    PromoCode,
)
from app.models.platform import PlatformLead, TenantPaymentProviderAccount
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.business import GymClassResponse, PaginatedResponse, PlanResponse
from app.schemas.platform import (
    PaymentProviderAccountResponse,
    PlatformLeadCreateRequest,
    PlatformLeadResponse,
    PlatformLeadUpdateRequest,
    PublicCheckoutSessionRequest,
    PublicCheckoutSessionResponse,
    TenantPublicProfileResponse,
)
from app.integrations.payments.fintoc_service import fintoc_service
from app.services.branding_service import DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR, coerce_brand_color
from app.services.custom_domain_service import extract_hostname, normalize_custom_domain
from app.services.public_checkout_service import build_public_checkout_urls, build_storefront_return_urls
from app.services.billing_service import activate_tenant_subscription
from app.services.saas_plan_service import definition_from_record, default_saas_plan_definitions
from app.services.support_contact_service import resolve_tenant_support_contacts
from app.models.platform import SaaSPlan

public_router = APIRouter(prefix="/public", tags=["Public"])
platform_router = APIRouter(prefix="/platform", tags=["Platform CRM"])
settings = get_settings()


def _loads_dict(raw_value: str | None) -> dict:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _lead_payload(lead: PlatformLead) -> PlatformLeadResponse:
    return PlatformLeadResponse(
        id=lead.id,
        tenant_id=lead.tenant_id,
        owner_name=lead.owner_name,
        gym_name=lead.gym_name,
        email=lead.email,
        phone=lead.phone,
        request_type=lead.request_type,
        source=lead.source,
        status=lead.status,
        desired_plan_key=lead.desired_plan_key,
        notes=lead.notes,
        metadata=_loads_dict(lead.metadata_json),
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


def _is_missing_table(error: Exception, table_name: str) -> bool:
    message = str(error).lower()
    return "does not exist" in message and table_name.lower() in message


async def _get_public_tenant_or_404(db: AsyncSession, slug: str) -> Tenant:
    tenant = (
        await db.execute(select(Tenant).where(Tenant.slug == slug, Tenant.is_active == True))
    ).scalars().first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Vitrina pública no encontrada")
    return tenant


def _request_hostname(request: Request) -> str | None:
    forwarded_host = request.headers.get("x-forwarded-host")
    raw_host = (forwarded_host or request.headers.get("host") or "").split(",")[0].strip()
    if not raw_host:
        return None
    try:
        return normalize_custom_domain(raw_host)
    except ValueError:
        return extract_hostname(raw_host)


async def _get_public_tenant_by_custom_domain_or_404(db: AsyncSession, request: Request) -> Tenant:
    hostname = _request_hostname(request)
    if not hostname:
        raise HTTPException(status_code=404, detail="Vitrina pública no encontrada")

    reserved_hosts = {
        host
        for host in {
            extract_hostname(settings.FRONTEND_URL),
            extract_hostname(settings.public_app_url),
            "localhost",
            "127.0.0.1",
        }
        if host
    }
    if hostname in reserved_hosts:
        raise HTTPException(status_code=404, detail="Vitrina pública no encontrada")

    tenant = (
        await db.execute(
            select(Tenant).where(
                func.lower(Tenant.custom_domain) == hostname,
                Tenant.is_active == True,
            )
        )
    ).scalars().first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Vitrina pública no encontrada")
    return tenant


async def _get_default_payment_account(db: AsyncSession, tenant_id: UUID) -> TenantPaymentProviderAccount | None:
    result = await db.execute(
        select(TenantPaymentProviderAccount)
        .where(
            TenantPaymentProviderAccount.tenant_id == tenant_id,
            TenantPaymentProviderAccount.status == "connected",
        )
        .order_by(TenantPaymentProviderAccount.is_default.desc(), TenantPaymentProviderAccount.created_at.asc())
    )
    return result.scalars().first()


async def _get_existing_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def _ensure_checkout_email_can_purchase(db: AsyncSession, tenant: Tenant, customer_email: str) -> None:
    existing_user = await _get_existing_user_by_email(db, customer_email)
    if existing_user and existing_user.tenant_id and existing_user.tenant_id != tenant.id:
        other_tenant = await db.get(Tenant, existing_user.tenant_id)
        tenant_label = other_tenant.name if other_tenant else "otro tenant"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"El correo {customer_email} ya pertenece a una cuenta en {tenant_label}. "
                "Usa otro correo para comprar este plan o migra esa cuenta primero."
            ),
        )


def _split_customer_name(full_name: str) -> tuple[str, str]:
    cleaned = " ".join((full_name or "").split())
    if not cleaned:
        return "Cliente", "Nexo"
    if " " not in cleaned:
        return cleaned, "Cliente"
    first_name, last_name = cleaned.split(" ", 1)
    return first_name, last_name


def _parse_optional_date(raw_value: str | None) -> date | None:
    if not raw_value:
        return None
    try:
        return date.fromisoformat(raw_value)
    except ValueError:
        return None


def _event_data_object(event: dict) -> dict:
    data = event.get("data", {})
    nested_object = data.get("object") if isinstance(data, dict) else None
    if isinstance(nested_object, dict):
        return nested_object
    return data if isinstance(data, dict) else {}


def _membership_expiration_from(plan: Plan, anchor_date: date) -> date | None:
    if plan.duration_days:
        return anchor_date + timedelta(days=plan.duration_days)

    duration_type = plan.duration_type.value if hasattr(plan.duration_type, "value") else str(plan.duration_type)
    if duration_type == PlanDuration.MONTHLY.value:
        return anchor_date + timedelta(days=30)
    if duration_type == PlanDuration.ANNUAL.value:
        return anchor_date + timedelta(days=365)
    if duration_type == PlanDuration.PERPETUAL.value:
        return None
    return None


def _resolve_membership_dates(plan: Plan, membership: Membership | None, today: date) -> tuple[date, date | None]:
    if (
        membership
        and membership.status == MembershipStatus.ACTIVE
        and membership.plan_id == plan.id
        and membership.expires_at
        and membership.expires_at >= today
    ):
        starts_at = membership.starts_at
        expires_at = _membership_expiration_from(plan, membership.expires_at)
        return starts_at, expires_at

    return today, _membership_expiration_from(plan, today)


def _build_checkout_reset_url(user_id: UUID) -> str:
    token = create_password_reset_token(str(user_id))
    return f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={token}"


async def _build_tenant_public_profile_response(
    db: AsyncSession,
    tenant: Tenant,
) -> TenantPublicProfileResponse:
    features = _loads_dict(tenant.features)
    support_email, support_phone = await resolve_tenant_support_contacts(db, tenant)
    try:
        custom_domain = normalize_custom_domain(tenant.custom_domain)
    except ValueError:
        custom_domain = tenant.custom_domain
    branches = (
        await db.execute(select(Branch).where(Branch.tenant_id == tenant.id, Branch.is_active == True))
    ).scalars().all()
    plans = (
        await db.execute(
            select(Plan)
            .where(Plan.tenant_id == tenant.id, Plan.is_active == True, Plan.deleted_at == None)
            .order_by(Plan.is_featured.desc(), Plan.sort_order.asc(), Plan.price.asc())
            .limit(6)
        )
    ).scalars().all()
    upcoming_classes = (
        await db.execute(
            select(GymClass)
            .where(
                GymClass.tenant_id == tenant.id,
                GymClass.start_time >= datetime.now(timezone.utc),
                GymClass.status == ClassStatus.SCHEDULED,
            )
            .order_by(GymClass.start_time.asc())
            .limit(6)
        )
    ).scalars().all()
    default_account = await _get_default_payment_account(db, tenant.id)
    primary_color = coerce_brand_color(tenant.primary_color, DEFAULT_PRIMARY_COLOR)
    secondary_color = coerce_brand_color(tenant.secondary_color, DEFAULT_SECONDARY_COLOR)

    return TenantPublicProfileResponse(
        tenant_id=tenant.id,
        tenant_slug=tenant.slug,
        tenant_name=tenant.name,
        city=tenant.city,
        address=tenant.address,
        phone=tenant.phone,
        email=tenant.email,
        branding={
            "logo_url": tenant.logo_url,
            "primary_color": primary_color,
            "secondary_color": secondary_color,
            "custom_domain": custom_domain,
            "support_email": support_email,
            "support_phone": support_phone,
            "marketplace_headline": str(features.get("marketplace_headline", f"Compra tu plan en {tenant.name}")),
            "marketplace_description": str(features.get("marketplace_description", "Reserva clases, compra tu plan y administra tu acceso desde un solo lugar.")),
        },
        branches=[
            {
                "id": str(branch.id),
                "name": branch.name,
                "city": branch.city,
                "address": branch.address,
                "phone": branch.phone,
            }
            for branch in branches
        ],
        featured_plans=[
            {
                "id": str(plan.id),
                "name": plan.name,
                "description": plan.description,
                "price": float(plan.price),
                "currency": plan.currency,
                "duration_type": plan.duration_type.value if hasattr(plan.duration_type, "value") else str(plan.duration_type),
                "duration_days": plan.duration_days,
                "is_featured": plan.is_featured,
                "discount_pct": float(plan.discount_pct) if plan.discount_pct is not None else None,
            }
            for plan in plans
        ],
        upcoming_classes=[
            {
                "id": str(gym_class.id),
                "name": gym_class.name,
                "class_type": gym_class.class_type,
                "start_time": gym_class.start_time.isoformat(),
                "modality": gym_class.modality.value if hasattr(gym_class.modality, "value") else str(gym_class.modality),
                "capacity": gym_class.max_capacity,
                "bookings": gym_class.current_bookings,
            }
            for gym_class in upcoming_classes
        ],
        checkout_enabled=bool(features.get("public_checkout_enabled", True) and default_account),
    )


async def _find_or_create_checkout_user(
    db: AsyncSession,
    *,
    tenant: Tenant,
    customer_email: str,
    customer_name: str,
    customer_phone: str | None,
    customer_date_of_birth: date | None = None,
    customer_password: str | None = None,
) -> tuple[User, bool]:
    result = await db.execute(select(User).where(User.email == customer_email))
    user = result.scalar_one_or_none()
    if user:
        if user.tenant_id and user.tenant_id != tenant.id:
            raise RuntimeError(f"El correo del cliente {customer_email} ya está asociado a otra cuenta")

        first_name, last_name = _split_customer_name(customer_name)
        if user.tenant_id is None:
            user.tenant_id = tenant.id
        if customer_phone and not user.phone:
            user.phone = customer_phone
        if customer_date_of_birth and not user.date_of_birth:
            user.date_of_birth = customer_date_of_birth
        if user.first_name in {"", "Cliente"} and first_name:
            user.first_name = first_name
        if user.last_name in {"", "Nexo", "Cliente"} and last_name:
            user.last_name = last_name
        user.is_active = True
        user.is_verified = True
        user.deleted_at = None
        return user, False

    first_name, last_name = _split_customer_name(customer_name)
    initial_password = customer_password or f"Nexo{uuid4().hex}Aa1"
    user = User(
        tenant_id=tenant.id,
        email=customer_email,
        hashed_password=hash_password(initial_password),
        first_name=first_name,
        last_name=last_name,
        phone=customer_phone,
        date_of_birth=customer_date_of_birth,
        role=UserRole.CLIENT,
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user, True


async def _activate_checkout_purchase(
    db: AsyncSession,
    *,
    tenant_id: str,
    plan_id: str,
    customer_email: str,
    customer_name: str,
    customer_phone: str | None,
    customer_date_of_birth: date | None,
    external_payment_id: str,
    session_reference: str | None,
    checkout_session_id: str | None,
    amount: int | str | Decimal | None,
    currency: str | None,
    metadata: dict,
    promo_code_id: str | None = None,
) -> dict:
    tenant = await db.get(Tenant, UUID(tenant_id))
    if not tenant:
        raise RuntimeError(f"Tenant {tenant_id} not found while processing Fintoc webhook")

    plan = await db.get(Plan, UUID(plan_id))
    if not plan or plan.tenant_id != tenant.id:
        raise RuntimeError(f"Plan {plan_id} not found for tenant {tenant_id}")

    payment = (
        await db.execute(
            select(Payment).where(
                Payment.tenant_id == tenant.id,
                Payment.method == PaymentMethod.FINTOC,
                Payment.external_id == external_payment_id,
            )
        )
    ).scalars().first()
    if payment and payment.status == PaymentStatus.COMPLETED and payment.membership_id:
        return {
            "tenant_id": str(tenant.id),
            "user_id": str(payment.user_id),
            "membership_id": str(payment.membership_id),
            "payment_id": str(payment.id) if payment.id else None,
            "created_user": False,
        }

    if not customer_email:
        raise RuntimeError(f"Missing customer_email while processing Fintoc payment {external_payment_id}")

    user, is_new_user = await _find_or_create_checkout_user(
        db,
        tenant=tenant,
        customer_email=customer_email,
        customer_name=customer_name,
        customer_phone=customer_phone,
        customer_date_of_birth=customer_date_of_birth,
        customer_password=None,
    )

    membership = (
        await db.execute(
            select(Membership)
            .where(Membership.user_id == user.id)
            .order_by(Membership.created_at.desc())
        )
    ).scalars().first()

    today = datetime.now(timezone.utc).date()
    starts_at, expires_at = _resolve_membership_dates(plan, membership, today)

    if membership is None:
        membership = Membership(
            tenant_id=tenant.id,
            user_id=user.id,
            plan_id=plan.id,
            status=MembershipStatus.ACTIVE,
            starts_at=starts_at,
            expires_at=expires_at,
            auto_renew=plan.auto_renew,
        )
        db.add(membership)
        await db.flush()
    else:
        membership.tenant_id = tenant.id
        membership.plan_id = plan.id
        membership.status = MembershipStatus.ACTIVE
        membership.starts_at = starts_at
        membership.expires_at = expires_at
        membership.auto_renew = plan.auto_renew
        membership.cancelled_at = None
        membership.frozen_until = None

    payment_metadata = {
        "checkout_session_id": checkout_session_id,
        "customer_email": customer_email,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "plan_id": str(plan.id),
        "session_reference": session_reference,
        **metadata,
    }
    amount_decimal = Decimal(str(amount or plan.price))

    if payment is None:
        payment = Payment(
            tenant_id=tenant.id,
            user_id=user.id,
            membership_id=membership.id,
            amount=amount_decimal,
            currency=(currency or plan.currency or "CLP").upper(),
            status=PaymentStatus.COMPLETED,
            method=PaymentMethod.FINTOC,
            description=f"Checkout publico - {plan.name}",
            external_id=external_payment_id,
            metadata_json=json.dumps(payment_metadata),
            paid_at=datetime.now(timezone.utc),
        )
        db.add(payment)
    else:
        payment.user_id = user.id
        payment.membership_id = membership.id
        payment.amount = amount_decimal
        payment.currency = (currency or payment.currency or plan.currency or "CLP").upper()
        payment.status = PaymentStatus.COMPLETED
        payment.method = PaymentMethod.FINTOC
        payment.description = payment.description or f"Checkout publico - {plan.name}"
        payment.metadata_json = json.dumps(payment_metadata)
        payment.paid_at = payment.paid_at or datetime.now(timezone.utc)

    await db.flush()

    # Increment promo code uses_count if a promo was applied
    if promo_code_id:
        try:
            promo = (await db.execute(
                select(PromoCode).where(PromoCode.id == UUID(promo_code_id))
            )).scalars().first()
            if promo:
                promo.uses_count = (promo.uses_count or 0) + 1
        except Exception:
            pass  # Don't fail the checkout on promo tracking error

    if is_new_user and settings.SENDGRID_API_KEY.strip():
        await email_service.send_password_reset(customer_email, _build_checkout_reset_url(user.id))

    return {
        "tenant_id": str(tenant.id),
        "user_id": str(user.id),
        "membership_id": str(membership.id),
        "payment_id": str(payment.id) if payment.id else None,
        "created_user": is_new_user,
    }


@public_router.get("/tenants/{slug}/profile", response_model=TenantPublicProfileResponse)
async def get_tenant_public_profile(slug: str, db: AsyncSession = Depends(get_db)):
    tenant = await _get_public_tenant_or_404(db, slug)
    return await _build_tenant_public_profile_response(db, tenant)


@public_router.get("/storefront/profile", response_model=TenantPublicProfileResponse)
async def get_storefront_public_profile(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_public_tenant_by_custom_domain_or_404(db, request)
    return await _build_tenant_public_profile_response(db, tenant)


@public_router.get("/tenants/{slug}/plans", response_model=list[PlanResponse])
async def list_tenant_public_plans(slug: str, db: AsyncSession = Depends(get_db)):
    tenant = await _get_public_tenant_or_404(db, slug)
    plans = (
        await db.execute(
            select(Plan)
            .where(Plan.tenant_id == tenant.id, Plan.is_active == True, Plan.deleted_at == None)
            .order_by(Plan.is_featured.desc(), Plan.sort_order.asc(), Plan.price.asc())
        )
    ).scalars().all()
    return [PlanResponse.model_validate(plan) for plan in plans]


@public_router.get("/tenants/{slug}/classes", response_model=list[GymClassResponse])
async def list_tenant_public_classes(
    slug: str,
    limit: int = Query(12, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_public_tenant_or_404(db, slug)
    classes = (
        await db.execute(
            select(GymClass)
            .where(
                GymClass.tenant_id == tenant.id,
                GymClass.start_time >= datetime.now(timezone.utc),
                GymClass.status == ClassStatus.SCHEDULED,
            )
            .order_by(GymClass.start_time.asc())
            .limit(limit)
        )
    ).scalars().all()

    # Enrich with instructor names
    instructor_ids = list({c.instructor_id for c in classes if c.instructor_id})
    instructors_by_id = {}
    if instructor_ids:
        from app.models.user import User
        instr_result = await db.execute(select(User).where(User.id.in_(instructor_ids)))
        for u in instr_result.scalars().all():
            instructors_by_id[u.id] = f"{u.first_name} {u.last_name}"

    items = []
    for c in classes:
        item = GymClassResponse.model_validate(c)
        item.instructor_name = instructors_by_id.get(c.instructor_id) if c.instructor_id else None
        items.append(item)
    return items


@public_router.post("/tenants/{slug}/checkout-session", response_model=PublicCheckoutSessionResponse)
async def create_public_checkout_session(
    slug: str,
    data: PublicCheckoutSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_public_tenant_or_404(db, slug)
    return await _create_public_checkout_session_for_tenant(tenant=tenant, data=data, db=db)


@public_router.post("/storefront/checkout-session", response_model=PublicCheckoutSessionResponse)
async def create_storefront_checkout_session(
    request: Request,
    data: PublicCheckoutSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_public_tenant_by_custom_domain_or_404(db, request)
    return await _create_public_checkout_session_for_tenant(tenant=tenant, data=data, db=db)


async def _create_public_checkout_session_for_tenant(
    *,
    tenant: Tenant,
    data: PublicCheckoutSessionRequest,
    db: AsyncSession,
) -> PublicCheckoutSessionResponse:
    plan = await db.get(Plan, data.plan_id)
    if not plan or plan.tenant_id != tenant.id or not plan.is_active or plan.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Plan no disponible")

    account = await _get_default_payment_account(db, tenant.id)
    if not account:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La cuenta no tiene un medio de pago conectado")

    await _ensure_checkout_email_can_purchase(db, tenant, data.customer_email)

    # When creating a new account, require a verified email token
    if data.customer_password:
        existing = await _get_existing_user_by_email(db, data.customer_email)
        if not existing:
            if not data.verification_token:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Debes verificar tu correo electrónico antes de crear una cuenta.",
                )
            try:
                verified_email = decode_email_verified_token(data.verification_token)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
            if verified_email != data.customer_email.lower().strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El token de verificación no corresponde al correo ingresado.",
                )

        await _find_or_create_checkout_user(
            db,
            tenant=tenant,
            customer_email=data.customer_email,
            customer_name=data.customer_name,
            customer_phone=data.customer_phone,
            customer_date_of_birth=data.customer_date_of_birth,
            customer_password=data.customer_password,
        )

    session_reference = f"{tenant.slug}-{plan.id}-{uuid4().hex[:10]}"
    success_url, cancel_url = build_storefront_return_urls(
        settings.public_app_url,
        tenant.slug,
        tenant.custom_domain,
    )

    # ── Fintoc: crear payment intent directo y devolver widget URL ──────────
    if account.provider == "fintoc" and fintoc_service.is_configured():
        try:
            checkout_session = await fintoc_service.create_checkout_session(
                amount=int(plan.price),
                currency=plan.currency or "CLP",
                customer_name=data.customer_name or "",
                customer_email=data.customer_email or "",
                success_url=data.success_url or success_url,
                cancel_url=data.cancel_url or cancel_url,
                metadata={
                    "tenant_id": str(tenant.id),
                    "plan_id": str(plan.id),
                    "plan_name": plan.name,
                    "session_reference": session_reference,
                    "customer_name": data.customer_name or "",
                    "customer_email": data.customer_email,
                    "customer_phone": data.customer_phone or "",
                    "customer_date_of_birth": data.customer_date_of_birth.isoformat() if data.customer_date_of_birth else "",
                    "promo_code_id": str(data.promo_code_id) if data.promo_code_id else "",
                },
            )
            return PublicCheckoutSessionResponse(
                provider="fintoc",
                status="ready",
                checkout_url=checkout_session["redirect_url"],
                payment_link_url=checkout_session["redirect_url"],
                qr_payload=checkout_session["redirect_url"],
                session_reference=session_reference,
                widget_token=checkout_session.get("session_token"),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Error de Fintoc: {exc}") from exc

    # ── Otros providers (Stripe, MercadoPago) ────────────────────────────────
    checkout_base = account.checkout_base_url or f"https://checkout.nexofitness.cl/{tenant.slug}"
    checkout_url, payment_link_url = build_public_checkout_urls(
        checkout_base_url=checkout_base,
        plan_id=str(plan.id),
        session_reference=session_reference,
        success_url=data.success_url or success_url,
        cancel_url=data.cancel_url or cancel_url,
    )
    return PublicCheckoutSessionResponse(
        provider=account.provider,
        status="pending_configuration" if account.status != "connected" else "ready",
        checkout_url=checkout_url,
        payment_link_url=payment_link_url,
        qr_payload=payment_link_url,
        session_reference=session_reference,
    )


async def _activate_saas_tenant(
    db: AsyncSession,
    tenant_id: str,
    saas_plan_key: str,
) -> bool:
    """
    Activa el tenant SaaS tras un pago confirmado de Fintoc.
    Retorna True si la activación fue exitosa.
    """
    import structlog as _structlog
    _logger = _structlog.get_logger()

    if not tenant_id or not saas_plan_key:
        return False

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        _logger.warning("fintoc_saas_activation_tenant_not_found", tenant_id=tenant_id)
        return False

    # Buscar plan en DB primero, luego en defaults
    result = await db.execute(
        select(SaaSPlan).where(
            SaaSPlan.key == saas_plan_key,
            SaaSPlan.is_active.is_(True),
        )
    )
    record = result.scalar_one_or_none()
    if record:
        plan = definition_from_record(record)
    else:
        plan = next(
            (p for p in default_saas_plan_definitions() if p.key == saas_plan_key),
            None,
        )

    if not plan:
        _logger.warning("fintoc_saas_activation_plan_not_found", saas_plan_key=saas_plan_key)
        return False

    activate_tenant_subscription(tenant, plan)
    await db.flush()
    _logger.info(
        "fintoc_saas_tenant_activated",
        tenant_id=tenant_id,
        tenant_slug=tenant.slug,
        saas_plan_key=saas_plan_key,
    )
    return True


@public_router.post("/webhooks/fintoc", include_in_schema=False)
async def fintoc_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Recibe eventos de Fintoc y activa la compra del cliente cuando el pago se confirma."""
    payload = await request.body()
    sig = request.headers.get("Fintoc-Signature", "")

    try:
        event = fintoc_service.verify_webhook(payload, sig)
    except ValueError:
        raise HTTPException(status_code=400, detail="Firma de webhook inválida")

    event_type = event.get("type")
    event_data = _event_data_object(event)
    metadata = event_data.get("metadata", {}) if isinstance(event_data, dict) else {}

    import structlog
    logger = structlog.get_logger()
    logger.info("fintoc_webhook", event_type=event_type, metadata=metadata)

    saas_plan_key = metadata.get("saas_plan_key", "")
    is_saas_payment = bool(saas_plan_key)

    activation_result = None

    if event_type == "checkout_session.finished":
        payment_intent = event_data.get("payment_resource", {}).get("payment_intent", {})
        if payment_intent.get("status") == "succeeded":
            if is_saas_payment:
                # Pago SaaS — activar tenant
                try:
                    activated = await _activate_saas_tenant(
                        db,
                        tenant_id=str(metadata.get("tenant_id", "")),
                        saas_plan_key=saas_plan_key,
                    )
                    activation_result = {"saas_activated": activated, "saas_plan_key": saas_plan_key}
                except Exception as exc:
                    logger.error("fintoc_saas_activation_failed", metadata=metadata, error=str(exc))
            else:
                # Pago de membresía de cliente
                customer = event_data.get("customer", {}) or {}
                try:
                    activation_result = await _activate_checkout_purchase(
                        db,
                        tenant_id=str(metadata.get("tenant_id", "")),
                        plan_id=str(metadata.get("plan_id", "")),
                        customer_email=str(customer.get("email") or metadata.get("customer_email") or ""),
                        customer_name=str(customer.get("name") or metadata.get("customer_name") or ""),
                        customer_phone=str(metadata.get("customer_phone") or "") or None,
                        customer_date_of_birth=_parse_optional_date(str(metadata.get("customer_date_of_birth") or "") or None),
                        external_payment_id=str(payment_intent.get("id") or ""),
                        session_reference=str(metadata.get("session_reference") or ""),
                        checkout_session_id=str(event_data.get("id") or ""),
                        amount=payment_intent.get("amount"),
                        currency=payment_intent.get("currency"),
                        metadata=metadata,
                        promo_code_id=str(metadata.get("promo_code_id") or "") or None,
                    )
                except RuntimeError as exc:
                    logger.error("fintoc_checkout_activation_failed", metadata=metadata, error=str(exc))

    elif event_type == "payment_intent.succeeded":
        if is_saas_payment:
            try:
                activated = await _activate_saas_tenant(
                    db,
                    tenant_id=str(metadata.get("tenant_id", "")),
                    saas_plan_key=saas_plan_key,
                )
                activation_result = {"saas_activated": activated, "saas_plan_key": saas_plan_key}
            except Exception as exc:
                logger.error("fintoc_saas_activation_failed", metadata=metadata, error=str(exc))
        else:
            try:
                activation_result = await _activate_checkout_purchase(
                    db,
                    tenant_id=str(metadata.get("tenant_id", "")),
                    plan_id=str(metadata.get("plan_id", "")),
                    customer_email=str(event_data.get("customer_email") or metadata.get("customer_email") or ""),
                    customer_name=str(metadata.get("customer_name") or ""),
                    customer_phone=str(metadata.get("customer_phone") or "") or None,
                    customer_date_of_birth=_parse_optional_date(str(metadata.get("customer_date_of_birth") or "") or None),
                    external_payment_id=str(event_data.get("id") or ""),
                    session_reference=str(metadata.get("session_reference") or ""),
                    checkout_session_id=str(metadata.get("checkout_session_id") or ""),
                    amount=event_data.get("amount"),
                    currency=event_data.get("currency"),
                    metadata=metadata,
                    promo_code_id=str(metadata.get("promo_code_id") or "") or None,
                )
            except RuntimeError as exc:
                logger.error("fintoc_checkout_activation_failed", metadata=metadata, error=str(exc))

    if activation_result:
        logger.info("fintoc_activation_result", event_type=event_type, **activation_result)

    return {"received": True}


@public_router.post("/leads", response_model=PlatformLeadResponse, status_code=201)
async def create_public_lead(data: PlatformLeadCreateRequest, db: AsyncSession = Depends(get_db)):
    try:
        lead = PlatformLead(
            owner_name=data.owner_name,
            gym_name=data.gym_name,
            email=data.email,
            phone=data.phone,
            request_type=data.request_type,
            source=data.source,
            status="new",
            desired_plan_key=data.desired_plan_key,
            notes=data.notes,
            metadata_json=json.dumps(data.metadata),
        )
        db.add(lead)
        await db.flush()
        await db.refresh(lead)
        return _lead_payload(lead)
    except ProgrammingError as error:
        if _is_missing_table(error, "platform_leads"):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Platform leads storage is not initialized. Run migrations.",
            ) from error
        raise


@platform_router.get("/leads", response_model=PaginatedResponse)
async def list_platform_leads(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    query = select(PlatformLead)
    count_query = select(func.count()).select_from(PlatformLead)
    if status_filter:
        query = query.where(PlatformLead.status == status_filter)
        count_query = count_query.where(PlatformLead.status == status_filter)

    try:
        total = (await db.execute(count_query)).scalar() or 0
        leads = (
            await db.execute(
                query.order_by(PlatformLead.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
            )
        ).scalars().all()
    except ProgrammingError as error:
        if _is_missing_table(error, "platform_leads"):
            return PaginatedResponse(items=[], total=0, page=page, per_page=per_page, pages=0)
        raise

    return PaginatedResponse(
        items=[_lead_payload(lead) for lead in leads],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@platform_router.patch("/leads/{lead_id}", response_model=PlatformLeadResponse)
async def update_platform_lead(
    lead_id: UUID,
    data: PlatformLeadUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    try:
        lead = await db.get(PlatformLead, lead_id)
    except ProgrammingError as error:
        if _is_missing_table(error, "platform_leads"):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="El almacenamiento de oportunidades de plataforma no está inicializado. Ejecuta las migraciones.",
            ) from error
        raise
    if not lead:
        raise HTTPException(status_code=404, detail="Oportunidad no encontrada")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(lead, field, value)

    await db.flush()
    await db.refresh(lead)
    return _lead_payload(lead)
