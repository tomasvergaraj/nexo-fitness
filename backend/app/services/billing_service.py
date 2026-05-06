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
        health = await BillingService._compute_tenant_health(db, tenant, owner=owner)

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
            "health_score": health["score"],
            "health_level": health["level"],
            "health_factors": health["factors"],
            "feature_flags_full": feature_flags,
        }

    @staticmethod
    async def _compute_tenant_health(
        db: AsyncSession, tenant: Tenant, *, owner=None
    ) -> dict[str, Any]:
        """Composite tenant health score (0-100) for ops triage.

        Each factor adds positive or negative points to a 100-point baseline.
        ``factors`` returns the breakdown so the UI can show why a score is
        what it is. Score is clamped to [0, 100]."""
        now = datetime.now(timezone.utc)
        factors: list[dict[str, Any]] = []
        score = 100.0

        # 1. Account access
        if not tenant.is_active:
            score -= 35
            factors.append({"key": "blocked", "label": "Acceso bloqueado", "delta": -35, "kind": "critical"})

        # 2. Status
        status_value = tenant.status.value if isinstance(tenant.status, TenantStatus) else str(tenant.status)
        if status_value in {"suspended"}:
            score -= 30
            factors.append({"key": "suspended", "label": "Cuenta suspendida", "delta": -30, "kind": "critical"})
        elif status_value in {"cancelled", "expired"}:
            score -= 50
            factors.append({"key": "cancelled", "label": f"Cuenta {status_value}", "delta": -50, "kind": "critical"})
        elif status_value == "trial":
            factors.append({"key": "trial", "label": "En período de prueba", "delta": 0, "kind": "info"})

        # 3. License expiry proximity
        if tenant.license_expires_at:
            days = (tenant.license_expires_at - now).days
            if days < 0:
                score -= 25
                factors.append({"key": "license_expired", "label": f"Licencia vencida hace {-days}d", "delta": -25, "kind": "critical"})
            elif days <= 7:
                score -= 12
                factors.append({"key": "license_soon", "label": f"Licencia vence en {days}d", "delta": -12, "kind": "warn"})
            elif days <= 30:
                score -= 4
                factors.append({"key": "license_30d", "label": f"Licencia vence en {days}d", "delta": -4, "kind": "info"})
            else:
                factors.append({"key": "license_ok", "label": "Licencia con > 30 días", "delta": 0, "kind": "ok"})
        elif tenant.trial_ends_at:
            days = (tenant.trial_ends_at - now).days
            if days < 0:
                score -= 35
                factors.append({"key": "trial_expired", "label": f"Trial vencido hace {-days}d", "delta": -35, "kind": "critical"})
            elif days <= 2:
                score -= 8
                factors.append({"key": "trial_critical", "label": f"Trial vence en {days}d", "delta": -8, "kind": "warn"})

        # 4. Recent payment activity (last 60 days)
        last_payment = (
            await db.execute(
                select(PlatformBillingPayment.created_at)
                .where(PlatformBillingPayment.tenant_id == tenant.id)
                .order_by(PlatformBillingPayment.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if last_payment:
            days_since_paid = (now - last_payment).days
            if days_since_paid <= 35:
                factors.append({"key": "recent_payment", "label": f"Pago reciente ({days_since_paid}d)", "delta": 0, "kind": "ok"})
            elif days_since_paid <= 90:
                score -= 5
                factors.append({"key": "stale_payment", "label": f"Sin pagos hace {days_since_paid}d", "delta": -5, "kind": "warn"})
            else:
                score -= 12
                factors.append({"key": "old_payment", "label": f"Sin pagos hace {days_since_paid}d", "delta": -12, "kind": "warn"})
        elif status_value == "active":
            score -= 8
            factors.append({"key": "no_payments", "label": "Sin pagos registrados", "delta": -8, "kind": "warn"})

        # 5. Owner has 2FA enabled
        if owner is not None and getattr(owner, "is_2fa_enabled", False):
            factors.append({"key": "owner_2fa", "label": "Owner con 2FA", "delta": 0, "kind": "ok"})
        elif owner is not None:
            score -= 5
            factors.append({"key": "owner_no_2fa", "label": "Owner sin 2FA", "delta": -5, "kind": "info"})

        score = max(0.0, min(100.0, round(score, 1)))
        if score >= 80:
            level = "healthy"
        elif score >= 60:
            level = "watch"
        elif score >= 40:
            level = "at_risk"
        else:
            level = "critical"

        return {"score": score, "level": level, "factors": factors}

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

    @staticmethod
    async def refund_platform_payment(
        db: AsyncSession,
        *,
        payment_id: UUID,
        amount: Optional[Decimal] = None,
        reason: Optional[str] = None,
        method_override: Optional[str] = None,
    ) -> dict[str, Any]:
        """Trigger a refund for a SaaS payment.

        Webpay payments call the Transbank refund endpoint via the existing
        WebpayTransaction record. Transfer / cash / other methods are marked
        as ``manual`` since there's no provider to call. Stripe is stubbed
        until provider integration ships."""
        from app.models.platform import WebpayTransaction
        from app.integrations.payments.webpay_service import webpay_service

        payment = await db.get(PlatformBillingPayment, payment_id)
        if not payment:
            raise ValueError("Pago no encontrado")

        already_refunded = Decimal(payment.refunded_amount or 0)
        max_refundable = Decimal(payment.total_amount or 0) - already_refunded
        if max_refundable <= 0:
            raise ValueError("Pago ya reembolsado en su totalidad")

        amount = (amount if amount is not None else max_refundable)
        if amount <= 0:
            raise ValueError("El monto debe ser mayor a 0")
        if amount > max_refundable:
            raise ValueError(f"Excede el saldo refundable ({max_refundable})")

        method = method_override or (
            payment.payment_method.value
            if hasattr(payment.payment_method, "value")
            else str(payment.payment_method)
        )

        provider_payload: Optional[dict[str, Any]] = None
        new_status = "refunded"
        external_ref: Optional[str] = None

        if method == "webpay":
            wp_token = (payment.external_reference or "").strip()
            if not wp_token:
                raise ValueError("Pago Webpay sin token registrado, no se puede refundir")
            wp_tx = (
                await db.execute(
                    select(WebpayTransaction).where(WebpayTransaction.token == wp_token).limit(1)
                )
            ).scalar_one_or_none()
            if not wp_tx:
                raise ValueError("Transacción Webpay no encontrada para este pago")

            metadata = _loads_dict_safe(wp_tx.metadata_json)
            credentials = webpay_service.credentials_from_metadata(metadata)
            if credentials is None:
                credentials = webpay_service.get_platform_credentials()
            if credentials is None:
                raise ValueError("No hay credenciales Webpay configuradas para refundir")

            try:
                provider_payload = await webpay_service.refund(
                    token=wp_token,
                    amount=int(amount),
                    credentials=credentials,
                )
            except Exception as exc:  # noqa: BLE001
                payment.refund_status = "failed"
                payment.refund_reason = reason
                await db.flush()
                raise ValueError(f"Webpay rechazó el reembolso: {exc}") from exc

            response_type = (provider_payload or {}).get("type", "")
            external_ref = (provider_payload or {}).get("authorization_code") or wp_token
            if str(response_type).upper() == "REVERSED":
                new_status = "refunded"
            elif str(response_type).upper() == "NULLIFIED":
                new_status = "refunded"
            else:
                new_status = "partial" if (already_refunded + amount) < Decimal(payment.total_amount or 0) else "refunded"
        elif method in {"transfer", "cash", "other"}:
            new_status = "manual"
            external_ref = "manual_offline"
        elif method == "stripe":
            raise ValueError("Refunds Stripe aún no integrados")
        else:
            raise ValueError(f"Método de pago no soportado para refunds: {method}")

        payment.refunded_amount = already_refunded + amount
        payment.refunded_at = datetime.now(timezone.utc)
        payment.refund_reason = reason
        payment.refund_external_reference = external_ref
        payment.refund_status = new_status
        await db.flush()
        return {
            "payment_id": str(payment.id),
            "refunded_amount": str(payment.refunded_amount),
            "refund_status": new_status,
            "method": method,
            "provider_payload": provider_payload,
        }

    @staticmethod
    async def get_platform_stats(db: AsyncSession) -> dict[str, Any]:
        """Aggregated metrics for the superadmin platform dashboard.

        Bundles MRR, tenant counts by status, trial conversion, lead funnel,
        12-month revenue series and a list of operational alerts."""
        from app.models.platform import PlatformLead

        now = datetime.now(timezone.utc)
        today_date = now.date()
        last_30d = now - timedelta(days=30)
        next_7d = now + timedelta(days=7)
        next_2d = now + timedelta(days=2)

        # ── Tenant aggregates ────────────────────────────────────────
        status_counts_q = select(Tenant.status, func.count(Tenant.id)).group_by(Tenant.status)
        status_rows = (await db.execute(status_counts_q)).all()
        status_counts: dict[str, int] = {}
        for status_value, count in status_rows:
            key = status_value.value if hasattr(status_value, "value") else str(status_value)
            status_counts[key] = int(count or 0)

        active_tenants = status_counts.get(TenantStatus.ACTIVE.value, 0)
        trial_tenants = status_counts.get(TenantStatus.TRIAL.value, 0)
        suspended_tenants = status_counts.get(TenantStatus.SUSPENDED.value, 0)
        cancelled_tenants = status_counts.get(TenantStatus.CANCELLED.value, 0)
        total_tenants = sum(status_counts.values())

        # Trials expiring soon (next 7d)
        trial_expiring_q = select(func.count(Tenant.id)).where(
            Tenant.status == TenantStatus.TRIAL,
            Tenant.trial_ends_at.is_not(None),
            Tenant.trial_ends_at <= next_7d,
            Tenant.trial_ends_at >= now,
        )
        trials_expiring = int((await db.execute(trial_expiring_q)).scalar() or 0)

        trial_critical_q = select(func.count(Tenant.id)).where(
            Tenant.status == TenantStatus.TRIAL,
            Tenant.trial_ends_at.is_not(None),
            Tenant.trial_ends_at <= next_2d,
            Tenant.trial_ends_at >= now,
        )
        trials_critical = int((await db.execute(trial_critical_q)).scalar() or 0)

        # Active licenses expiring next 7d
        license_expiring_q = select(func.count(Tenant.id)).where(
            Tenant.status == TenantStatus.ACTIVE,
            Tenant.license_expires_at.is_not(None),
            Tenant.license_expires_at <= next_7d,
            Tenant.license_expires_at >= now,
        )
        licenses_expiring = int((await db.execute(license_expiring_q)).scalar() or 0)

        # Conversion rate trial → paid (cohort: tenants whose trial ended ≥ 30d ago)
        cohort_cutoff = now - timedelta(days=30)
        cohort_q = select(func.count(Tenant.id)).where(
            Tenant.trial_ends_at.is_not(None),
            Tenant.trial_ends_at <= now,
            Tenant.created_at >= cohort_cutoff - timedelta(days=60),
        )
        cohort_total = int((await db.execute(cohort_q)).scalar() or 0)
        cohort_active_q = select(func.count(Tenant.id)).where(
            Tenant.trial_ends_at.is_not(None),
            Tenant.trial_ends_at <= now,
            Tenant.created_at >= cohort_cutoff - timedelta(days=60),
            Tenant.status == TenantStatus.ACTIVE,
        )
        cohort_converted = int((await db.execute(cohort_active_q)).scalar() or 0)
        conversion_rate = (cohort_converted / cohort_total * 100.0) if cohort_total > 0 else 0.0

        # ── Revenue ─────────────────────────────────────────────────
        # MRR proxy = sum of payments in last 30 days (CLP)
        mrr_q = select(func.coalesce(func.sum(PlatformBillingPayment.total_amount), 0)).where(
            PlatformBillingPayment.created_at >= last_30d,
            PlatformBillingPayment.currency == "CLP",
        )
        mrr_amount = float((await db.execute(mrr_q)).scalar() or 0)

        prev_30d_start = now - timedelta(days=60)
        prev_mrr_q = select(func.coalesce(func.sum(PlatformBillingPayment.total_amount), 0)).where(
            PlatformBillingPayment.created_at >= prev_30d_start,
            PlatformBillingPayment.created_at < last_30d,
            PlatformBillingPayment.currency == "CLP",
        )
        mrr_prev = float((await db.execute(prev_mrr_q)).scalar() or 0)
        mrr_delta_pct = ((mrr_amount - mrr_prev) / mrr_prev * 100.0) if mrr_prev > 0 else 0.0

        # 12-month revenue series
        series_start = (now.replace(day=1) - timedelta(days=365)).replace(hour=0, minute=0, second=0, microsecond=0)
        series_q = (
            select(
                func.date_trunc("month", PlatformBillingPayment.created_at).label("month"),
                func.coalesce(func.sum(PlatformBillingPayment.total_amount), 0).label("amount"),
            )
            .where(
                PlatformBillingPayment.created_at >= series_start,
                PlatformBillingPayment.currency == "CLP",
            )
            .group_by("month")
            .order_by("month")
        )
        series_rows = (await db.execute(series_q)).all()
        series_map: dict[str, float] = {}
        for row in series_rows:
            month_dt = row.month
            if month_dt is None:
                continue
            key = month_dt.strftime("%Y-%m")
            series_map[key] = float(row.amount or 0)

        # Fill missing months with 0
        mrr_series: list[dict[str, Any]] = []
        cursor = series_start.replace(day=1)
        while cursor <= now:
            key = cursor.strftime("%Y-%m")
            mrr_series.append({"month": key, "amount": series_map.get(key, 0.0)})
            # advance one month
            if cursor.month == 12:
                cursor = cursor.replace(year=cursor.year + 1, month=1)
            else:
                cursor = cursor.replace(month=cursor.month + 1)

        # Payments last 24h (count + total)
        last_24h = now - timedelta(hours=24)
        recent_payments_q = select(func.count(PlatformBillingPayment.id)).where(
            PlatformBillingPayment.created_at >= last_24h,
        )
        recent_payments = int((await db.execute(recent_payments_q)).scalar() or 0)

        # ── Leads funnel ────────────────────────────────────────────
        leads_q = select(PlatformLead.status, func.count(PlatformLead.id)).group_by(PlatformLead.status)
        lead_rows = (await db.execute(leads_q)).all()
        funnel_keys = ["new", "contacted", "qualified", "won", "lost"]
        leads_funnel: dict[str, int] = {k: 0 for k in funnel_keys}
        for status_value, count in lead_rows:
            leads_funnel[str(status_value)] = int(count or 0)
        leads_total = sum(leads_funnel.values())

        # ── Alerts ──────────────────────────────────────────────────
        alerts: list[dict[str, Any]] = []
        if trials_critical > 0:
            alerts.append({
                "kind": "warn",
                "title": f"{trials_critical} trial{'s' if trials_critical != 1 else ''} vence{'n' if trials_critical != 1 else ''} en menos de 48 hrs",
                "detail": "Considera enviar recordatorio o extender prueba",
                "cta_to": "/platform/tenants",
                "cta_label": "Revisar",
                "count": trials_critical,
            })
        if trials_expiring > trials_critical:
            remaining = trials_expiring - trials_critical
            alerts.append({
                "kind": "info",
                "title": f"{remaining} trial{'s' if remaining != 1 else ''} vence{'n' if remaining != 1 else ''} en próximos 7 días",
                "detail": "Pipeline de conversión esta semana",
                "cta_to": "/platform/tenants",
                "cta_label": "Revisar",
                "count": remaining,
            })
        if licenses_expiring > 0:
            alerts.append({
                "kind": "warn",
                "title": f"{licenses_expiring} licencia{'s' if licenses_expiring != 1 else ''} activa{'s' if licenses_expiring != 1 else ''} vence{'n' if licenses_expiring != 1 else ''} pronto",
                "detail": "Próximos 7 días — riesgo de churn si no renuevan",
                "cta_to": "/platform/tenants",
                "cta_label": "Revisar",
                "count": licenses_expiring,
            })
        if leads_funnel["new"] > 0:
            alerts.append({
                "kind": "info",
                "title": f"{leads_funnel['new']} lead{'s' if leads_funnel['new'] != 1 else ''} nuevo{'s' if leads_funnel['new'] != 1 else ''} sin contactar",
                "detail": "Esperando primer contacto comercial",
                "cta_to": "/platform/leads",
                "cta_label": "Contactar",
                "count": leads_funnel["new"],
            })

        # ── Cohort retention (12 monthly cohorts × up to 12 months follow-up) ──
        cohort_window_start = (now.replace(day=1) - timedelta(days=365)).replace(hour=0, minute=0, second=0, microsecond=0)
        cohort_q = select(
            func.date_trunc("month", Tenant.created_at).label("cohort_month"),
            Tenant.id,
            Tenant.created_at,
            Tenant.status,
            Tenant.license_expires_at,
        ).where(Tenant.created_at >= cohort_window_start)
        cohort_rows = (await db.execute(cohort_q)).all()

        cohorts: dict[str, dict[str, Any]] = {}
        for row in cohort_rows:
            cohort_dt = row.cohort_month
            if cohort_dt is None:
                continue
            key = cohort_dt.strftime("%Y-%m")
            entry = cohorts.setdefault(key, {"cohort_month": key, "size": 0, "retention": []})
            entry["size"] += 1

        # For each cohort, compute % retained at month offsets 0..N (N = months elapsed)
        def _months_between(start: datetime, end: datetime) -> int:
            return (end.year - start.year) * 12 + (end.month - start.month)

        # Build retention buckets
        for key, entry in cohorts.items():
            year, month = (int(p) for p in key.split("-"))
            cohort_start = datetime(year, month, 1, tzinfo=timezone.utc)
            elapsed = max(0, _months_between(cohort_start, now))
            entry["months_elapsed"] = elapsed
            buckets: list[Optional[float]] = []
            for offset in range(0, min(elapsed, 11) + 1):
                # window_end = cohort_start + (offset+1) months
                target_year = cohort_start.year + ((cohort_start.month + offset - 1) // 12)
                target_month = ((cohort_start.month + offset - 1) % 12) + 1
                if target_month == 12:
                    next_year = target_year + 1
                    next_month = 1
                else:
                    next_year = target_year
                    next_month = target_month + 1
                window_end = datetime(next_year, next_month, 1, tzinfo=timezone.utc)
                # A tenant is "retained at month N" if active at window_end OR license valid through it
                retained = 0
                for r in cohort_rows:
                    if r.cohort_month is None:
                        continue
                    rkey = r.cohort_month.strftime("%Y-%m")
                    if rkey != key:
                        continue
                    # Treat ACTIVE status whose license_expires_at >= window_end as retained
                    license_ok = r.license_expires_at is not None and r.license_expires_at >= window_end
                    if str(r.status).lower().endswith("active") and license_ok:
                        retained += 1
                    elif r.status == TenantStatus.ACTIVE and not r.license_expires_at:
                        # no license expiry yet but active right now → only retained at offsets ≤ elapsed
                        if window_end <= now:
                            retained += 1
                pct = (retained / entry["size"] * 100.0) if entry["size"] > 0 else 0.0
                buckets.append(round(pct, 1))
            entry["retention"] = buckets

        cohort_list = sorted(cohorts.values(), key=lambda e: e["cohort_month"])

        # ── Lead attribution by source ───────────────────────────
        lead_source_q = select(
            PlatformLead.source,
            PlatformLead.status,
            func.count(PlatformLead.id),
        ).group_by(PlatformLead.source, PlatformLead.status)
        lead_source_rows = (await db.execute(lead_source_q)).all()

        sources_map: dict[str, dict[str, Any]] = {}
        for source_value, status_value, count in lead_source_rows:
            src = source_value or "unknown"
            entry = sources_map.setdefault(src, {"source": src, "total": 0, "won": 0, "qualified": 0, "lost": 0, "new": 0, "contacted": 0})
            count_int = int(count or 0)
            entry["total"] += count_int
            status_str = str(status_value or "").lower()
            if status_str in entry:
                entry[status_str] = count_int

        sources_list = sorted(sources_map.values(), key=lambda e: e["total"], reverse=True)
        for entry in sources_list:
            entry["conversion_rate"] = round((entry["won"] / entry["total"] * 100.0), 1) if entry["total"] > 0 else 0.0

        return {
            "metrics": {
                "mrr": mrr_amount,
                "mrr_delta_pct": mrr_delta_pct,
                "active_tenants": active_tenants,
                "trial_tenants": trial_tenants,
                "suspended_tenants": suspended_tenants,
                "cancelled_tenants": cancelled_tenants,
                "total_tenants": total_tenants,
                "trials_expiring_7d": trials_expiring,
                "trials_critical_2d": trials_critical,
                "licenses_expiring_7d": licenses_expiring,
                "conversion_rate": round(conversion_rate, 1),
                "conversion_cohort_size": cohort_total,
                "payments_last_24h": recent_payments,
            },
            "mrr_series": mrr_series,
            "leads_funnel": {**leads_funnel, "total": leads_total},
            "lead_sources": sources_list,
            "cohort_retention": cohort_list,
            "alerts": alerts,
            "as_of": now.isoformat(),
        }


def _loads_dict_safe(raw_value: Optional[str]) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        loaded = json.loads(raw_value)
        return loaded if isinstance(loaded, dict) else {}
    except (TypeError, ValueError):
        return {}
