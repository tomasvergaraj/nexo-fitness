"""Public SaaS billing endpoints and platform billing admin tools."""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_tenant, get_current_user, require_roles, require_superadmin
from app.models.tenant import Tenant, TenantStatus
from app.schemas.billing import (
    AdminTenantManualPaymentRequest,
    AdminTenantManualPaymentResponse,
    AdminSaaSPlanCreateRequest,
    AdminSaaSPlanResponse,
    AdminSaaSPlanUpdateRequest,
    AdminTenantBillingResponse,
    BillingQuoteRequest,
    BillingQuoteResponse,
    InvoiceRecordRequest,
    OwnerPaymentItem,
    PlatformBillingPaymentResponse,
    PlatformPromoCodeCreateRequest,
    PlatformPromoCodeResponse,
    PlatformPromoCodeUpdateRequest,
    ReactivateRequest,
    SaaSPlanResponse,
    SaaSSignupRequest,
    SaaSSignupResponse,
    TenantBillingResponse,
)
from app.schemas.business import PaginatedResponse
from app.services.billing_service import BillingService, get_effective_plan_for_tenant
from app.services.tenant_access_service import (
    create_reactivation_checkout,
    evaluate_tenant_access,
)

router = APIRouter(prefix="/billing", tags=["Billing"])


@router.get("/public/plans", response_model=list[SaaSPlanResponse])
async def list_public_plans(db: AsyncSession = Depends(get_db)):
    return await BillingService.list_public_plans(db)


@router.post("/signup", response_model=SaaSSignupResponse, status_code=201)
async def signup_tenant(data: SaaSSignupRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await BillingService.signup_tenant(db, data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    return await BillingService.handle_stripe_webhook(db, payload, signature)


@router.get("/subscription", response_model=TenantBillingResponse)
async def get_current_subscription(
    db: AsyncSession = Depends(get_db),
    tenant=Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin")),
):
    return await BillingService.describe_tenant_billing(db, tenant)


@router.get("/payments", response_model=PaginatedResponse)
async def list_owner_payments(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    tenant=Depends(get_current_tenant),
    _user=Depends(require_roles("owner")),
):
    result = await BillingService.list_owner_payments(db, tenant.id, page=page, per_page=per_page)
    result["items"] = [OwnerPaymentItem(**item.model_dump()) if hasattr(item, "model_dump") else item for item in result["items"]]
    return result


@router.post("/reactivate")
async def reactivate_or_schedule_plan(
    data: ReactivateRequest,
    db: AsyncSession = Depends(get_db),
    tenant=Depends(get_current_tenant),
    current_user=Depends(get_current_user),
    _user=Depends(require_roles("owner")),
):
    try:
        result = await BillingService.schedule_next_plan(db, tenant, current_user, data)
        await db.commit()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/next-plan", status_code=204)
async def cancel_next_plan(
    db: AsyncSession = Depends(get_db),
    tenant=Depends(get_current_tenant),
    _user=Depends(require_roles("owner")),
):
    await BillingService.cancel_next_plan(db, tenant)
    await db.commit()


@router.get("/admin/platform-stats")
async def get_platform_stats(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    """Aggregated SaaS metrics for the superadmin dashboard."""
    return await BillingService.get_platform_stats(db)


@router.get("/admin/audit-logs")
async def list_audit_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    action: Optional[str] = Query(None, max_length=80),
    target_type: Optional[str] = Query(None, max_length=60),
    target_id: Optional[str] = Query(None, max_length=80),
    severity: Optional[str] = Query(None, max_length=20),
    search: Optional[str] = Query(None, max_length=200),
    since_days: Optional[int] = Query(None, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    """Paginated platform audit log with filters by action / target / severity / actor."""
    from app.services.platform_audit_service import PlatformAuditService
    return await PlatformAuditService.list(
        db,
        page=page,
        per_page=per_page,
        action=action,
        target_type=target_type,
        target_id=target_id,
        severity=severity,
        search=search,
        since_days=since_days,
    )


@router.post("/admin/tenants/{tenant_id}/impersonate")
async def admin_impersonate_tenant_owner(
    tenant_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    superadmin=Depends(require_superadmin()),
):
    """Mint a short-lived owner token for the given tenant.

    The token carries `impersonated_by_user_id` + `impersonated_by_email` so the
    frontend can render the impersonation banner and the action is recorded in
    the audit log."""
    from app.core.security import create_access_token
    from app.models.user import User as _User, UserRole as _UserRole
    from app.services.platform_audit_service import PlatformAuditService

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    owner = (
        await db.execute(
            select(_User).where(
                _User.tenant_id == tenant_id,
                _User.role == _UserRole.OWNER,
                _User.is_active == True,  # noqa: E712
            ).limit(1)
        )
    ).scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=404, detail="Esta cuenta no tiene propietario activo")

    token = create_access_token(
        subject=str(owner.id),
        tenant_id=str(tenant_id),
        role=owner.role.value if hasattr(owner.role, "value") else str(owner.role),
        extra={
            "impersonated_by_user_id": str(superadmin.id) if superadmin else None,
            "impersonated_by_email": superadmin.email if superadmin else None,
            "impersonation_reason": "superadmin_debug",
        },
    )

    await PlatformAuditService.record(
        db,
        actor=superadmin,
        action="tenant.impersonate",
        target_type="tenant",
        target_id=str(tenant_id),
        target_label=tenant.name,
        payload={"owner_user_id": str(owner.id), "owner_email": owner.email},
        severity="critical",
        request=request,
    )

    return {
        "access_token": token,
        "owner_user_id": str(owner.id),
        "owner_email": owner.email,
        "tenant_id": str(tenant_id),
        "tenant_name": tenant.name,
        "expires_in_minutes": 30,
    }


@router.get("/admin/tenants", response_model=PaginatedResponse)
async def list_platform_tenants(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=200),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    result = await BillingService.list_tenants_for_admin(db, page=page, per_page=per_page, search=search)
    result["items"] = [AdminTenantBillingResponse(**item) for item in result["items"]]
    return result


class TenantAccessUpdateRequest(BaseModel):
    is_active: bool
    reason: Optional[str] = None


@router.patch("/admin/tenants/{tenant_id}/access")
async def admin_set_tenant_access(
    tenant_id: UUID,
    data: TenantAccessUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    superadmin=Depends(require_superadmin()),
):
    """Bloquear o desbloquear el acceso de una cuenta SaaS sin tocar billing."""
    from app.services.platform_audit_service import PlatformAuditService

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    tenant.is_active = bool(data.is_active)
    await db.flush()
    await PlatformAuditService.record(
        db,
        actor=superadmin,
        action="tenant.access.set",
        target_type="tenant",
        target_id=str(tenant_id),
        target_label=tenant.name,
        payload={"is_active": tenant.is_active, "reason": data.reason},
        severity="warn" if not tenant.is_active else "info",
        request=request,
        commit=False,
    )
    await db.commit()
    import structlog as _sl
    _sl.get_logger().warning(
        "tenant_access_changed_by_superadmin",
        tenant_id=str(tenant_id),
        is_active=tenant.is_active,
        reason=data.reason,
        actor_user_id=str(superadmin.id) if superadmin else None,
    )
    return {"tenant_id": str(tenant_id), "is_active": tenant.is_active}


@router.post("/admin/tenants/{tenant_id}/owner-password-reset")
async def admin_send_owner_password_reset(
    tenant_id: UUID,
    db: AsyncSession = Depends(get_db),
    superadmin=Depends(require_superadmin()),
):
    """Dispara un email de reset de contraseña al propietario de la cuenta."""
    from app.models.user import User as _User, UserRole as _UserRole
    from app.services.auth_service import AuthService
    from app.integrations.email.email_service import email_service

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    owner = (
        await db.execute(
            select(_User).where(
                _User.tenant_id == tenant_id,
                _User.role == _UserRole.OWNER,
                _User.is_active == True,  # noqa: E712
            ).limit(1)
        )
    ).scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=404, detail="Esta cuenta no tiene propietario activo")

    reset_url = await AuthService.request_password_reset(db, owner.email)
    if not reset_url:
        raise HTTPException(status_code=500, detail="No se pudo generar el enlace")
    sent = await email_service.send_password_reset(to_email=owner.email, reset_url=reset_url)
    import structlog as _sl
    _sl.get_logger().info(
        "tenant_owner_password_reset_dispatched",
        tenant_id=str(tenant_id),
        owner_email=owner.email,
        actor_user_id=str(superadmin.id) if superadmin else None,
    )
    return {"detail": "Correo enviado al propietario.", "owner_email": owner.email, "delivered": bool(sent)}


@router.get("/admin/plans", response_model=list[AdminSaaSPlanResponse])
async def list_platform_plans(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    return await BillingService.list_admin_plans(db)


@router.post("/admin/plans", response_model=AdminSaaSPlanResponse, status_code=201)
async def create_platform_plan(
    data: AdminSaaSPlanCreateRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    return await BillingService.create_admin_plan(db, data)


@router.patch("/admin/plans/{plan_id}", response_model=AdminSaaSPlanResponse)
async def update_platform_plan(
    plan_id: UUID,
    data: AdminSaaSPlanUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    return await BillingService.update_admin_plan(db, plan_id, data)


@router.get("/admin/promo-codes", response_model=list[PlatformPromoCodeResponse])
async def list_platform_promo_codes(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    return await BillingService.list_admin_promo_codes(db)


@router.post("/admin/promo-codes", response_model=PlatformPromoCodeResponse, status_code=201)
async def create_platform_promo_code(
    data: PlatformPromoCodeCreateRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    return await BillingService.create_admin_promo_code(db, data)


@router.patch("/admin/promo-codes/{promo_id}", response_model=PlatformPromoCodeResponse)
async def update_platform_promo_code(
    promo_id: UUID,
    data: PlatformPromoCodeUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    return await BillingService.update_admin_promo_code(db, promo_id, data)


@router.delete("/admin/promo-codes/{promo_id}", status_code=204)
async def delete_platform_promo_code(
    promo_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    await BillingService.delete_admin_promo_code(db, promo_id)


@router.post("/quote", response_model=BillingQuoteResponse)
async def quote_platform_plan(
    data: BillingQuoteRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.is_superadmin or not current_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No aplica")
    return await BillingService.quote_plan(db, data)


@router.get("/admin/tenants/{tenant_id}/payments", response_model=dict)
async def list_admin_tenant_payments(
    tenant_id: UUID,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    return await BillingService.list_admin_tenant_payments(db, tenant_id, page=page, per_page=per_page)


@router.patch("/admin/payments/{payment_id}/invoice", response_model=PlatformBillingPaymentResponse)
async def record_payment_invoice(
    payment_id: UUID,
    data: InvoiceRecordRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    return await BillingService.record_payment_invoice(
        db, payment_id, folio_number=data.folio_number, invoice_date=data.invoice_date
    )


class TenantFeatureFlagsUpdate(BaseModel):
    flags: dict


class EmailTemplateUpsert(BaseModel):
    name: str
    subject: str
    body_html: str
    body_text: Optional[str] = None
    description: Optional[str] = None
    variables: Optional[dict] = None
    is_active: bool = True


class EmailTemplatePreviewRequest(BaseModel):
    context: Optional[dict] = None


@router.get("/admin/email-templates")
async def list_email_templates(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    from app.services.platform_email_template_service import PlatformEmailTemplateService
    return await PlatformEmailTemplateService.list(db)


@router.get("/admin/email-templates/{key}")
async def get_email_template(
    key: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    from app.services.platform_email_template_service import PlatformEmailTemplateService
    template = await PlatformEmailTemplateService.get_by_key(db, key)
    if not template:
        raise HTTPException(status_code=404, detail="Template no encontrado")
    return template


@router.put("/admin/email-templates/{key}")
async def upsert_email_template(
    key: str,
    data: EmailTemplateUpsert,
    request: Request,
    db: AsyncSession = Depends(get_db),
    superadmin=Depends(require_superadmin()),
):
    from app.services.platform_email_template_service import PlatformEmailTemplateService
    from app.services.platform_audit_service import PlatformAuditService

    previous = await PlatformEmailTemplateService.get_by_key(db, key)
    template = await PlatformEmailTemplateService.upsert(
        db,
        key=key,
        name=data.name,
        subject=data.subject,
        body_html=data.body_html,
        body_text=data.body_text,
        description=data.description,
        variables=data.variables,
        is_active=data.is_active,
        updated_by_user_id=superadmin.id if superadmin else None,
    )
    await PlatformAuditService.record(
        db,
        actor=superadmin,
        action="email_template.upsert",
        target_type="email_template",
        target_id=key,
        target_label=data.name,
        payload={
            "before_subject": previous.get("subject") if previous else None,
            "after_subject": data.subject,
            "is_active": data.is_active,
        },
        severity="warn",
        request=request,
        commit=False,
    )
    await db.commit()
    return template


@router.post("/admin/email-templates/{key}/preview")
async def preview_email_template(
    key: str,
    data: EmailTemplatePreviewRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    from app.services.platform_email_template_service import PlatformEmailTemplateService
    template = await PlatformEmailTemplateService.get_by_key(db, key)
    if not template:
        raise HTTPException(status_code=404, detail="Template no encontrado")
    rendered = PlatformEmailTemplateService.render_template(template, data.context or {})
    return {"key": key, **rendered}


@router.patch("/admin/tenants/{tenant_id}/feature-flags")
async def admin_update_tenant_feature_flags(
    tenant_id: UUID,
    data: TenantFeatureFlagsUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    superadmin=Depends(require_superadmin()),
):
    """Reemplaza el blob de feature flags del tenant. Audit logged."""
    from app.services.billing_service import get_tenant_feature_flags, set_tenant_feature_flags
    from app.services.platform_audit_service import PlatformAuditService

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    previous = get_tenant_feature_flags(tenant)
    if not isinstance(data.flags, dict):
        raise HTTPException(status_code=400, detail="flags debe ser un objeto")

    set_tenant_feature_flags(tenant, data.flags)
    await db.flush()
    await PlatformAuditService.record(
        db,
        actor=superadmin,
        action="tenant.feature_flags",
        target_type="tenant",
        target_id=str(tenant_id),
        target_label=tenant.name,
        payload={"before": previous, "after": data.flags},
        severity="warn",
        request=request,
        commit=False,
    )
    await db.commit()
    return {"tenant_id": str(tenant_id), "flags": data.flags}


class PaymentRefundRequest(BaseModel):
    amount: Optional[float] = None
    reason: Optional[str] = None


@router.post("/admin/payments/{payment_id}/refund")
async def admin_refund_platform_payment(
    payment_id: UUID,
    data: PaymentRefundRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    superadmin=Depends(require_superadmin()),
):
    """Reembolsar un pago SaaS — Webpay vía provider, transferencia / cash marcado manual."""
    from decimal import Decimal as _D
    from app.services.platform_audit_service import PlatformAuditService
    from app.models.platform import PlatformBillingPayment as _Payment

    payment_pre = await db.get(_Payment, payment_id)
    if not payment_pre:
        raise HTTPException(status_code=404, detail="Pago no encontrado")

    try:
        result = await BillingService.refund_platform_payment(
            db,
            payment_id=payment_id,
            amount=_D(str(data.amount)) if data.amount is not None else None,
            reason=(data.reason or None),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await PlatformAuditService.record(
        db,
        actor=superadmin,
        action="tenant.refund",
        target_type="payment",
        target_id=str(payment_id),
        target_label=f"{payment_pre.plan_name} · {payment_pre.currency} {payment_pre.total_amount}",
        payload={
            "tenant_id": str(payment_pre.tenant_id),
            "amount": str(result["refunded_amount"]),
            "reason": data.reason,
            "method": result["method"],
            "status": result["refund_status"],
        },
        severity="critical",
        request=request,
    )
    return result


@router.post("/admin/tenants/{tenant_id}/manual-payment", response_model=AdminTenantManualPaymentResponse, status_code=201)
async def register_platform_manual_payment(
    tenant_id: UUID,
    data: AdminTenantManualPaymentRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    _user=Depends(require_superadmin()),
):
    return await BillingService.register_manual_payment(db, tenant_id=tenant_id, data=data, actor=current_user)


@router.get("/status")
async def get_billing_status(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the billing status for the current tenant WITHOUT enforcing access.
    Safe to call even when the subscription is expired — used for the billing wall
    and the trial countdown banner.
    """
    if current_user.is_superadmin or not current_user.tenant_id:
        return {
            "status": "active",
            "is_active": True,
            "allow_access": True,
            "detail": None,
            "days_remaining": None,
            "trial_ends_at": None,
            "license_expires_at": None,
            "checkout_url": None,
            "plan_name": "Administración de plataforma",
        }

    result = await db.execute(
        select(Tenant)
        .options(selectinload(Tenant.users))
        .where(Tenant.id == current_user.tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")

    now = datetime.now(timezone.utc)
    access = evaluate_tenant_access(tenant, now=now)

    days_remaining: int | None = None
    if tenant.status == TenantStatus.TRIAL and tenant.trial_ends_at:
        delta = tenant.trial_ends_at - now
        days_remaining = max(0, delta.days)
    elif tenant.status == TenantStatus.ACTIVE and tenant.license_expires_at:
        delta = tenant.license_expires_at - now
        days_remaining = max(0, delta.days)

    plan = get_effective_plan_for_tenant(tenant)

    return {
        "status": tenant.status.value,
        "is_active": tenant.is_active,
        "allow_access": access.allow_access,
        "detail": access.detail if not access.allow_access else None,
        "days_remaining": days_remaining,
        "trial_ends_at": tenant.trial_ends_at.isoformat() if tenant.trial_ends_at else None,
        "license_expires_at": tenant.license_expires_at.isoformat() if tenant.license_expires_at else None,
        "checkout_url": None,
        "widget_token": None,
        "checkout_provider": plan.checkout_provider,
        "plan_key": plan.key,
        "plan_name": plan.name,
    }


class ReactivateRequest(BaseModel):
    plan_key: Optional[str] = None
    promo_code_id: Optional[UUID] = None


@router.post("/reactivate")
async def reactivate_subscription(
    body: ReactivateRequest = ReactivateRequest(),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generates a checkout URL for subscription renewal.
    Accepts an optional plan_key to switch plans.
    Only available to owners/admins.
    """
    if current_user.is_superadmin or not current_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No aplica")

    result = await db.execute(
        select(Tenant)
        .options(selectinload(Tenant.users))
        .where(Tenant.id == current_user.tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")

    try:
        checkout_url = await create_reactivation_checkout(
            db,
            tenant,
            current_user,
            plan_key=body.plan_key,
            promo_code_id=body.promo_code_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if checkout_url:
        await db.flush()
        return {"checkout_url": checkout_url}

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="No hay checkout disponible para este plan. Contacta a soporte.",
    )
