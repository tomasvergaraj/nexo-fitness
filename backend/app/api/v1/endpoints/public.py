"""Public storefront and platform commercial endpoints."""

import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import ProgrammingError

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import require_superadmin
from app.models.business import Branch, ClassStatus, GymClass, Plan
from app.models.platform import PlatformLead, TenantPaymentProviderAccount
from app.models.tenant import Tenant
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
from app.services.public_checkout_service import build_public_checkout_urls, build_storefront_return_urls

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
        raise HTTPException(status_code=404, detail="Tenant storefront not found")
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


@public_router.get("/tenants/{slug}/profile", response_model=TenantPublicProfileResponse)
async def get_tenant_public_profile(slug: str, db: AsyncSession = Depends(get_db)):
    tenant = await _get_public_tenant_or_404(db, slug)
    features = _loads_dict(tenant.features)
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
            "primary_color": tenant.primary_color,
            "custom_domain": tenant.custom_domain,
            "support_email": str(features.get("support_email", tenant.email)),
            "support_phone": str(features.get("support_phone", tenant.phone or "")) or None,
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
    return [GymClassResponse.model_validate(item) for item in classes]


@public_router.post("/tenants/{slug}/checkout-session", response_model=PublicCheckoutSessionResponse)
async def create_public_checkout_session(
    slug: str,
    data: PublicCheckoutSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_public_tenant_or_404(db, slug)
    plan = await db.get(Plan, data.plan_id)
    if not plan or plan.tenant_id != tenant.id or not plan.is_active or plan.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Plan not available")

    account = await _get_default_payment_account(db, tenant.id)
    if not account:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tenant has no connected payment account")

    session_reference = f"{tenant.slug}-{plan.id}-{uuid4().hex[:10]}"
    checkout_base = account.checkout_base_url or f"https://checkout.nexofitness.cl/{tenant.slug}"
    success_url, cancel_url = build_storefront_return_urls(settings.FRONTEND_URL, tenant.slug)
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
                detail="Platform leads storage is not initialized. Run migrations.",
            ) from error
        raise
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(lead, field, value)

    await db.flush()
    await db.refresh(lead)
    return _lead_payload(lead)
