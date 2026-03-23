"""Public SaaS billing endpoints and platform billing admin tools."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_tenant, require_roles, require_superadmin
from app.schemas.billing import (
    AdminSaaSPlanCreateRequest,
    AdminSaaSPlanResponse,
    AdminSaaSPlanUpdateRequest,
    AdminTenantBillingResponse,
    SaaSPlanResponse,
    SaaSSignupRequest,
    SaaSSignupResponse,
    TenantBillingResponse,
)
from app.schemas.business import PaginatedResponse
from app.services.billing_service import BillingService

router = APIRouter(prefix="/billing", tags=["Billing"])


@router.get("/public/plans", response_model=list[SaaSPlanResponse])
async def list_public_plans(db: AsyncSession = Depends(get_db)):
    return await BillingService.list_public_plans(db)


@router.post("/signup", response_model=SaaSSignupResponse, status_code=201)
async def signup_tenant(data: SaaSSignupRequest, db: AsyncSession = Depends(get_db)):
    return await BillingService.signup_tenant(db, data)


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    return await BillingService.handle_stripe_webhook(db, payload, signature)


@router.get("/subscription", response_model=TenantBillingResponse)
async def get_current_subscription(
    tenant=Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin")),
):
    return BillingService.describe_tenant_billing(tenant)


@router.get("/admin/tenants", response_model=PaginatedResponse)
async def list_platform_tenants(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_superadmin()),
):
    result = await BillingService.list_tenants_for_admin(db, page=page, per_page=per_page)
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
