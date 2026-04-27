"""Public storefront and platform commercial endpoints."""

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from html import escape
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import aliased

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import require_superadmin
from app.core.security import create_password_reset_token, decode_email_verified_token, hash_password
from app.integrations.email.email_service import email_service
from app.models.business import (
    Branch,
    ClassStatus,
    FeedbackCategory,
    FeedbackSubmission,
    GymClass,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Plan,
    PromoCode,
)
from app.models.platform import PlatformLead, TenantPaymentProviderAccount, TuuTransaction, WebpayTransaction
from app.models.tenant import LicenseType, Tenant
from app.models.user import User, UserRole
from app.schemas.business import GymClassResponse, PaginatedResponse, PlanResponse
from app.schemas.platform import (
    PlatformFeedbackSubmissionResponse,
    PlatformLeadCreateRequest,
    PlatformLeadResponse,
    PlatformLeadUpdateRequest,
    PromoCodeValidateRequest,
    PromoCodeValidateResponse,
    PublicCheckoutSessionRequest,
    PublicCheckoutSessionResponse,
    TenantPublicProfileResponse,
)
from app.integrations.payments.fintoc_service import fintoc_service
from app.integrations.payments.tuu_service import tuu_service
from app.integrations.payments.webpay_service import webpay_service
from app.services.branding_service import DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR, coerce_brand_color
from app.services.custom_domain_service import build_storefront_url, extract_hostname, normalize_custom_domain
from app.services.public_checkout_service import build_public_checkout_urls, build_storefront_return_urls
from app.services.billing_service import activate_tenant_subscription
from app.services.class_service import build_gym_class_responses
from app.services.membership_sale_service import SALE_SOURCE_PUBLIC_CHECKOUT, allocate_membership_purchase
from app.services.promo_code_service import resolve_tenant_promo_pricing
from app.services.platform_billing_service import pricing_from_snapshot, record_platform_billing_payment
from app.services.saas_plan_service import definition_from_record, default_saas_plan_definitions, get_public_saas_plan_definition
from app.services.support_contact_service import resolve_tenant_support_contacts
from app.services.tenant_quota_service import assert_can_create_client
from app.services.webpay_checkout_service import (
    build_webpay_redirect_url,
    create_tenant_webpay_transaction,
)
from app.services.tuu_checkout_service import (
    build_tuu_cancel_url,
    build_tuu_complete_url,
    build_tuu_redirect_url,
    create_tenant_tuu_transaction,
    generate_tuu_reference,
)
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


def _build_upload_url(request: Request, file_path: str | None) -> str | None:
    if not file_path:
        return None
    return f"{str(request.base_url).rstrip('/')}{file_path}"


def _full_name(first_name: str | None, last_name: str | None) -> str | None:
    value = " ".join(part for part in [first_name, last_name] if part).strip()
    return value or None


def _platform_feedback_payload(row, request: Request) -> PlatformFeedbackSubmissionResponse:
    data = row._mapping if hasattr(row, "_mapping") else row
    category = data["category"]
    return PlatformFeedbackSubmissionResponse(
        id=data["id"],
        tenant_id=data["tenant_id"],
        tenant_name=data["tenant_name"],
        tenant_slug=data["tenant_slug"],
        category=str(category.value if hasattr(category, "value") else category),
        message=data["message"],
        image_url=_build_upload_url(request, data["image_path"]),
        created_at=data["created_at"],
        created_by=data["created_by"],
        created_by_name=_full_name(data.get("created_by_first_name"), data.get("created_by_last_name")),
        created_by_email=data.get("created_by_email"),
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


def _payment_account_checkout_ready(account: TenantPaymentProviderAccount | None) -> bool:
    if account is None or account.status != "connected":
        return False

    metadata = _loads_dict(account.metadata_json)
    if account.provider == "fintoc":
        tenant_key = str(metadata.get("secret_key") or "").strip()
        return bool(tenant_key or fintoc_service.is_configured())
    if account.provider == "webpay":
        return webpay_service.is_account_configured(metadata)
    if account.provider == "tuu":
        return tuu_service.is_account_configured(metadata)
    if account.provider in {"stripe", "mercadopago", "manual"}:
        return bool((account.checkout_base_url or "").strip())
    return False


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


async def _checkout_requires_client_slot(db: AsyncSession, tenant: Tenant, customer_email: str) -> bool:
    existing_user = await _get_existing_user_by_email(db, customer_email)
    if not existing_user:
        return True
    if existing_user.tenant_id and existing_user.tenant_id != tenant.id:
        return False
    if existing_user.tenant_id == tenant.id and existing_user.is_active:
        return False
    return True


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
    branch_name_by_id = {branch.id: branch.name for branch in branches}
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
                "branch_id": str(gym_class.branch_id) if gym_class.branch_id else None,
                "branch_name": branch_name_by_id.get(gym_class.branch_id) if gym_class.branch_id else None,
                "capacity": gym_class.max_capacity,
                "bookings": gym_class.current_bookings,
            }
            for gym_class in upcoming_classes
        ],
        checkout_enabled=bool(features.get("public_checkout_enabled", True) and _payment_account_checkout_ready(default_account)),
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
        if (user.tenant_id is None or user.tenant_id == tenant.id) and not user.is_active:
            await assert_can_create_client(db, tenant)

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

    await assert_can_create_client(db, tenant)

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
    payment_method: PaymentMethod,
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
                Payment.method == payment_method,
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

    payment_metadata = {
        "checkout_session_id": checkout_session_id,
        "customer_email": customer_email,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "plan_id": str(plan.id),
        "session_reference": session_reference,
        **metadata,
    }
    amount_decimal = Decimal(str(amount if amount is not None else plan.price))
    try:
        purchase = await allocate_membership_purchase(
            db,
            tenant=tenant,
            client=user,
            plan=plan,
            starts_at=datetime.now(timezone.utc).date(),
            payment_method=payment_method,
            amount=amount_decimal,
            currency=(currency or plan.currency or "CLP").upper(),
            description=f"Checkout publico - {plan.name}",
            auto_renew=plan.auto_renew,
            sale_source=SALE_SOURCE_PUBLIC_CHECKOUT,
            payment_status=PaymentStatus.COMPLETED,
            paid_at=datetime.now(timezone.utc),
            external_id=external_payment_id,
            metadata=payment_metadata,
            existing_payment=payment,
        )
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    membership = purchase.membership
    payment = purchase.payment

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


@public_router.post("/tenants/{slug}/promo-codes/validate", response_model=PromoCodeValidateResponse)
async def validate_tenant_public_promo_code(
    slug: str,
    body: PromoCodeValidateRequest,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_public_tenant_or_404(db, slug)
    pricing = await resolve_tenant_promo_pricing(
        db,
        tenant_id=tenant.id,
        plan_id=body.plan_id,
        promo_code=body.code,
    )
    if not pricing.valid or pricing.promo is None:
        return PromoCodeValidateResponse(valid=False, reason=pricing.reason)

    return PromoCodeValidateResponse(
        valid=True,
        promo_code_id=pricing.promo.id,
        discount_type=pricing.promo.discount_type,
        discount_value=float(pricing.promo.discount_value),
        discount_amount=float(pricing.promo_discount_amount or 0),
        final_price=float(pricing.final_price or 0),
    )


@public_router.post("/storefront/promo-codes/validate", response_model=PromoCodeValidateResponse)
async def validate_storefront_public_promo_code(
    request: Request,
    body: PromoCodeValidateRequest,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_public_tenant_by_custom_domain_or_404(db, request)
    pricing = await resolve_tenant_promo_pricing(
        db,
        tenant_id=tenant.id,
        plan_id=body.plan_id,
        promo_code=body.code,
    )
    if not pricing.valid or pricing.promo is None:
        return PromoCodeValidateResponse(valid=False, reason=pricing.reason)

    return PromoCodeValidateResponse(
        valid=True,
        promo_code_id=pricing.promo.id,
        discount_type=pricing.promo.discount_type,
        discount_value=float(pricing.promo.discount_value),
        discount_amount=float(pricing.promo_discount_amount or 0),
        final_price=float(pricing.final_price or 0),
    )


@public_router.get("/tenants/{slug}/classes", response_model=list[GymClassResponse])
async def list_tenant_public_classes(
    slug: str,
    limit: int = Query(12, ge=1, le=50),
    branch_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_public_tenant_or_404(db, slug)
    query = (
        select(GymClass)
        .where(
            GymClass.tenant_id == tenant.id,
            GymClass.start_time >= datetime.now(timezone.utc),
            GymClass.status == ClassStatus.SCHEDULED,
        )
        .order_by(GymClass.start_time.asc())
    )
    if branch_id:
        query = query.where(GymClass.branch_id == branch_id)

    classes = (await db.execute(query.limit(limit))).scalars().all()
    return await build_gym_class_responses(db, classes)


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

    pricing = await resolve_tenant_promo_pricing(
        db,
        tenant_id=tenant.id,
        plan_id=plan.id,
        promo_code_id=data.promo_code_id,
    )
    if not pricing.valid or pricing.plan is None or pricing.final_price is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pricing.reason or "No se pudo aplicar el código promocional.")

    account = await _get_default_payment_account(db, tenant.id)
    if not account:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La cuenta no tiene un medio de pago conectado")
    if not _payment_account_checkout_ready(account):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La cuenta tiene un proveedor de pago configurado, pero todavía no está lista para cobrar online.",
        )

    await _ensure_checkout_email_can_purchase(db, tenant, data.customer_email)
    if await _checkout_requires_client_slot(db, tenant, data.customer_email):
        await assert_can_create_client(db, tenant)

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

    # ── Fintoc: crear checkout hosted y devolver redirect URL ───────────────
    if account.provider == "fintoc":
        account_metadata = _loads_dict(account.metadata_json)
        tenant_fintoc_key = str(account_metadata.get("secret_key") or "").strip() or None
        if not tenant_fintoc_key and not fintoc_service.is_configured():
            raise HTTPException(status_code=400, detail="Fintoc no configurado: agrega la API key secreta en la cuenta de pago.")
        try:
            checkout_session = await fintoc_service.create_checkout_session(
                amount=int(pricing.final_price),
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
                    "price_before_promo": str(pricing.price_before_promo or ""),
                    "promo_discount_amount": str(pricing.promo_discount_amount or ""),
                    "final_price": str(pricing.final_price),
                },
                secret_key=tenant_fintoc_key,
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

    # ── TUU: preparar sesión firmada y devolver relay interno ───────────────
    if account.provider == "tuu":
        if not (data.customer_phone or "").strip():
            raise HTTPException(
                status_code=400,
                detail="TUU requiere teléfono del cliente para iniciar el checkout.",
            )
        if (plan.currency or "CLP").upper() != "CLP":
            raise HTTPException(
                status_code=400,
                detail="TUU solo admite cobros en CLP.",
            )

        try:
            tuu_reference = generate_tuu_reference(tenant.slug)
            transaction = await create_tenant_tuu_transaction(
                db,
                tenant=tenant,
                payment_account=account,
                user=None,
                amount=pricing.final_price,
                currency=plan.currency or "CLP",
                flow_type="tenant_plan_checkout",
                flow_reference=tuu_reference,
                success_url=data.success_url or success_url,
                cancel_url=data.cancel_url or cancel_url,
                metadata={
                    "tenant_id": str(tenant.id),
                    "tenant_slug": tenant.slug,
                    "tenant_name": tenant.name,
                    "plan_id": str(plan.id),
                    "plan_name": plan.name,
                    "customer_name": data.customer_name or "",
                    "customer_email": data.customer_email,
                    "customer_phone": data.customer_phone or "",
                    "customer_date_of_birth": data.customer_date_of_birth.isoformat() if data.customer_date_of_birth else "",
                    "promo_code_id": str(data.promo_code_id) if data.promo_code_id else "",
                    "price_before_promo": str(pricing.price_before_promo or ""),
                    "promo_discount_amount": str(pricing.promo_discount_amount or ""),
                    "final_price": str(pricing.final_price),
                    "payment_account_id": str(account.id),
                },
            )
            return PublicCheckoutSessionResponse(
                provider="tuu",
                status="ready",
                checkout_url=transaction.checkout_url or build_tuu_redirect_url(str(transaction.id)),
                payment_link_url=transaction.checkout_url or build_tuu_redirect_url(str(transaction.id)),
                qr_payload=transaction.checkout_url or build_tuu_redirect_url(str(transaction.id)),
                session_reference=tuu_reference,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Error de TUU: {exc}") from exc

    # ── Webpay: crear transacción real y devolver relay interno ─────────────
    if account.provider == "webpay":
        try:
            transaction = await create_tenant_webpay_transaction(
                db,
                tenant=tenant,
                payment_account=account,
                user=None,
                amount=pricing.final_price,
                currency=plan.currency or "CLP",
                flow_type="tenant_plan_checkout",
                flow_reference=session_reference,
                success_url=data.success_url or success_url,
                cancel_url=data.cancel_url or cancel_url,
                metadata={
                    "tenant_id": str(tenant.id),
                    "tenant_slug": tenant.slug,
                    "plan_id": str(plan.id),
                    "plan_name": plan.name,
                    "customer_name": data.customer_name or "",
                    "customer_email": data.customer_email,
                    "customer_phone": data.customer_phone or "",
                    "customer_date_of_birth": data.customer_date_of_birth.isoformat() if data.customer_date_of_birth else "",
                    "promo_code_id": str(data.promo_code_id) if data.promo_code_id else "",
                    "price_before_promo": str(pricing.price_before_promo or ""),
                    "promo_discount_amount": str(pricing.promo_discount_amount or ""),
                    "final_price": str(pricing.final_price),
                    "payment_account_id": str(account.id),
                },
            )
            return PublicCheckoutSessionResponse(
                provider="webpay",
                status="ready",
                checkout_url=transaction.checkout_url or build_webpay_redirect_url(str(transaction.id)),
                payment_link_url=transaction.checkout_url or build_webpay_redirect_url(str(transaction.id)),
                qr_payload=transaction.checkout_url or build_webpay_redirect_url(str(transaction.id)),
                session_reference=session_reference,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Error de Webpay: {exc}") from exc

    # ── Otros providers (Stripe, MercadoPago) ────────────────────────────────
    checkout_base = account.checkout_base_url or f"https://checkout.nexofitness.cl/{tenant.slug}"
    checkout_url, payment_link_url = build_public_checkout_urls(
        checkout_base_url=checkout_base,
        plan_id=str(plan.id),
        session_reference=session_reference,
        success_url=data.success_url or success_url,
        cancel_url=data.cancel_url or cancel_url,
        amount=str(pricing.final_price),
        promo_code_id=str(data.promo_code_id) if data.promo_code_id else None,
    )
    return PublicCheckoutSessionResponse(
        provider=account.provider,
        status="pending_configuration" if account.status != "connected" else "ready",
        checkout_url=checkout_url,
        payment_link_url=payment_link_url,
        qr_payload=payment_link_url,
        session_reference=session_reference,
    )


async def _payment_dates_from_metadata(
    db: AsyncSession,
    metadata: dict,
    tenant: Tenant,
) -> tuple[date, Optional[date]]:
    """Calculates (starts_at, expires_at) for a SaaS billing payment record.

    For queued payments, starts_at = queue_starts_at and expires_at is
    derived from the plan's billing interval.  For immediate activations,
    starts_at = today and expires_at = tenant.license_expires_at.
    """
    queue_after = metadata.get("queue_after_payment") == "true"
    queue_starts_raw = metadata.get("queue_starts_at", "")
    payment_starts: Optional[date] = None
    if queue_after and queue_starts_raw:
        try:
            payment_starts = datetime.fromisoformat(queue_starts_raw).date()
        except ValueError:
            pass

    starts_at: date = payment_starts or datetime.now(timezone.utc).date()

    if not queue_after:
        expires_at = tenant.license_expires_at.date() if tenant.license_expires_at else None
        return starts_at, expires_at

    # Queued: calculate expiry from plan duration
    plan_key = str(metadata.get("saas_plan_key") or "").strip()
    plan_def = await get_public_saas_plan_definition(db, plan_key) if plan_key else None
    if plan_def:
        anchor = datetime.combine(starts_at, datetime.min.time()).replace(tzinfo=timezone.utc)
        if plan_def.license_type == LicenseType.ANNUAL:
            expires_at = (anchor + timedelta(days=365)).date()
        elif plan_def.license_type == LicenseType.SEMI_ANNUAL:
            expires_at = (anchor + timedelta(days=180)).date()
        elif plan_def.license_type == LicenseType.QUARTERLY:
            expires_at = (anchor + timedelta(days=90)).date()
        elif plan_def.license_type == LicenseType.PERPETUAL:
            expires_at = None
        else:
            expires_at = (anchor + timedelta(days=30)).date()
    else:
        expires_at = None
    return starts_at, expires_at


async def _activate_saas_tenant(
    db: AsyncSession,
    tenant_id: str,
    saas_plan_key: str,
    *,
    metadata: Optional[dict] = None,
) -> bool:
    """
    Activa o encola el plan SaaS tras un pago confirmado.
    Si metadata["queue_after_payment"] == "true", encola en lugar de activar.
    Retorna True si la operación fue exitosa.
    """
    import structlog as _structlog
    _logger = _structlog.get_logger()

    if not tenant_id or not saas_plan_key:
        return False

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        _logger.warning("saas_activation_tenant_not_found", tenant_id=tenant_id)
        return False

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
        _logger.warning("saas_activation_plan_not_found", saas_plan_key=saas_plan_key)
        return False

    _meta = metadata or {}
    if _meta.get("queue_after_payment") == "true":
        queue_starts_raw = _meta.get("queue_starts_at", "")
        try:
            queue_starts_at = datetime.fromisoformat(queue_starts_raw) if queue_starts_raw else None
        except ValueError:
            queue_starts_at = None
        tenant.next_plan_key = plan.key
        tenant.next_plan_name = str(_meta.get("saas_plan_name") or plan.name)
        tenant.next_plan_starts_at = queue_starts_at or tenant.license_expires_at
        await db.flush()
        _logger.info(
            "saas_tenant_plan_queued",
            tenant_id=tenant_id,
            tenant_slug=tenant.slug,
            saas_plan_key=saas_plan_key,
            queue_starts_at=str(tenant.next_plan_starts_at),
        )
    else:
        activate_tenant_subscription(tenant, plan)
        await db.flush()
        _logger.info(
            "saas_tenant_activated",
            tenant_id=tenant_id,
            tenant_slug=tenant.slug,
            saas_plan_key=saas_plan_key,
        )
    return True


def _merge_redirect_query(base_url: str, params: dict[str, str | None]) -> str:
    parts = urlsplit(base_url)
    overridden = {key for key, value in params.items() if value is not None}
    query_items = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key not in overridden]
    query_items.extend((key, value) for key, value in params.items() if value is not None)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query_items), parts.fragment))


def _webpay_redirect_response(base_url: str, **params: str | None) -> RedirectResponse:
    return RedirectResponse(_merge_redirect_query(base_url, params), status_code=status.HTTP_303_SEE_OTHER)


def _tuu_form_html(action_url: str, payload: dict[str, str | int]) -> str:
    input_fields = "\n".join(
        f'        <input type="hidden" name="{escape(str(key), quote=True)}" value="{escape(str(value), quote=True)}" />'
        for key, value in payload.items()
    )
    return f"""<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redirigiendo a TUU</title>
    <style>
      body {{ font-family: system-ui, sans-serif; background: #04131f; color: #e2e8f0; display: grid; min-height: 100vh; place-items: center; margin: 0; }}
      .card {{ max-width: 30rem; padding: 2rem; border-radius: 1.5rem; background: linear-gradient(180deg, rgba(5, 23, 38, 0.96), rgba(3, 13, 25, 0.96)); border: 1px solid rgba(56, 189, 248, 0.18); text-align: center; box-shadow: 0 24px 60px rgba(2, 8, 23, 0.45); }}
      .brand {{ display: inline-flex; align-items: center; justify-content: center; width: 3rem; height: 3rem; border-radius: 9999px; background: linear-gradient(135deg, #22d3ee, #0284c7); color: white; font-weight: 700; margin-bottom: 1rem; }}
      h1 {{ margin: 0 0 0.75rem; font-size: 1.35rem; }}
      p {{ margin: 0 0 1rem; color: #94a3b8; line-height: 1.5; }}
      .spinner {{ width: 2.75rem; height: 2.75rem; border-radius: 9999px; border: 4px solid rgba(148, 163, 184, 0.18); border-top-color: #22d3ee; margin: 1.5rem auto 0; animation: spin 1s linear infinite; }}
      .hint {{ margin-top: 1rem; font-size: 0.875rem; color: #cbd5f5; }}
      button {{ margin-top: 1.5rem; border: 0; border-radius: 9999px; padding: 0.85rem 1.25rem; font-weight: 600; cursor: pointer; color: #082f49; background: linear-gradient(135deg, #67e8f9, #38bdf8); }}
      @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
    </style>
  </head>
  <body>
    <div class="card">
      <div class="brand">T</div>
      <h1>Te estamos redirigiendo a TUU</h1>
      <p>Preparando el pago seguro de tu plan. Si la redirección no ocurre automáticamente, continúa manualmente.</p>
      <form id="tuu-redirect-form" method="post" action="{escape(action_url, quote=True)}" accept-charset="utf-8">
{input_fields}
        <button type="submit">Continuar a TUU</button>
      </form>
      <div class="spinner" aria-hidden="true"></div>
      <p class="hint">Nexo Fitness firma esta solicitud desde backend antes de enviarla a la pasarela.</p>
    </div>
    <script>document.getElementById('tuu-redirect-form')?.submit();</script>
  </body>
</html>"""


def _webpay_form_html(action_url: str, token: str) -> str:
    return f"""<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redirigiendo a Webpay</title>
    <style>
      body {{ font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: grid; min-height: 100vh; place-items: center; margin: 0; }}
      .card {{ max-width: 28rem; padding: 2rem; border-radius: 1.5rem; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.2); text-align: center; }}
      .spinner {{ width: 2rem; height: 2rem; border-radius: 999px; border: 3px solid rgba(255,255,255,0.2); border-top-color: #38bdf8; margin: 0 auto 1rem; animation: spin 0.9s linear infinite; }}
      @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
    </style>
  </head>
  <body onload="document.getElementById('webpay-redirect-form').submit()">
    <div class="card">
      <div class="spinner"></div>
      <h1>Redirigiendo a Webpay</h1>
      <p>Estamos conectando tu pago con Transbank. Si no ocurre automáticamente, presiona el botón.</p>
      <form id="webpay-redirect-form" method="post" action="{action_url}">
        <input type="hidden" name="token_ws" value="{token}" />
        <button type="submit">Continuar a Webpay</button>
      </form>
    </div>
  </body>
</html>"""


def _webpay_commit_succeeded(payload: dict) -> bool:
    try:
        response_code = int(payload.get("response_code"))
    except (TypeError, ValueError):
        response_code = -1
    status_value = str(payload.get("status") or "").upper()
    return response_code == 0 and status_value == "AUTHORIZED"


async def _process_tuu_result(
    db: AsyncSession,
    *,
    transaction: TuuTransaction,
    payload: dict[str, str],
) -> None:
    amount = str(payload.get("x_amount") or "").strip()
    currency = str(payload.get("x_currency") or transaction.currency or "").strip().upper()
    if amount:
        try:
            if Decimal(amount) != transaction.amount:
                raise HTTPException(status_code=400, detail="Monto TUU inválido para la transacción")
        except ArithmeticError as exc:
            raise HTTPException(status_code=400, detail="Monto TUU inválido") from exc

    if currency and currency != (transaction.currency or "").upper():
        raise HTTPException(status_code=400, detail="Moneda TUU inválida para la transacción")

    transaction.external_id = str(payload.get("x_reference") or "").strip() or transaction.external_id or transaction.flow_reference
    transaction.provider_response_json = json.dumps(payload)

    result = str(payload.get("x_result") or "").strip().lower()
    metadata = _loads_dict(transaction.metadata_json)

    if result == "completed":
        try:
            await _activate_checkout_purchase(
                db,
                tenant_id=str(metadata.get("tenant_id") or ""),
                plan_id=str(metadata.get("plan_id") or ""),
                customer_email=str(metadata.get("customer_email") or ""),
                customer_name=str(metadata.get("customer_name") or ""),
                customer_phone=str(metadata.get("customer_phone") or "") or None,
                customer_date_of_birth=_parse_optional_date(str(metadata.get("customer_date_of_birth") or "") or None),
                external_payment_id=transaction.external_id or str(transaction.id),
                session_reference=str(transaction.flow_reference or ""),
                checkout_session_id=str(transaction.id),
                amount=amount or transaction.amount,
                currency=currency or transaction.currency,
                payment_method=PaymentMethod.TUU,
                metadata=metadata,
                promo_code_id=str(metadata.get("promo_code_id") or "") or None,
            )
        except Exception as exc:
            transaction.status = "activation_error"
            transaction.provider_response_json = json.dumps(
                {
                    "callback": payload,
                    "activation_error": str(exc),
                }
            )
            await db.flush()
            raise HTTPException(status_code=500, detail="No se pudo activar el checkout TUU") from exc

        transaction.status = "completed"
        transaction.committed_at = datetime.now(timezone.utc)
        await db.flush()
        return

    if result == "failed":
        transaction.status = "failed"
    elif result == "pending":
        transaction.status = "pending"
    elif result == "cancelled":
        transaction.status = "cancelled"
    else:
        transaction.status = result or transaction.status or "pending"
    await db.flush()


async def _resolve_tuu_transaction(
    db: AsyncSession,
    *,
    transaction_id: str | None,
    reference: str | None,
) -> TuuTransaction | None:
    if transaction_id:
        try:
            transaction = await db.get(TuuTransaction, UUID(transaction_id))
        except ValueError:
            transaction = None
        if transaction:
            return transaction

    if reference:
        return (
            await db.execute(select(TuuTransaction).where(TuuTransaction.flow_reference == reference))
        ).scalars().first()

    return None


async def _resolve_tuu_credentials(
    db: AsyncSession,
    transaction: TuuTransaction,
):
    if not transaction.payment_account_id:
        raise ValueError("La transacción TUU no tiene una cuenta asociada.")

    account = await db.get(TenantPaymentProviderAccount, transaction.payment_account_id)
    if account is None:
        raise ValueError("La cuenta TUU asociada ya no existe.")

    credentials = tuu_service.credentials_from_metadata(_loads_dict(account.metadata_json))
    if credentials is None:
        raise ValueError("La cuenta TUU asociada no tiene credenciales válidas.")
    return credentials


async def _resolve_webpay_transaction(
    db: AsyncSession,
    *,
    transaction_id: str | None,
    token: str | None,
) -> WebpayTransaction | None:
    if transaction_id:
        try:
            transaction = await db.get(WebpayTransaction, UUID(transaction_id))
        except ValueError:
            transaction = None
        if transaction:
            return transaction

    if token:
        return (
            await db.execute(select(WebpayTransaction).where(WebpayTransaction.token == token))
        ).scalars().first()

    return None


async def _resolve_webpay_credentials(
    db: AsyncSession,
    transaction: WebpayTransaction,
):
    if transaction.payment_account_id:
        account = await db.get(TenantPaymentProviderAccount, transaction.payment_account_id)
        if account is None:
            raise ValueError("La cuenta Webpay asociada ya no existe.")
        credentials = webpay_service.credentials_from_metadata(_loads_dict(account.metadata_json))
        if credentials is None:
            raise ValueError("La cuenta Webpay asociada no tiene credenciales válidas.")
        return credentials

    credentials = webpay_service.get_platform_credentials()
    if credentials is None:
        raise ValueError("Webpay no está configurado para la plataforma.")
    return credentials


@public_router.get("/tuu/redirect/{transaction_id}", include_in_schema=False)
async def tuu_redirect(transaction_id: UUID, db: AsyncSession = Depends(get_db)):
    transaction = await db.get(TuuTransaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transacción TUU no encontrada")

    if transaction.status == "completed":
        return _webpay_redirect_response(
            transaction.success_url or settings.public_app_url,
            provider="tuu",
            status="success",
            flow=transaction.flow_type,
        )
    if transaction.status in {"failed", "cancelled"}:
        return _webpay_redirect_response(
            transaction.cancel_url or settings.public_app_url,
            provider="tuu",
            status=transaction.status,
            flow=transaction.flow_type,
        )

    metadata = _loads_dict(transaction.metadata_json)
    credentials = await _resolve_tuu_credentials(db, transaction)
    first_name, last_name = _split_customer_name(str(metadata.get("customer_name") or ""))

    try:
        payload = tuu_service.build_payment_payload(
            credentials=credentials,
            amount=int(transaction.amount),
            currency=transaction.currency,
            customer_email=str(metadata.get("customer_email") or "").strip(),
            customer_first_name=first_name,
            customer_last_name=last_name,
            customer_phone=str(metadata.get("customer_phone") or "").strip(),
            description=f"Plan {str(metadata.get('plan_name') or 'Nexo Fitness').strip()}",
            reference=transaction.flow_reference,
            shop_name=str(metadata.get("tenant_name") or metadata.get("tenant_slug") or "Nexo Fitness"),
            callback_url=transaction.callback_url or settings.public_app_url,
            cancel_url=build_tuu_cancel_url(str(transaction.id)),
            complete_url=build_tuu_complete_url(str(transaction.id)),
        )
    except ValueError as exc:
        transaction.status = "failed"
        transaction.provider_response_json = json.dumps({"redirect_error": str(exc)})
        await db.flush()
        return _webpay_redirect_response(
            transaction.cancel_url or settings.public_app_url,
            provider="tuu",
            status="failed",
            flow=transaction.flow_type,
            reason="invalid_request",
        )

    transaction.status = "pending"
    transaction.provider_response_json = json.dumps({"request_payload": payload})
    await db.flush()
    return HTMLResponse(_tuu_form_html(credentials.payment_url, payload))


@public_router.api_route("/tuu/{outcome}/{transaction_id}", methods=["GET", "POST"], include_in_schema=False)
async def tuu_return(outcome: str, transaction_id: UUID, request: Request, db: AsyncSession = Depends(get_db)):
    transaction = await db.get(TuuTransaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transacción TUU no encontrada")

    payload = {key: str(value) for key, value in request.query_params.items()}
    if request.method == "POST":
        form = await request.form()
        payload.update({key: str(value) for key, value in form.items()})

    storefront_url = build_storefront_url(
        settings.public_app_url,
        str(_loads_dict(transaction.metadata_json).get("tenant_slug") or ""),
    )
    checkout_state = "success" if outcome == "complete" else "cancelled"

    if payload:
        reference = str(payload.get("x_reference") or "").strip() or None
        if reference and reference != transaction.flow_reference:
            return _webpay_redirect_response(
                transaction.cancel_url or storefront_url,
                checkout=checkout_state,
                provider="tuu",
                status="failed",
                reason="invalid_reference",
            )

        credentials = await _resolve_tuu_credentials(db, transaction)
        if tuu_service.verify_signature(payload, credentials.secret_key):
            account_id = str(payload.get("x_account_id") or "").strip()
            if account_id and account_id == transaction.account_id:
                await _process_tuu_result(db, transaction=transaction, payload=payload)
            else:
                return _webpay_redirect_response(
                    transaction.cancel_url or storefront_url,
                    checkout=checkout_state,
                    provider="tuu",
                    status="failed",
                    reason="invalid_account",
                )

        result = str(payload.get("x_result") or "").strip().lower() or ("cancelled" if outcome == "cancel" else "pending")
        message = str(payload.get("x_message") or "").strip() or None
        return _webpay_redirect_response(
            storefront_url,
            checkout="success" if result == "completed" else "cancelled",
            provider="tuu",
            status=result,
            message=message,
            reference=transaction.flow_reference,
        )

    if outcome == "cancel":
        transaction.status = "cancelled"
        await db.flush()

    return _webpay_redirect_response(
        storefront_url,
        checkout=checkout_state,
        provider="tuu",
        status="cancelled" if outcome == "cancel" else "pending",
        reference=transaction.flow_reference,
    )


@public_router.get("/webpay/redirect/{transaction_id}", include_in_schema=False)
async def webpay_redirect(transaction_id: UUID, db: AsyncSession = Depends(get_db)):
    transaction = await db.get(WebpayTransaction, transaction_id)
    if not transaction or not transaction.token or not transaction.provider_url:
        raise HTTPException(status_code=404, detail="Transacción Webpay no encontrada")

    return HTMLResponse(_webpay_form_html(transaction.provider_url, transaction.token))


@public_router.api_route("/webpay/return", methods=["GET", "POST"], include_in_schema=False)
async def webpay_return(request: Request, db: AsyncSession = Depends(get_db)):
    form_data = {}
    if request.method == "POST":
        form = await request.form()
        form_data = {key: value for key, value in form.items()}

    query_data = dict(request.query_params)
    token_ws = str(form_data.get("token_ws") or query_data.get("token_ws") or "").strip() or None
    tbk_token = str(form_data.get("TBK_TOKEN") or query_data.get("TBK_TOKEN") or "").strip() or None
    transaction_id = str(query_data.get("transaction_id") or form_data.get("transaction_id") or "").strip() or None

    transaction = await _resolve_webpay_transaction(db, transaction_id=transaction_id, token=token_ws or tbk_token)
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transacción Webpay no encontrada")

    provider_payload = {**query_data, **form_data}

    if tbk_token and not token_ws:
        transaction.status = "cancelled"
        transaction.provider_response_json = json.dumps(provider_payload)
        await db.flush()
        return _webpay_redirect_response(
            transaction.cancel_url or settings.public_app_url,
            provider="webpay",
            status="cancelled",
            reason="user_aborted",
        )

    if not token_ws:
        transaction.status = "failed"
        transaction.provider_response_json = json.dumps(provider_payload)
        await db.flush()
        return _webpay_redirect_response(
            transaction.cancel_url or settings.public_app_url,
            provider="webpay",
            status="failed",
            reason="missing_token",
        )

    if transaction.status == "committed" and transaction.response_code == 0:
        return _webpay_redirect_response(
            transaction.success_url or settings.public_app_url,
            provider="webpay",
            status="success",
            flow=transaction.flow_type,
        )

    try:
        credentials = await _resolve_webpay_credentials(db, transaction)
        commit_payload = await webpay_service.commit_transaction(token=token_ws, credentials=credentials)
    except Exception as exc:
        transaction.status = "failed"
        transaction.provider_response_json = json.dumps({"error": str(exc), **provider_payload})
        await db.flush()
        return _webpay_redirect_response(
            transaction.cancel_url or settings.public_app_url,
            provider="webpay",
            status="failed",
            reason="commit_error",
        )

    transaction.token = token_ws
    transaction.external_id = str(commit_payload.get("buy_order") or token_ws)
    transaction.authorization_code = commit_payload.get("authorization_code")
    transaction.response_code = commit_payload.get("response_code")
    transaction.transaction_status = commit_payload.get("status")
    transaction.provider_response_json = json.dumps(commit_payload)
    transaction.committed_at = datetime.now(timezone.utc)

    metadata = _loads_dict(transaction.metadata_json)
    if _webpay_commit_succeeded(commit_payload):
        try:
            if transaction.flow_type in {"saas_signup", "saas_reactivation"}:
                await _activate_saas_tenant(
                    db,
                    tenant_id=str(metadata.get("tenant_id") or ""),
                    saas_plan_key=str(metadata.get("saas_plan_key") or ""),
                    metadata=metadata,
                )
                if metadata.get("total_amount"):
                    pricing = await pricing_from_snapshot(
                        db,
                        plan_key=str(metadata.get("saas_plan_key") or ""),
                        metadata=metadata,
                        require_public_plan=False,
                    )
                    owner_user_id = str(metadata.get("owner_user_id") or "").strip()
                    try:
                        owner_uuid = UUID(owner_user_id) if owner_user_id else transaction.user_id
                    except ValueError:
                        owner_uuid = transaction.user_id
                    tenant_id_raw = str(metadata.get("tenant_id") or "").strip()
                    try:
                        tenant_uuid = UUID(tenant_id_raw) if tenant_id_raw else None
                    except ValueError:
                        tenant_uuid = None
                    tenant = await db.get(Tenant, tenant_uuid) if tenant_uuid else None
                    if tenant is not None:
                        _starts, _expires = await _payment_dates_from_metadata(db, metadata, tenant)
                        await record_platform_billing_payment(
                            db,
                            tenant_id=tenant.id,
                            user_id=owner_uuid,
                            created_by=owner_uuid,
                            pricing=pricing,
                            payment_method=PaymentMethod.WEBPAY,
                            external_reference=token_ws or str(transaction.id),
                            starts_at=_starts,
                            expires_at=_expires,
                            metadata=metadata,
                        )
            elif transaction.flow_type == "tenant_plan_checkout":
                await _activate_checkout_purchase(
                    db,
                    tenant_id=str(metadata.get("tenant_id") or ""),
                    plan_id=str(metadata.get("plan_id") or ""),
                    customer_email=str(metadata.get("customer_email") or ""),
                    customer_name=str(metadata.get("customer_name") or ""),
                    customer_phone=str(metadata.get("customer_phone") or "") or None,
                    customer_date_of_birth=_parse_optional_date(str(metadata.get("customer_date_of_birth") or "") or None),
                    external_payment_id=token_ws,
                    session_reference=str(metadata.get("session_reference") or transaction.flow_reference or ""),
                    checkout_session_id=str(transaction.id),
                    amount=commit_payload.get("amount") or transaction.amount,
                    currency=commit_payload.get("currency") or transaction.currency,
                    payment_method=PaymentMethod.WEBPAY,
                    metadata=metadata,
                    promo_code_id=str(metadata.get("promo_code_id") or "") or None,
                )
            transaction.status = "committed"
            await db.flush()
            return _webpay_redirect_response(
                transaction.success_url or settings.public_app_url,
                provider="webpay",
                status="success",
                flow=transaction.flow_type,
            )
        except Exception as exc:
            transaction.status = "activation_error"
            transaction.provider_response_json = json.dumps(
                {
                    "commit": commit_payload,
                    "activation_error": str(exc),
                }
            )
            await db.flush()
            return _webpay_redirect_response(
                transaction.success_url or settings.public_app_url,
                provider="webpay",
                status="success",
                flow=transaction.flow_type,
                activation="pending_review",
            )

    transaction.status = "failed"
    await db.flush()
    return _webpay_redirect_response(
        transaction.cancel_url or settings.public_app_url,
        provider="webpay",
        status="failed",
        flow=transaction.flow_type,
    )


@public_router.api_route("/webhooks/tuu/{transaction_id}", methods=["GET", "POST"], include_in_schema=False)
async def tuu_webhook(transaction_id: UUID, request: Request, db: AsyncSession = Depends(get_db)):
    form_data: dict[str, str] = {}
    if request.method == "POST":
        form = await request.form()
        form_data = {key: str(value) for key, value in form.items()}

    query_data = {key: str(value) for key, value in request.query_params.items()}
    callback_payload = {**query_data, **form_data}
    reference = str(callback_payload.get("x_reference") or "").strip() or None

    transaction = await _resolve_tuu_transaction(db, transaction_id=str(transaction_id), reference=reference)
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transacción TUU no encontrada")
    if reference and reference != transaction.flow_reference:
        raise HTTPException(status_code=400, detail="Referencia TUU inválida para la transacción")

    credentials = await _resolve_tuu_credentials(db, transaction)
    if not tuu_service.verify_signature(callback_payload, credentials.secret_key):
        raise HTTPException(status_code=400, detail="Firma TUU inválida")
    account_id = str(callback_payload.get("x_account_id") or "").strip()
    if account_id and account_id != transaction.account_id:
        raise HTTPException(status_code=400, detail="Account ID TUU inválido para la transacción")

    await _process_tuu_result(db, transaction=transaction, payload=callback_payload)
    return {"received": True}


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
                # Pago SaaS — activar o encolar según metadata
                try:
                    activated = await _activate_saas_tenant(
                        db,
                        tenant_id=str(metadata.get("tenant_id", "")),
                        saas_plan_key=saas_plan_key,
                        metadata=metadata,
                    )
                    activation_result = {"saas_activated": activated, "saas_plan_key": saas_plan_key}
                    if activated and metadata.get("total_amount"):
                        pricing = await pricing_from_snapshot(
                            db,
                            plan_key=saas_plan_key,
                            metadata=metadata,
                            require_public_plan=False,
                        )
                        owner_user_id = str(metadata.get("owner_user_id") or "").strip()
                        try:
                            owner_uuid = UUID(owner_user_id) if owner_user_id else None
                        except ValueError:
                            owner_uuid = None
                        tenant_id = str(metadata.get("tenant_id", "")).strip()
                        try:
                            tenant_uuid = UUID(tenant_id) if tenant_id else None
                        except ValueError:
                            tenant_uuid = None
                        tenant = await db.get(Tenant, tenant_uuid) if tenant_uuid else None
                        if tenant is not None:
                            _starts, _expires = await _payment_dates_from_metadata(db, metadata, tenant)
                            await record_platform_billing_payment(
                                db,
                                tenant_id=tenant.id,
                                user_id=owner_uuid,
                                created_by=owner_uuid,
                                pricing=pricing,
                                payment_method=PaymentMethod.FINTOC,
                                external_reference=str(payment_intent.get("id") or event_data.get("id") or ""),
                                starts_at=_starts,
                                expires_at=_expires,
                                metadata=metadata,
                            )
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
                        payment_method=PaymentMethod.FINTOC,
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
                    metadata=metadata,
                )
                activation_result = {"saas_activated": activated, "saas_plan_key": saas_plan_key}
                if activated and metadata.get("total_amount"):
                    pricing = await pricing_from_snapshot(
                        db,
                        plan_key=saas_plan_key,
                        metadata=metadata,
                        require_public_plan=False,
                    )
                    owner_user_id = str(metadata.get("owner_user_id") or "").strip()
                    try:
                        owner_uuid = UUID(owner_user_id) if owner_user_id else None
                    except ValueError:
                        owner_uuid = None
                    tenant_id = str(metadata.get("tenant_id", "")).strip()
                    try:
                        tenant_uuid = UUID(tenant_id) if tenant_id else None
                    except ValueError:
                        tenant_uuid = None
                    tenant = await db.get(Tenant, tenant_uuid) if tenant_uuid else None
                    if tenant is not None:
                        _starts, _expires = await _payment_dates_from_metadata(db, metadata, tenant)
                        await record_platform_billing_payment(
                            db,
                            tenant_id=tenant.id,
                            user_id=owner_uuid,
                            created_by=owner_uuid,
                            pricing=pricing,
                            payment_method=PaymentMethod.FINTOC,
                            external_reference=str(event_data.get("id") or ""),
                            starts_at=_starts,
                            expires_at=_expires,
                            metadata=metadata,
                        )
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
                    payment_method=PaymentMethod.FINTOC,
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


@platform_router.get("/feedback", response_model=PaginatedResponse)
async def list_platform_feedback(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=200),
    category: str | None = Query(None, pattern=r"^(suggestion|improvement|problem|other)$"),
    tenant_id: UUID | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    has_image: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="El rango de fechas es inválido")

    author = aliased(User)
    filters = []
    search_term = (search or "").strip()

    if category:
        filters.append(FeedbackSubmission.category == FeedbackCategory(category))
    if tenant_id:
        filters.append(FeedbackSubmission.tenant_id == tenant_id)
    if date_from:
        filters.append(
            FeedbackSubmission.created_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc)
        )
    if date_to:
        filters.append(
            FeedbackSubmission.created_at
            < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        )
    if has_image is True:
        filters.append(FeedbackSubmission.image_path.is_not(None))
    elif has_image is False:
        filters.append(FeedbackSubmission.image_path.is_(None))
    if search_term:
        like = f"%{search_term}%"
        filters.append(
            or_(
                FeedbackSubmission.message.ilike(like),
                Tenant.name.ilike(like),
                Tenant.slug.ilike(like),
                author.first_name.ilike(like),
                author.last_name.ilike(like),
                author.email.ilike(like),
                func.concat(author.first_name, " ", author.last_name).ilike(like),
            )
        )

    query = (
        select(
            FeedbackSubmission.id.label("id"),
            FeedbackSubmission.tenant_id.label("tenant_id"),
            Tenant.name.label("tenant_name"),
            Tenant.slug.label("tenant_slug"),
            FeedbackSubmission.category.label("category"),
            FeedbackSubmission.message.label("message"),
            FeedbackSubmission.image_path.label("image_path"),
            FeedbackSubmission.created_at.label("created_at"),
            FeedbackSubmission.created_by.label("created_by"),
            author.first_name.label("created_by_first_name"),
            author.last_name.label("created_by_last_name"),
            author.email.label("created_by_email"),
        )
        .select_from(FeedbackSubmission)
        .join(Tenant, Tenant.id == FeedbackSubmission.tenant_id)
        .outerjoin(author, author.id == FeedbackSubmission.created_by)
    )
    count_query = (
        select(func.count())
        .select_from(FeedbackSubmission)
        .join(Tenant, Tenant.id == FeedbackSubmission.tenant_id)
        .outerjoin(author, author.id == FeedbackSubmission.created_by)
    )
    if filters:
        query = query.where(*filters)
        count_query = count_query.where(*filters)

    try:
        total = (await db.execute(count_query)).scalar() or 0
        rows = (
            await db.execute(
                query
                .order_by(FeedbackSubmission.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).all()
    except ProgrammingError as error:
        if _is_missing_table(error, "feedback_submissions"):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="El almacenamiento de feedback aún no está inicializado. Ejecuta las migraciones.",
            ) from error
        raise

    return PaginatedResponse(
        items=[_platform_feedback_payload(row, request) for row in rows],
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
