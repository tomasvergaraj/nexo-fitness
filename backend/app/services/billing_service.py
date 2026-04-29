"""Service layer for public SaaS signup, billing state, and Stripe activation."""

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.security import decode_email_verified_token
from app.models.business import PaymentMethod
from app.integrations.payments.stripe_service import stripe_service
from app.integrations.payments.fintoc_service import fintoc_service
from app.models.platform import PlatformBillingPayment
from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.models.user import User, UserRole
from app.schemas.auth import TenantResponse, UserResponse
from app.schemas.billing import (
    AdminTenantManualPaymentRequest,
    AdminTenantManualPaymentResponse,
    AdminSaaSPlanCreateRequest,
    AdminSaaSPlanResponse,
    AdminSaaSPlanUpdateRequest,
    BillingQuoteRequest,
    BillingQuoteResponse,
    OwnerPaymentItem,
    PlatformBillingPaymentResponse,
    PlatformPromoCodeCreateRequest,
    PlatformPromoCodeResponse,
    PlatformPromoCodeUpdateRequest,
    ReactivateRequest,
    SaaSPlanResponse,
)
from app.services.auth_service import AuthService
from app.services.platform_billing_service import (
    PlatformSaaSPricingResult,
    create_platform_promo_code,
    delete_platform_promo_code,
    list_platform_promo_codes,
    parse_plan_keys,
    pricing_from_snapshot,
    record_platform_billing_payment,
    resolve_platform_saas_quote,
    update_platform_promo_code,
)
from app.services.tenant_access_service import TenantAccessState, evaluate_tenant_access
from app.services.saas_plan_service import (
    SaaSPlanDefinition,
    create_admin_saas_plan,
    get_public_saas_plan_definition,
    get_public_saas_plans,
    list_admin_saas_plan_definitions,
    list_public_saas_plan_definitions,
    plan_to_feature_flags,
    update_admin_saas_plan,
)
from app.services.tenant_quota_service import get_tenant_usage_snapshot
from app.services.webpay_checkout_service import create_platform_webpay_transaction

settings = get_settings()


def get_tenant_feature_flags(tenant: Tenant) -> dict[str, Any]:
    if not tenant.features:
        return {}
    try:
        parsed = json.loads(tenant.features)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def set_tenant_feature_flags(tenant: Tenant, values: dict[str, Any]) -> None:
    current = get_tenant_feature_flags(tenant)
    current.update(values)
    tenant.features = json.dumps(current)


def resolve_tenant_plan_key(tenant: Tenant) -> str:
    features = get_tenant_feature_flags(tenant)
    plan_key = features.get("saas_plan_key")
    if isinstance(plan_key, str) and plan_key:
        return plan_key
    return tenant.license_type.value


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _platform_promo_to_response(promo) -> PlatformPromoCodeResponse:
    return PlatformPromoCodeResponse(
        id=promo.id,
        code=promo.code,
        name=promo.name,
        description=promo.description,
        discount_type=promo.discount_type,
        discount_value=promo.discount_value,
        max_uses=promo.max_uses,
        uses_count=promo.uses_count,
        expires_at=promo.expires_at,
        is_active=promo.is_active,
        plan_keys=parse_plan_keys(promo.plan_keys) or None,
        created_at=promo.created_at,
        updated_at=promo.updated_at,
    )


def _platform_payment_to_response(payment) -> PlatformBillingPaymentResponse:
    return PlatformBillingPaymentResponse(
        id=payment.id,
        tenant_id=payment.tenant_id,
        plan_key=payment.plan_key,
        plan_name=payment.plan_name,
        promo_code_id=payment.promo_code_id,
        base_amount=payment.base_amount,
        promo_discount_amount=payment.promo_discount_amount,
        tax_rate=payment.tax_rate,
        tax_amount=payment.tax_amount,
        total_amount=payment.total_amount,
        currency=payment.currency,
        payment_method=payment.payment_method.value if hasattr(payment.payment_method, "value") else str(payment.payment_method),
        external_reference=payment.external_reference,
        notes=payment.notes,
        paid_at=payment.paid_at,
        starts_at=payment.starts_at,
        expires_at=payment.expires_at,
        created_by=payment.created_by,
        created_at=payment.created_at,
        folio_number=payment.folio_number,
        invoice_status=payment.invoice_status,
        invoice_date=payment.invoice_date,
    )


def _pricing_to_response(pricing: PlatformSaaSPricingResult) -> BillingQuoteResponse:
    return BillingQuoteResponse(
        valid=pricing.valid,
        reason=pricing.reason,
        plan_key=pricing.plan.key if pricing.plan else None,
        plan_name=pricing.plan.name if pricing.plan else None,
        currency=pricing.plan.currency if pricing.plan else None,
        promo_code_id=pricing.promo.id if pricing.promo else None,
        base_price=pricing.base_price,
        promo_discount_amount=pricing.promo_discount_amount,
        taxable_subtotal=pricing.taxable_subtotal,
        tax_rate=pricing.tax_rate,
        tax_amount=pricing.tax_amount,
        total_amount=pricing.total_amount,
    )


def _coerce_anchor_datetime(value: date | datetime | None, fallback: datetime) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    return fallback


def get_effective_plan_for_tenant(tenant: Tenant) -> SaaSPlanDefinition:
    resolved_key = resolve_tenant_plan_key(tenant)
    feature_flags = get_tenant_feature_flags(tenant)
    feature_list = feature_flags.get("saas_features", [])
    if not isinstance(feature_list, list):
        feature_list = []

    try:
        price = Decimal(str(feature_flags.get("saas_plan_price", "0")))
    except (InvalidOperation, TypeError, ValueError):
        price = Decimal("0")

    plan_name = feature_flags.get("saas_plan_name")
    if not isinstance(plan_name, str) or not plan_name.strip():
        plan_name = resolved_key.replace("-", " ").title()

    plan_description = feature_flags.get("saas_plan_description")
    if not isinstance(plan_description, str):
        plan_description = "Plan manual o tenant legado fuera del checkout publico."

    billing_interval = feature_flags.get("billing_interval")
    if not isinstance(billing_interval, str) or not billing_interval:
        billing_interval = "manual" if resolved_key == "perpetual" else resolved_key

    currency = feature_flags.get("saas_currency")
    if not isinstance(currency, str) or not currency:
        currency = tenant.currency

    trial_days_raw = feature_flags.get("trial_days", 0)
    max_members_raw = feature_flags.get("max_members", tenant.max_members or 500)
    max_branches_raw = feature_flags.get("max_branches", tenant.max_branches or 3)
    fintoc_enabled = bool(feature_flags.get("fintoc_enabled", False))
    webpay_enabled = bool(feature_flags.get("webpay_enabled", False))
    fallback_plan = next((plan for plan in get_public_saas_plans() if plan.key == resolved_key), None)
    checkout_enabled = bool(feature_flags.get("checkout_enabled")) or bool(fallback_plan and fallback_plan.checkout_enabled)

    if fallback_plan and "saas_plan_name" not in feature_flags:
        return SaaSPlanDefinition(
            key=fallback_plan.key,
            name=fallback_plan.name,
            description=fallback_plan.description,
            license_type=tenant.license_type,
            price=fallback_plan.price,
            currency=currency or fallback_plan.currency,
            billing_interval=billing_interval or fallback_plan.billing_interval,
            trial_days=_coerce_int(trial_days_raw, fallback_plan.trial_days),
            max_members=_coerce_int(max_members_raw, fallback_plan.max_members),
            max_branches=_coerce_int(max_branches_raw, fallback_plan.max_branches),
            features=tuple(str(feature) for feature in (feature_list or list(fallback_plan.features))),
            stripe_price_id=fallback_plan.stripe_price_id if checkout_enabled else "",
            fintoc_enabled=fintoc_enabled or fallback_plan.fintoc_enabled,
            webpay_enabled=webpay_enabled or fallback_plan.webpay_enabled,
            highlighted=fallback_plan.highlighted,
        )

    return SaaSPlanDefinition(
        key=resolved_key,
        name=plan_name,
        description=plan_description,
        license_type=tenant.license_type,
        price=price,
        currency=currency,
        billing_interval=billing_interval,
        trial_days=_coerce_int(trial_days_raw, 0),
        max_members=_coerce_int(max_members_raw, 500),
        max_branches=_coerce_int(max_branches_raw, 3),
        features=tuple(str(feature) for feature in feature_list),
        stripe_price_id=fallback_plan.stripe_price_id if checkout_enabled and fallback_plan else "",
        fintoc_enabled=fintoc_enabled,
        webpay_enabled=webpay_enabled,
        highlighted=False,
    )


def activate_tenant_subscription(
    tenant: Tenant,
    plan: SaaSPlanDefinition,
    *,
    now: Optional[datetime] = None,
    starts_at: date | datetime | None = None,
    stripe_customer_id: Optional[str] = None,
    stripe_subscription_id: Optional[str] = None,
    period_end: Optional[datetime] = None,
) -> None:
    current_time = _coerce_anchor_datetime(starts_at, now or datetime.now(timezone.utc))
    tenant.status = TenantStatus.ACTIVE
    tenant.is_active = True
    tenant.license_type = plan.license_type
    tenant.trial_ends_at = None
    if period_end:
        tenant.license_expires_at = period_end
    elif plan.license_type == LicenseType.ANNUAL:
        tenant.license_expires_at = current_time + timedelta(days=365)
    elif plan.license_type == LicenseType.SEMI_ANNUAL:
        tenant.license_expires_at = current_time + timedelta(days=180)
    elif plan.license_type == LicenseType.QUARTERLY:
        tenant.license_expires_at = current_time + timedelta(days=90)
    elif plan.license_type == LicenseType.PERPETUAL:
        tenant.license_expires_at = None
    else:
        tenant.license_expires_at = current_time + timedelta(days=30)
    tenant.max_members = plan.max_members
    tenant.max_branches = plan.max_branches
    if stripe_customer_id:
        tenant.stripe_customer_id = stripe_customer_id
    if stripe_subscription_id:
        tenant.stripe_subscription_id = stripe_subscription_id
    set_tenant_feature_flags(
        tenant,
        {
            **plan_to_feature_flags(plan),
            "billing_status": TenantStatus.ACTIVE.value,
        },
    )


def suspend_tenant_subscription(tenant: Tenant, *, status: TenantStatus = TenantStatus.SUSPENDED) -> None:
    tenant.status = status
    tenant.is_active = False
    set_tenant_feature_flags(tenant, {"billing_status": status.value})


def _stripe_value(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def _stripe_metadata(data: Any) -> dict[str, Any]:
    metadata = _stripe_value(data, "metadata", {})
    return metadata if isinstance(metadata, dict) else {}


def _stripe_timestamp_to_datetime(timestamp: Optional[int]) -> Optional[datetime]:
    if not timestamp:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)


def _extract_invoice_period_end(invoice: Any) -> Optional[datetime]:
    lines = _stripe_value(invoice, "lines", {})
    line_items = _stripe_value(lines, "data", []) or []
    if not line_items:
        return None

    period = _stripe_value(line_items[0], "period", {})
    return _stripe_timestamp_to_datetime(_stripe_value(period, "end"))


class BillingService:
    @staticmethod
    async def list_public_plans(db: AsyncSession) -> list[SaaSPlanResponse]:
        plans = await list_public_saas_plan_definitions(db)
        return [plan.to_schema() for plan in plans]

    @staticmethod
    async def list_admin_plans(db: AsyncSession) -> list[AdminSaaSPlanResponse]:
        plans = await list_admin_saas_plan_definitions(db)
        return [plan.to_admin_schema() for plan in plans]

    @staticmethod
    async def create_admin_plan(
        db: AsyncSession,
        data: AdminSaaSPlanCreateRequest,
    ) -> AdminSaaSPlanResponse:
        plan = await create_admin_saas_plan(db, data)
        return plan.to_admin_schema()

    @staticmethod
    async def update_admin_plan(
        db: AsyncSession,
        plan_id: UUID,
        data: AdminSaaSPlanUpdateRequest,
    ) -> AdminSaaSPlanResponse:
        plan = await update_admin_saas_plan(db, plan_id, data)
        return plan.to_admin_schema()

    @staticmethod
    async def list_admin_promo_codes(db: AsyncSession) -> list[PlatformPromoCodeResponse]:
        promos = await list_platform_promo_codes(db)
        return [_platform_promo_to_response(promo) for promo in promos]

    @staticmethod
    async def create_admin_promo_code(
        db: AsyncSession,
        data: PlatformPromoCodeCreateRequest,
    ) -> PlatformPromoCodeResponse:
        promo = await create_platform_promo_code(
            db,
            code=data.code,
            name=data.name,
            description=data.description,
            discount_type=data.discount_type,
            discount_value=Decimal(str(data.discount_value)),
            max_uses=data.max_uses,
            expires_at=data.expires_at,
            is_active=data.is_active,
            plan_keys=data.plan_keys,
        )
        return _platform_promo_to_response(promo)

    @staticmethod
    async def update_admin_promo_code(
        db: AsyncSession,
        promo_id: UUID,
        data: PlatformPromoCodeUpdateRequest,
    ) -> PlatformPromoCodeResponse:
        payload = data.model_dump(exclude_unset=True)
        promo = await update_platform_promo_code(
            db,
            promo_id=promo_id,
            name=payload.get("name"),
            description=payload.get("description"),
            description_provided="description" in payload,
            discount_type=payload.get("discount_type"),
            discount_value=Decimal(str(payload["discount_value"])) if "discount_value" in payload and payload["discount_value"] is not None else None,
            max_uses=payload.get("max_uses"),
            max_uses_provided="max_uses" in payload,
            expires_at=payload.get("expires_at"),
            expires_at_provided="expires_at" in payload,
            is_active=payload.get("is_active"),
            plan_keys=payload.get("plan_keys"),
            plan_keys_provided="plan_keys" in payload,
        )
        return _platform_promo_to_response(promo)

    @staticmethod
    async def delete_admin_promo_code(db: AsyncSession, promo_id: UUID) -> None:
        await delete_platform_promo_code(db, promo_id=promo_id)

    @staticmethod
    async def quote_plan(db: AsyncSession, data: BillingQuoteRequest) -> BillingQuoteResponse:
        pricing = await resolve_platform_saas_quote(
            db,
            plan_key=data.plan_key,
            promo_code=data.promo_code,
            promo_code_id=data.promo_code_id,
            require_public_plan=True,
        )
        return _pricing_to_response(pricing)

    @staticmethod
    async def register_manual_payment(
        db: AsyncSession,
        *,
        tenant_id: UUID,
        data: AdminTenantManualPaymentRequest,
        actor: User,
    ) -> AdminTenantManualPaymentResponse:
        result = await db.execute(
            select(Tenant)
            .options(selectinload(Tenant.users))
            .where(Tenant.id == tenant_id)
        )
        tenant = result.scalar_one_or_none()
        if not tenant:
            raise ValueError("Tenant SaaS no encontrado.")

        owner = next((user for user in tenant.users if user.role == UserRole.OWNER), None)
        pricing = await resolve_platform_saas_quote(
            db,
            plan_key=data.plan_key,
            promo_code_id=data.promo_code_id,
            require_public_plan=False,
        )
        if pricing.plan is None:
            raise ValueError(pricing.reason or "No se pudo resolver el plan SaaS.")
        if data.promo_code_id and not pricing.valid:
            raise ValueError(pricing.reason or "No se pudo aplicar el código promocional SaaS.")

        activate_tenant_subscription(
            tenant,
            pricing.plan,
            starts_at=data.starts_at,
        )

        payment = await record_platform_billing_payment(
            db,
            tenant_id=tenant.id,
            user_id=owner.id if owner else None,
            created_by=actor.id,
            pricing=pricing,
            payment_method=PaymentMethod.TRANSFER,
            external_reference=data.transfer_reference,
            starts_at=data.starts_at,
            expires_at=tenant.license_expires_at.date() if tenant.license_expires_at else None,
            notes=data.notes,
            paid_at=datetime.now(timezone.utc),
            metadata={
                "source": "superadmin_manual_payment",
                "tenant_slug": tenant.slug,
                "owner_user_id": str(owner.id) if owner else "",
            },
        )

        return AdminTenantManualPaymentResponse(
            tenant_id=tenant.id,
            tenant_status=tenant.status.value if isinstance(tenant.status, TenantStatus) else str(tenant.status),
            plan_key=pricing.plan.key,
            plan_name=pricing.plan.name,
            license_expires_at=tenant.license_expires_at,
            payment=_platform_payment_to_response(payment),
        )

    @staticmethod
    async def signup_tenant(db: AsyncSession, data) -> dict[str, Any]:
        # Validate email verification token when provided
        verification_token = getattr(data, "verification_token", None)
        if verification_token:
            try:
                verified_email = decode_email_verified_token(verification_token)
            except ValueError as exc:
                raise ValueError(str(exc))
            if verified_email != data.owner_email.lower().strip():
                raise ValueError("El token de verificación no corresponde al correo ingresado.")

        plan = await get_public_saas_plan_definition(db, data.plan_key)
        tenant_status = TenantStatus.TRIAL
        billing_status = TenantStatus.TRIAL.value
        license_expires_at: Optional[datetime] = None

        if not plan.checkout_enabled and plan.trial_days == 0:
            tenant_status = TenantStatus.ACTIVE
            billing_status = TenantStatus.ACTIVE.value
            if plan.license_type == LicenseType.ANNUAL:
                license_expires_at = datetime.now(timezone.utc) + timedelta(days=365)
            elif plan.license_type == LicenseType.MONTHLY:
                license_expires_at = datetime.now(timezone.utc) + timedelta(days=30)

        tenant, owner = await AuthService.provision_tenant(
            db,
            data,
            tenant_status=tenant_status,
            tenant_is_active=True,
            trial_days=plan.trial_days,
            license_type=plan.license_type,
            max_members=plan.max_members,
            max_branches=plan.max_branches,
            license_expires_at=license_expires_at,
            features={
                **plan_to_feature_flags(plan),
                "billing_status": billing_status,
            },
        )
        tokens = AuthService._build_auth_payload(owner)

        checkout_url: Optional[str] = None
        checkout_session_id: Optional[str] = None
        checkout_provider: Optional[str] = None
        widget_token: Optional[str] = None
        next_action = "start_trial" if tenant_status == TenantStatus.TRIAL else "activate_access"
        message = (
            "Tu cuenta quedo creada con trial activo."
            if tenant_status == TenantStatus.TRIAL
            else "Tu cuenta quedo creada con el plan activo."
        )

        if plan.checkout_enabled and plan.trial_days == 0:
            # Siempre usar la URL pública HTTPS para los return URLs de pago
            base_public = settings.public_app_url
            success_url = data.success_url or f"{base_public}/login?{urlencode({'billing': 'success', 'email': owner.email, 'tenant': tenant.slug})}"
            cancel_url = data.cancel_url or f"{base_public}/login?{urlencode({'billing': 'cancelled', 'email': owner.email, 'tenant': tenant.slug})}"
            checkout_provider = plan.checkout_provider
            pricing = await resolve_platform_saas_quote(
                db,
                plan_key=plan.key,
                require_public_plan=True,
            )
            if not pricing.valid or pricing.total_amount is None:
                raise ValueError(pricing.reason or "No se pudo cotizar el plan SaaS.")

            if checkout_provider == "fintoc":
                # Fintoc: crear checkout session hosted con redirect
                session = await fintoc_service.create_checkout_session(
                    amount=int(pricing.total_amount),
                    currency=plan.currency or "CLP",
                    customer_name=owner.full_name,
                    customer_email=owner.email,
                    success_url=success_url,
                    cancel_url=cancel_url,
                    metadata={
                        "tenant_id": str(tenant.id),
                        "tenant_slug": tenant.slug,
                        "owner_user_id": str(owner.id),
                        "saas_plan_key": plan.key,
                        "base_amount": str(pricing.base_price or ""),
                        "promo_discount_amount": str(pricing.promo_discount_amount or ""),
                        "taxable_subtotal": str(pricing.taxable_subtotal or ""),
                        "tax_rate": str(pricing.tax_rate or ""),
                        "tax_amount": str(pricing.tax_amount or ""),
                        "total_amount": str(pricing.total_amount),
                    },
                    recipient_account=None,
                )
                checkout_url = session.get("redirect_url")
                next_action = "redirect_to_checkout"
                message = "Tu cuenta esta lista. Completa el pago para activar tu suscripcion."
            elif checkout_provider == "webpay":
                transaction = await create_platform_webpay_transaction(
                    db,
                    tenant=tenant,
                    user=owner,
                    amount=pricing.total_amount,
                    currency=plan.currency or "CLP",
                    flow_type="saas_signup",
                    flow_reference=plan.key,
                    success_url=success_url,
                    cancel_url=cancel_url,
                    metadata={
                        "tenant_id": str(tenant.id),
                        "tenant_slug": tenant.slug,
                        "owner_user_id": str(owner.id),
                        "owner_email": owner.email,
                        "saas_plan_key": plan.key,
                        "base_amount": str(pricing.base_price or ""),
                        "promo_discount_amount": str(pricing.promo_discount_amount or ""),
                        "taxable_subtotal": str(pricing.taxable_subtotal or ""),
                        "tax_rate": str(pricing.tax_rate or ""),
                        "tax_amount": str(pricing.tax_amount or ""),
                        "total_amount": str(pricing.total_amount),
                    },
                )
                checkout_url = transaction.checkout_url
                checkout_session_id = str(transaction.id)
                next_action = "redirect_to_checkout"
                message = "Tu cuenta esta lista. Completa el pago en Webpay para activar tu suscripción."
            else:
                # Stripe: crear checkout session con monto final y redirigir
                customer_id = await stripe_service.create_customer(
                    email=owner.email,
                    name=owner.full_name,
                    metadata={
                        "tenant_id": str(tenant.id),
                        "tenant_slug": tenant.slug,
                        "owner_user_id": str(owner.id),
                        "saas_plan_key": plan.key,
                    },
                )
                checkout = await stripe_service.create_checkout_session(
                    price_id=plan.stripe_price_id or None,
                    customer_id=customer_id,
                    success_url=success_url,
                    cancel_url=cancel_url,
                    mode="payment",
                    metadata={
                        "tenant_id": str(tenant.id),
                        "tenant_slug": tenant.slug,
                        "owner_user_id": str(owner.id),
                        "saas_plan_key": plan.key,
                        "base_amount": str(pricing.base_price or ""),
                        "promo_discount_amount": str(pricing.promo_discount_amount or ""),
                        "taxable_subtotal": str(pricing.taxable_subtotal or ""),
                        "tax_rate": str(pricing.tax_rate or ""),
                        "tax_amount": str(pricing.tax_amount or ""),
                        "total_amount": str(pricing.total_amount),
                    },
                    amount=int(pricing.total_amount),
                    currency=plan.currency or "CLP",
                    product_name=f"Plan SaaS {plan.name}",
                )
                tenant.stripe_customer_id = customer_id
                checkout_url = checkout["url"]
                checkout_session_id = checkout["session_id"]
                next_action = "redirect_to_checkout"
                message = "Tu trial ya esta listo y te estamos enviando al checkout para activar la suscripcion."

        return {
            "tenant": TenantResponse.model_validate(tenant),
            "user": UserResponse.model_validate(owner),
            **tokens,
            "plan": plan.to_schema(),
            "billing_status": tenant.status.value,
            "checkout_required": bool(checkout_url or widget_token),
            "checkout_url": checkout_url,
            "checkout_session_id": checkout_session_id,
            "checkout_provider": checkout_provider,
            "widget_token": widget_token,
            "next_action": next_action,
            "message": message,
        }

    @staticmethod
    async def _find_tenant_for_billing_event(
        db: AsyncSession,
        *,
        tenant_id: Optional[str] = None,
        stripe_customer_id: Optional[str] = None,
        stripe_subscription_id: Optional[str] = None,
    ) -> Optional[Tenant]:
        if tenant_id:
            try:
                tenant = await db.get(Tenant, UUID(tenant_id))
            except ValueError:
                tenant = None
            if tenant:
                return tenant

        if stripe_subscription_id:
            result = await db.execute(
                select(Tenant).where(Tenant.stripe_subscription_id == stripe_subscription_id)
            )
            tenant = result.scalar_one_or_none()
            if tenant:
                return tenant

        if stripe_customer_id:
            result = await db.execute(
                select(Tenant).where(Tenant.stripe_customer_id == stripe_customer_id)
            )
            return result.scalar_one_or_none()

        return None

    @staticmethod
    async def handle_stripe_webhook(db: AsyncSession, payload: bytes, sig_header: str) -> dict[str, Any]:
        event = await stripe_service.handle_webhook(payload, sig_header)
        event_type = event["type"]
        stripe_object = event["data"]
        metadata = _stripe_metadata(stripe_object)

        tenant = await BillingService._find_tenant_for_billing_event(
            db,
            tenant_id=metadata.get("tenant_id"),
            stripe_customer_id=_stripe_value(stripe_object, "customer"),
            stripe_subscription_id=_stripe_value(stripe_object, "subscription") or _stripe_value(stripe_object, "id"),
        )

        if not tenant:
            return {"received": True, "event": event_type, "matched": False}

        plan = get_effective_plan_for_tenant(tenant)

        if event_type == "checkout.session.completed":
            if metadata.get("queue_after_payment") == "true":
                # Pago anticipado con suscripción activa: encolar en lugar de activar
                plan_key_meta = str(metadata.get("saas_plan_key") or plan.key)
                plan_name_meta = str(metadata.get("saas_plan_name") or plan_key_meta)
                queue_starts_raw = metadata.get("queue_starts_at", "")
                try:
                    queue_starts_at = datetime.fromisoformat(queue_starts_raw) if queue_starts_raw else None
                except ValueError:
                    queue_starts_at = None
                tenant.next_plan_key = plan_key_meta
                tenant.next_plan_name = plan_name_meta
                tenant.next_plan_starts_at = queue_starts_at or tenant.license_expires_at
            else:
                activate_tenant_subscription(
                    tenant,
                    plan,
                    stripe_customer_id=_stripe_value(stripe_object, "customer"),
                    stripe_subscription_id=_stripe_value(stripe_object, "subscription"),
                )
            if metadata.get("total_amount"):
                pricing = await pricing_from_snapshot(
                    db,
                    plan_key=str(metadata.get("saas_plan_key") or plan.key),
                    metadata=metadata,
                    require_public_plan=False,
                )
                owner_user_id = metadata.get("owner_user_id")
                try:
                    owner_uuid = UUID(str(owner_user_id)) if owner_user_id else None
                except ValueError:
                    owner_uuid = None
                queue_after = metadata.get("queue_after_payment") == "true"
                queue_starts_raw = metadata.get("queue_starts_at", "")
                try:
                    payment_starts_at = datetime.fromisoformat(queue_starts_raw).date() if queue_after and queue_starts_raw else None
                except ValueError:
                    payment_starts_at = None
                starts_at = payment_starts_at or datetime.now(timezone.utc).date()
                if queue_after and payment_starts_at:
                    queue_plan_def = await get_public_saas_plan_definition(db, str(metadata.get("saas_plan_key") or plan.key))
                    if queue_plan_def:
                        anchor = datetime.combine(payment_starts_at, datetime.min.time()).replace(tzinfo=timezone.utc)
                        if queue_plan_def.license_type == LicenseType.ANNUAL:
                            payment_expires_at: Optional[date] = (anchor + timedelta(days=365)).date()
                        elif queue_plan_def.license_type == LicenseType.SEMI_ANNUAL:
                            payment_expires_at = (anchor + timedelta(days=180)).date()
                        elif queue_plan_def.license_type == LicenseType.QUARTERLY:
                            payment_expires_at = (anchor + timedelta(days=90)).date()
                        elif queue_plan_def.license_type == LicenseType.PERPETUAL:
                            payment_expires_at = None
                        else:
                            payment_expires_at = (anchor + timedelta(days=30)).date()
                    else:
                        payment_expires_at = None
                else:
                    payment_expires_at = tenant.license_expires_at.date() if tenant.license_expires_at else None
                await record_platform_billing_payment(
                    db,
                    tenant_id=tenant.id,
                    user_id=owner_uuid,
                    created_by=owner_uuid,
                    pricing=pricing,
                    payment_method=PaymentMethod.STRIPE,
                    external_reference=str(_stripe_value(stripe_object, "payment_intent") or _stripe_value(stripe_object, "id") or ""),
                    starts_at=starts_at,
                    expires_at=payment_expires_at,
                    metadata=metadata,
                )
        elif event_type == "invoice.payment_succeeded":
            activate_tenant_subscription(
                tenant,
                plan,
                stripe_customer_id=_stripe_value(stripe_object, "customer"),
                stripe_subscription_id=_stripe_value(stripe_object, "subscription"),
                period_end=_extract_invoice_period_end(stripe_object),
            )
        elif event_type == "invoice.payment_failed":
            suspend_tenant_subscription(tenant, status=TenantStatus.SUSPENDED)
        elif event_type == "customer.subscription.deleted":
            suspend_tenant_subscription(tenant, status=TenantStatus.CANCELLED)
        elif event_type == "customer.subscription.updated":
            current_period_end = _stripe_timestamp_to_datetime(_stripe_value(stripe_object, "current_period_end"))
            activate_tenant_subscription(
                tenant,
                plan,
                stripe_customer_id=_stripe_value(stripe_object, "customer"),
                stripe_subscription_id=_stripe_value(stripe_object, "id"),
                period_end=current_period_end,
            )

        await db.flush()
        return {"received": True, "event": event_type, "matched": True}

    @staticmethod
    async def describe_tenant_billing(db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
        plan = get_effective_plan_for_tenant(tenant)
        owner = next((user for user in tenant.users if user.role == UserRole.OWNER), None)
        feature_flags = get_tenant_feature_flags(tenant)
        platform_features = feature_flags.get("saas_features", [])
        if not isinstance(platform_features, list):
            platform_features = []
        usage = await get_tenant_usage_snapshot(db, tenant.id, tenant=tenant)

        return {
            "tenant_id": tenant.id,
            "tenant_name": tenant.name,
            "tenant_slug": tenant.slug,
            "status": tenant.status.value if isinstance(tenant.status, TenantStatus) else str(tenant.status),
            "license_type": tenant.license_type.value if isinstance(tenant.license_type, LicenseType) else str(tenant.license_type),
            "plan_key": plan.key,
            "plan_name": plan.name,
            "currency": tenant.currency,
            "trial_ends_at": tenant.trial_ends_at,
            "license_expires_at": tenant.license_expires_at,
            "stripe_customer_id": tenant.stripe_customer_id,
            "stripe_subscription_id": tenant.stripe_subscription_id,
            "checkout_enabled": plan.checkout_enabled,
            "is_active": tenant.is_active,
            "max_members": tenant.max_members,
            "max_branches": tenant.max_branches,
            "usage_active_clients": usage.active_clients,
            "usage_active_branches": usage.active_branches,
            "remaining_client_slots": usage.remaining_client_slots,
            "remaining_branch_slots": usage.remaining_branch_slots,
            "over_client_limit": usage.over_client_limit,
            "over_branch_limit": usage.over_branch_limit,
            "features": platform_features,
            "owner_email": owner.email if owner else None,
            "owner_name": owner.full_name if owner else None,
            "owner_user_id": owner.id if owner else None,
            "created_at": tenant.created_at,
            "next_plan_key": tenant.next_plan_key,
            "next_plan_name": tenant.next_plan_name,
            "next_plan_starts_at": tenant.next_plan_starts_at,
            "next_plan_paid": await BillingService._has_future_payment(db, tenant),
        }

    @staticmethod
    async def _has_future_payment(db: AsyncSession, tenant: Tenant) -> bool:
        """Returns True if there is a paid payment record whose subscription period starts in the future."""
        if not tenant.next_plan_key:
            return False
        today = datetime.now(timezone.utc).date()
        result = await db.execute(
            select(PlatformBillingPayment.id).where(
                PlatformBillingPayment.tenant_id == tenant.id,
                PlatformBillingPayment.starts_at > today,
            ).limit(1)
        )
        return result.scalar_one_or_none() is not None

    @staticmethod
    async def list_tenants_for_admin(
        db: AsyncSession,
        *,
        page: int = 1,
        per_page: int = 20,
        search: str | None = None,
    ) -> dict[str, Any]:
        search_term = (search or "").strip()
        query = select(Tenant).options(selectinload(Tenant.users))
        count_query = select(func.count()).select_from(Tenant)

        if search_term:
            like = f"%{search_term}%"
            search_filter = or_(
                Tenant.name.ilike(like),
                Tenant.slug.ilike(like),
                Tenant.email.ilike(like),
                Tenant.users.any(
                    and_(
                        User.role == UserRole.OWNER,
                        or_(
                            User.first_name.ilike(like),
                            User.last_name.ilike(like),
                            User.email.ilike(like),
                            func.concat(User.first_name, " ", User.last_name).ilike(like),
                        ),
                    )
                ),
            )
            query = query.where(search_filter)
            count_query = count_query.where(search_filter)

        total = (await db.execute(count_query)).scalar() or 0

        query = (
            query
            .order_by(Tenant.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        result = await db.execute(query)
        tenants = result.scalars().all()
        items: list[dict[str, Any]] = []
        for tenant in tenants:
            items.append(await BillingService.describe_tenant_billing(db, tenant))

        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }

    @staticmethod
    async def list_owner_payments(
        db: AsyncSession,
        tenant_id: UUID,
        *,
        page: int = 1,
        per_page: int = 10,
    ) -> dict[str, Any]:
        from sqlalchemy import desc
        count_q = select(func.count()).select_from(PlatformBillingPayment).where(
            PlatformBillingPayment.tenant_id == tenant_id
        )
        total = (await db.execute(count_q)).scalar() or 0

        rows_q = (
            select(PlatformBillingPayment)
            .where(PlatformBillingPayment.tenant_id == tenant_id)
            .order_by(desc(PlatformBillingPayment.created_at))
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        rows = (await db.execute(rows_q)).scalars().all()

        items = [
            OwnerPaymentItem(
                id=row.id,
                plan_key=row.plan_key,
                plan_name=row.plan_name,
                base_amount=row.base_amount,
                promo_discount_amount=row.promo_discount_amount,
                tax_rate=row.tax_rate,
                tax_amount=row.tax_amount,
                total_amount=row.total_amount,
                currency=row.currency,
                payment_method=row.payment_method.value if hasattr(row.payment_method, "value") else str(row.payment_method),
                external_reference=row.external_reference,
                paid_at=row.paid_at,
                starts_at=row.starts_at,
                expires_at=row.expires_at,
                created_at=row.created_at,
            )
            for row in rows
        ]
        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }

    @staticmethod
    async def list_admin_tenant_payments(
        db: AsyncSession,
        tenant_id: UUID,
        *,
        page: int = 1,
        per_page: int = 20,
    ) -> dict[str, Any]:
        from sqlalchemy import desc
        count_q = select(func.count()).select_from(PlatformBillingPayment).where(
            PlatformBillingPayment.tenant_id == tenant_id
        )
        total = (await db.execute(count_q)).scalar() or 0

        rows_q = (
            select(PlatformBillingPayment)
            .where(PlatformBillingPayment.tenant_id == tenant_id)
            .order_by(desc(PlatformBillingPayment.created_at))
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        rows = (await db.execute(rows_q)).scalars().all()

        items = [_platform_payment_to_response(row) for row in rows]
        return {
            "items": [i.model_dump() for i in items],
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }

    @staticmethod
    async def record_payment_invoice(
        db: AsyncSession,
        payment_id: UUID,
        folio_number: int,
        invoice_date: "date",
    ) -> PlatformBillingPaymentResponse:
        result = await db.execute(
            select(PlatformBillingPayment).where(PlatformBillingPayment.id == payment_id)
        )
        payment = result.scalar_one_or_none()
        if payment is None:
            from fastapi import HTTPException, status as http_status
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Pago no encontrado")

        payment.folio_number = folio_number
        payment.invoice_date = invoice_date
        payment.invoice_status = "manual"
        await db.commit()
        await db.refresh(payment)
        return _platform_payment_to_response(payment)

    @staticmethod
    async def schedule_next_plan(
        db: AsyncSession,
        tenant: Tenant,
        user: "User",
        data: "ReactivateRequest",
    ) -> dict[str, Any]:
        """
        Cuando el tenant está ACTIVO y aún no venció, programa el plan para que
        entre en vigor cuando expire la suscripción actual. Devuelve checkout_url
        si se requiere pago inmediato (checkout), o scheduled=True si es diferido.
        """
        from app.services.tenant_access_service import create_reactivation_checkout
        from app.services.saas_plan_service import get_public_saas_plan_definition

        now = datetime.now(timezone.utc)
        is_active_and_not_expired = (
            tenant.status == TenantStatus.ACTIVE
            and tenant.license_expires_at is not None
            and tenant.license_expires_at > now
        )

        promo_code_id = data.promo_code_id
        if data.promo_code and not promo_code_id:
            from app.services.platform_billing_service import resolve_platform_saas_quote
            pricing = await resolve_platform_saas_quote(
                db, plan_key=data.plan_key, promo_code=data.promo_code, require_public_plan=False
            )
            if pricing.promo:
                promo_code_id = pricing.promo.id

        if is_active_and_not_expired and not data.force_immediate:
            plan_def = await get_public_saas_plan_definition(db, data.plan_key)
            if not plan_def:
                raise ValueError(f"Plan '{data.plan_key}' no encontrado.")
            tenant.next_plan_key = plan_def.key
            tenant.next_plan_name = plan_def.name
            tenant.next_plan_starts_at = tenant.license_expires_at
            await db.flush()
            return {
                "scheduled": True,
                "checkout_url": None,
                "next_plan_key": tenant.next_plan_key,
                "next_plan_name": tenant.next_plan_name,
                "next_plan_starts_at": tenant.next_plan_starts_at,
            }

        # Si el tenant aún está activo (force_immediate=True), encolar tras el pago
        queue_after = is_active_and_not_expired
        checkout_url = await create_reactivation_checkout(
            db,
            tenant,
            user,
            plan_key=data.plan_key,
            promo_code_id=promo_code_id,
            queue_after_payment=queue_after,
            queue_starts_at=tenant.license_expires_at if queue_after else None,
            success_url=data.success_url or None,
            cancel_url=data.cancel_url or None,
        )
        return {
            "scheduled": False,
            "checkout_url": checkout_url,
            "next_plan_key": None,
            "next_plan_name": None,
            "next_plan_starts_at": None,
        }

    @staticmethod
    async def cancel_next_plan(db: AsyncSession, tenant: Tenant) -> None:
        tenant.next_plan_key = None
        tenant.next_plan_name = None
        tenant.next_plan_starts_at = None
        await db.flush()
