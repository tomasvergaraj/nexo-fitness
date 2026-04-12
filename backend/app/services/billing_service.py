"""Service layer for public SaaS signup, billing state, and Stripe activation."""

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.security import decode_email_verified_token
from app.integrations.payments.stripe_service import stripe_service
from app.integrations.payments.fintoc_service import fintoc_service
from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.models.user import UserRole
from app.schemas.auth import TenantResponse, UserResponse
from app.schemas.billing import (
    AdminSaaSPlanCreateRequest,
    AdminSaaSPlanResponse,
    AdminSaaSPlanUpdateRequest,
    SaaSPlanResponse,
)
from app.services.auth_service import AuthService
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
        highlighted=False,
    )


def activate_tenant_subscription(
    tenant: Tenant,
    plan: SaaSPlanDefinition,
    *,
    now: Optional[datetime] = None,
    stripe_customer_id: Optional[str] = None,
    stripe_subscription_id: Optional[str] = None,
    period_end: Optional[datetime] = None,
) -> None:
    current_time = now or datetime.now(timezone.utc)
    tenant.status = TenantStatus.ACTIVE
    tenant.is_active = True
    tenant.license_type = plan.license_type
    tenant.trial_ends_at = None
    if period_end:
        tenant.license_expires_at = period_end
    elif plan.license_type == LicenseType.ANNUAL:
        tenant.license_expires_at = current_time + timedelta(days=365)
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

        if plan.checkout_enabled:
            # Siempre usar la URL pública HTTPS para los return URLs de pago
            base_public = settings.public_app_url
            success_url = data.success_url or f"{base_public}/login?{urlencode({'billing': 'success', 'email': owner.email, 'tenant': tenant.slug})}"
            cancel_url = data.cancel_url or f"{base_public}/login?{urlencode({'billing': 'cancelled', 'email': owner.email, 'tenant': tenant.slug})}"
            checkout_provider = plan.checkout_provider

            if checkout_provider == "fintoc":
                # Fintoc: crear checkout session hosted con redirect
                session = await fintoc_service.create_checkout_session(
                    amount=int(plan.price),
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
                    },
                )
                checkout_url = session.get("redirect_url")
                next_action = "redirect_to_checkout"
                message = "Tu cuenta esta lista. Completa el pago para activar tu suscripcion."
            else:
                # Stripe: crear checkout session y redirigir
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
                    price_id=plan.stripe_price_id,
                    customer_id=customer_id,
                    success_url=success_url,
                    cancel_url=cancel_url,
                    metadata={
                        "tenant_id": str(tenant.id),
                        "tenant_slug": tenant.slug,
                        "owner_user_id": str(owner.id),
                        "saas_plan_key": plan.key,
                    },
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
            activate_tenant_subscription(
                tenant,
                plan,
                stripe_customer_id=_stripe_value(stripe_object, "customer"),
                stripe_subscription_id=_stripe_value(stripe_object, "subscription"),
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
    def describe_tenant_billing(tenant: Tenant) -> dict[str, Any]:
        plan = get_effective_plan_for_tenant(tenant)
        owner = next((user for user in tenant.users if user.role == UserRole.OWNER), None)
        feature_flags = get_tenant_feature_flags(tenant)
        platform_features = feature_flags.get("saas_features", [])
        if not isinstance(platform_features, list):
            platform_features = []

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
            "features": platform_features,
            "owner_email": owner.email if owner else None,
            "owner_name": owner.full_name if owner else None,
            "owner_user_id": owner.id if owner else None,
            "created_at": tenant.created_at,
        }

    @staticmethod
    async def list_tenants_for_admin(db: AsyncSession, *, page: int = 1, per_page: int = 20) -> dict[str, Any]:
        count_query = select(func.count()).select_from(Tenant)
        total = (await db.execute(count_query)).scalar() or 0

        query = (
            select(Tenant)
            .options(selectinload(Tenant.users))
            .order_by(Tenant.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        result = await db.execute(query)
        tenants = result.scalars().all()

        return {
            "items": [BillingService.describe_tenant_billing(tenant) for tenant in tenants],
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }
