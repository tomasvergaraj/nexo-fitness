from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID
from urllib.parse import urlencode

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import ActionRequiredError
from app.integrations.payments.stripe_service import stripe_service
from app.integrations.payments.fintoc_service import fintoc_service
from app.models.platform import SaaSPlan
from app.models.tenant import Tenant, TenantStatus
from app.models.user import User, UserRole
from app.services.platform_billing_service import resolve_platform_saas_quote
from app.services.saas_plan_service import SaaSPlanDefinition, definition_from_record, default_saas_plan_definitions
from app.services.webpay_checkout_service import create_platform_webpay_transaction

settings = get_settings()
logger = structlog.get_logger()


@dataclass(frozen=True)
class TenantAccessState:
    allow_access: bool
    detail: Optional[str] = None
    status_to_apply: Optional[TenantStatus] = None
    deactivate: bool = False


def evaluate_tenant_access(tenant: Tenant, *, now: Optional[datetime] = None) -> TenantAccessState:
    current_time = now or datetime.now(timezone.utc)

    if tenant.status == TenantStatus.TRIAL and tenant.trial_ends_at and tenant.trial_ends_at <= current_time:
        return TenantAccessState(
            allow_access=False,
            detail="Tu período de prueba venció. Completa tu suscripción para seguir usando NexoFitness.",
            status_to_apply=TenantStatus.EXPIRED,
            deactivate=True,
        )

    if tenant.status == TenantStatus.ACTIVE and tenant.license_expires_at and tenant.license_expires_at <= current_time:
        return TenantAccessState(
            allow_access=False,
            detail="Tu suscripción venció. Renueva tu plan para recuperar el acceso.",
            status_to_apply=TenantStatus.EXPIRED,
            deactivate=True,
        )

    if tenant.status == TenantStatus.EXPIRED:
        detail = "Tu suscripción venció. Renueva tu plan para recuperar el acceso."
        if tenant.trial_ends_at and tenant.license_expires_at is None:
            detail = "Tu período de prueba venció. Completa tu suscripción para seguir usando NexoFitness."
        return TenantAccessState(allow_access=False, detail=detail)

    if tenant.status in {TenantStatus.SUSPENDED, TenantStatus.CANCELLED} or not tenant.is_active:
        return TenantAccessState(
            allow_access=False,
            detail="Esta cuenta no está activa. Revisa tu estado de facturación o contacta a soporte.",
        )

    return TenantAccessState(allow_access=True)


def _resolve_plan_key(tenant: Tenant) -> str:
    if tenant.features:
        try:
            features = json.loads(tenant.features)
        except json.JSONDecodeError:
            features = {}
        if isinstance(features, dict):
            plan_key = features.get("saas_plan_key")
            if isinstance(plan_key, str) and plan_key.strip():
                return plan_key.strip().lower()
    return tenant.license_type.value


async def _resolve_checkout_plan_from_db(db: AsyncSession, tenant: Tenant) -> Optional[SaaSPlanDefinition]:
    """Busca el plan en DB primero; cae en defaults si no existe."""
    plan_key = _resolve_plan_key(tenant)
    result = await db.execute(
        select(SaaSPlan).where(
            SaaSPlan.key == plan_key,
            SaaSPlan.is_active.is_(True),
            SaaSPlan.is_public.is_(True),
        )
    )
    record = result.scalar_one_or_none()
    if record:
        plan = definition_from_record(record)
        if plan.checkout_enabled:
            return plan
    # Fallback a defaults hardcoded
    return next(
        (
            plan
            for plan in default_saas_plan_definitions()
            if plan.key == plan_key and plan.is_active and plan.is_public and plan.checkout_enabled
        ),
        None,
    )


def _build_login_return_urls(email: str, tenant_slug: str) -> tuple[str, str]:
    base_url = f"{settings.public_app_url}/login"
    success_url = f"{base_url}?{urlencode({'billing': 'success', 'email': email, 'tenant': tenant_slug})}"
    cancel_url = f"{base_url}?{urlencode({'billing': 'cancelled', 'email': email, 'tenant': tenant_slug})}"
    return success_url, cancel_url


async def create_reactivation_checkout(
    db: AsyncSession,
    tenant: Tenant,
    user: User,
    *,
    plan_key: Optional[str] = None,
    promo_code_id: Optional[UUID] = None,
    queue_after_payment: bool = False,
    queue_starts_at: Optional[datetime] = None,
    success_url: Optional[str] = None,
    cancel_url: Optional[str] = None,
) -> Optional[str]:
    """
    Genera URL de checkout para reactivar la suscripción.
    Si queue_after_payment=True, el webhook encola el plan en lugar de activarlo
    de inmediato (útil cuando el tenant aún tiene suscripción vigente).
    """
    if user.role not in {UserRole.OWNER, UserRole.ADMIN}:
        return None

    if plan_key:
        # Plan override: buscar el plan solicitado directamente
        result = await db.execute(
            select(SaaSPlan).where(
                SaaSPlan.key == plan_key,
                SaaSPlan.is_active.is_(True),
                SaaSPlan.is_public.is_(True),
            )
        )
        record = result.scalar_one_or_none()
        plan = definition_from_record(record) if record else None
        if not plan or not plan.checkout_enabled:
            return None
    else:
        plan = await _resolve_checkout_plan_from_db(db, tenant)

    if not plan:
        return None

    pricing = await resolve_platform_saas_quote(
        db,
        plan_key=plan.key,
        promo_code_id=promo_code_id,
        require_public_plan=False,
    )
    if pricing.plan is None or pricing.total_amount is None:
        raise ValueError(pricing.reason or "No se pudo cotizar el plan SaaS.")
    if promo_code_id and not pricing.valid:
        raise ValueError(pricing.reason or "No se pudo aplicar el código promocional SaaS.")

    provider = plan.checkout_provider
    if not provider:
        return None
    _default_success, _default_cancel = _build_login_return_urls(user.email, tenant.slug)
    success_url = success_url or _default_success
    cancel_url = cancel_url or _default_cancel

    _queue_meta: dict[str, str] = {
        "queue_after_payment": "true" if queue_after_payment else "false",
        "queue_starts_at": queue_starts_at.isoformat() if queue_starts_at else "",
        "saas_plan_name": plan.name,
    }

    if provider == "fintoc":
        return await create_reactivation_fintoc_checkout(
            db, tenant, user, plan=plan, promo_code_id=promo_code_id,
            extra_metadata=_queue_meta, success_url=success_url, cancel_url=cancel_url,
        )
    if provider == "webpay":
        transaction = await create_platform_webpay_transaction(
            db,
            tenant=tenant,
            user=user,
            amount=pricing.total_amount,
            currency=plan.currency or "CLP",
            flow_type="saas_reactivation",
            flow_reference=plan.key,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "tenant_id": str(tenant.id),
                "tenant_slug": tenant.slug,
                "owner_user_id": str(user.id),
                "owner_email": user.email,
                "saas_plan_key": plan.key,
                "promo_code_id": str(pricing.promo.id) if pricing.promo else "",
                "base_amount": str(pricing.base_price or ""),
                "promo_discount_amount": str(pricing.promo_discount_amount or ""),
                "taxable_subtotal": str(pricing.taxable_subtotal or ""),
                "tax_rate": str(pricing.tax_rate or ""),
                "tax_amount": str(pricing.tax_amount or ""),
                "total_amount": str(pricing.total_amount),
                **_queue_meta,
            },
        )
        await db.flush()
        return transaction.checkout_url

    # Stripe
    customer_id = tenant.stripe_customer_id
    if not customer_id:
        customer_id = await stripe_service.create_customer(
            email=user.email,
            name=user.full_name,
            metadata={
                "tenant_id": str(tenant.id),
                "tenant_slug": tenant.slug,
                "owner_user_id": str(user.id),
                "saas_plan_key": plan.key,
            },
        )
        tenant.stripe_customer_id = customer_id

    checkout = await stripe_service.create_checkout_session(
        price_id=plan.stripe_price_id or None,
        customer_id=customer_id,
        success_url=success_url,
        cancel_url=cancel_url,
        mode="payment",
        metadata={
            "tenant_id": str(tenant.id),
            "tenant_slug": tenant.slug,
            "owner_user_id": str(user.id),
            "saas_plan_key": plan.key,
            "promo_code_id": str(pricing.promo.id) if pricing.promo else "",
            "base_amount": str(pricing.base_price or ""),
            "promo_discount_amount": str(pricing.promo_discount_amount or ""),
            "taxable_subtotal": str(pricing.taxable_subtotal or ""),
            "tax_rate": str(pricing.tax_rate or ""),
            "tax_amount": str(pricing.tax_amount or ""),
            "total_amount": str(pricing.total_amount),
            **_queue_meta,
        },
        amount=int(pricing.total_amount),
        currency=plan.currency or "CLP",
        product_name=f"Plan SaaS {plan.name}",
    )
    await db.flush()
    return checkout["url"]


async def create_reactivation_fintoc_checkout(
    db: AsyncSession,
    tenant: Tenant,
    user: User,
    *,
    plan: Optional[SaaSPlanDefinition] = None,
    promo_code_id: Optional[UUID] = None,
    extra_metadata: Optional[dict[str, str]] = None,
    success_url: Optional[str] = None,
    cancel_url: Optional[str] = None,
) -> Optional[str]:
    """
    Crea una Checkout Session de Fintoc para reactivar la suscripción.
    Retorna la redirect_url para llevar al usuario al checkout hosted de Fintoc.
    """
    if user.role not in {UserRole.OWNER, UserRole.ADMIN}:
        return None

    if plan is None:
        plan = await _resolve_checkout_plan_from_db(db, tenant)
    if not plan or plan.checkout_provider != "fintoc":
        return None

    pricing = await resolve_platform_saas_quote(
        db,
        plan_key=plan.key,
        promo_code_id=promo_code_id,
        require_public_plan=False,
    )
    if pricing.plan is None or pricing.total_amount is None:
        raise ValueError(pricing.reason or "No se pudo cotizar el plan SaaS.")
    if promo_code_id and not pricing.valid:
        raise ValueError(pricing.reason or "No se pudo aplicar el código promocional SaaS.")

    _default_success, _default_cancel = _build_login_return_urls(user.email, tenant.slug)
    success_url = success_url or _default_success
    cancel_url = cancel_url or _default_cancel
    session = await fintoc_service.create_checkout_session(
        amount=int(pricing.total_amount),
        currency=plan.currency or "CLP",
        customer_name=user.full_name,
        customer_email=user.email,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "tenant_id": str(tenant.id),
            "tenant_slug": tenant.slug,
            "owner_user_id": str(user.id),
            "saas_plan_key": plan.key,
            "promo_code_id": str(pricing.promo.id) if pricing.promo else "",
            "base_amount": str(pricing.base_price or ""),
            "promo_discount_amount": str(pricing.promo_discount_amount or ""),
            "taxable_subtotal": str(pricing.taxable_subtotal or ""),
            "tax_rate": str(pricing.tax_rate or ""),
            "tax_amount": str(pricing.tax_amount or ""),
            "total_amount": str(pricing.total_amount),
            **(extra_metadata or {}),
        },
        recipient_account=None,
    )
    return session.get("redirect_url")


async def enforce_tenant_access(
    db: AsyncSession,
    tenant: Tenant,
    user: User,
    *,
    now: Optional[datetime] = None,
) -> None:
    access_state = evaluate_tenant_access(tenant, now=now)
    if access_state.allow_access:
        return

    original_status = tenant.status
    if access_state.status_to_apply:
        tenant.status = access_state.status_to_apply
    if access_state.deactivate:
        tenant.is_active = False

    checkout_url: Optional[str] = None
    renewable_statuses = {TenantStatus.TRIAL, TenantStatus.ACTIVE, TenantStatus.EXPIRED}
    if original_status in renewable_statuses or tenant.status in renewable_statuses:
        try:
            checkout_url = await create_reactivation_checkout(db, tenant, user)
        except Exception as exc:
            logger.warning(
                "tenant_reactivation_checkout_failed",
                tenant_id=str(tenant.id),
                user_id=str(user.id),
                error=str(exc),
            )

    await db.flush()
    raise ActionRequiredError(
        access_state.detail or "Esta cuenta no está activa. Revisa tu estado de facturación o contacta a soporte.",
        next_action="billing_required",
        checkout_url=checkout_url,
        billing_status=tenant.status.value if isinstance(tenant.status, TenantStatus) else str(tenant.status),
        tenant_slug=tenant.slug,
    )
