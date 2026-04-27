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
    OwnerPaymentItem,
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
