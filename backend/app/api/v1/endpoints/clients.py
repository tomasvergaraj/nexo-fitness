"""Clients, Plans, and Payments API endpoints."""

import json
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_tenant_context, TenantContext, require_roles, get_current_user
from app.core.security import hash_password, verify_password
from app.models.user import User, UserRole
from app.models.business import Plan, Membership, Payment, PaymentStatus
from app.schemas.auth import UserCreate, UserUpdate, UserResponse, UserDetailResponse, ClientListResponse
from app.schemas.business import (
    PlanCreate, PlanUpdate, PlanResponse,
    PaymentCreate, PaymentResponse,
    PaginatedResponse,
)

# ─── Clients Router ──────────────────────────────────────────────────────────

clients_router = APIRouter(prefix="/clients", tags=["Clients"])


@clients_router.get("", response_model=ClientListResponse)
async def list_clients(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    tag: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer", "marketing")),
):
    base = select(User).where(User.tenant_id == ctx.tenant_id, User.role == UserRole.CLIENT)
    count_base = select(func.count()).select_from(User).where(User.tenant_id == ctx.tenant_id, User.role == UserRole.CLIENT)

    if search:
        search_filter = or_(
            User.first_name.ilike(f"%{search}%"),
            User.last_name.ilike(f"%{search}%"),
            User.email.ilike(f"%{search}%"),
            User.phone.ilike(f"%{search}%"),
        )
        base = base.where(search_filter)
        count_base = count_base.where(search_filter)

    if status_filter == "active":
        base = base.where(User.is_active == True)
        count_base = count_base.where(User.is_active == True)
    elif status_filter == "inactive":
        base = base.where(User.is_active == False)
        count_base = count_base.where(User.is_active == False)

    total = (await db.execute(count_base)).scalar() or 0
    query = base.order_by(User.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    clients = result.scalars().all()

    return ClientListResponse(
        items=[UserResponse.model_validate(c) for c in clients],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@clients_router.post("", response_model=UserResponse, status_code=201)
async def create_client(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        tenant_id=ctx.tenant_id,
        email=data.email,
        hashed_password=hash_password(data.password),
        first_name=data.first_name,
        last_name=data.last_name,
        phone=data.phone,
        role=UserRole.CLIENT,
        date_of_birth=data.date_of_birth,
        gender=data.gender,
        emergency_contact=data.emergency_contact,
        emergency_phone=data.emergency_phone,
        medical_notes=data.medical_notes,
        tags=json.dumps(data.tags) if data.tags else None,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@clients_router.get("/{client_id}", response_model=UserDetailResponse)
async def get_client(
    client_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer", "marketing")),
):
    result = await db.execute(
        select(User).where(User.id == client_id, User.tenant_id == ctx.tenant_id)
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return UserDetailResponse.model_validate(client)


@clients_router.patch("/{client_id}", response_model=UserResponse)
async def update_client(
    client_id: UUID,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    result = await db.execute(
        select(User).where(User.id == client_id, User.tenant_id == ctx.tenant_id)
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    update_data = data.model_dump(exclude_unset=True)

    # Validar unicidad de email si se está cambiando
    if "email" in update_data and update_data["email"] and update_data["email"] != client.email:
        existing = await db.execute(
            select(User).where(User.email == update_data["email"], User.id != client_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="El correo ya está registrado por otro usuario")

    if "tags" in update_data and update_data["tags"] is not None:
        update_data["tags"] = json.dumps(update_data["tags"])
    for field, value in update_data.items():
        setattr(client, field, value)

    await db.flush()
    await db.refresh(client)
    return UserResponse.model_validate(client)


@clients_router.post("/{client_id}/reset-password", status_code=204)
async def reset_client_password(
    client_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    new_password = data.get("new_password", "")
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=422, detail="La contraseña debe tener al menos 6 caracteres")

    result = await db.execute(
        select(User).where(User.id == client_id, User.tenant_id == ctx.tenant_id)
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    client.hashed_password = hash_password(new_password)
    client.refresh_token = None  # invalidar sesiones activas
    await db.flush()


# ─── Plans Router ─────────────────────────────────────────────────────────────

plans_router = APIRouter(prefix="/plans", tags=["Plans"])


@plans_router.get("", response_model=PaginatedResponse)
async def list_plans(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
):
    query = select(Plan).where(Plan.tenant_id == ctx.tenant_id, Plan.deleted_at == None)
    if active_only:
        query = query.where(Plan.is_active == True)
    query = query.order_by(Plan.sort_order, Plan.price)
    result = await db.execute(query)
    plans = result.scalars().all()
    return PaginatedResponse(
        items=[PlanResponse.model_validate(p) for p in plans],
        total=len(plans),
        page=1,
        per_page=100,
        pages=1,
    )


@plans_router.post("", response_model=PlanResponse, status_code=201)
async def create_plan(
    data: PlanCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    plan = Plan(
        tenant_id=ctx.tenant_id,
        name=data.name,
        description=data.description,
        price=data.price,
        currency=data.currency,
        duration_type=data.duration_type,
        duration_days=data.duration_days,
        max_reservations_per_week=data.max_reservations_per_week,
        max_reservations_per_month=data.max_reservations_per_month,
        allowed_class_types=json.dumps(data.allowed_class_types) if data.allowed_class_types else None,
        allowed_branches=json.dumps(data.allowed_branches) if data.allowed_branches else None,
        benefits=json.dumps(data.benefits) if data.benefits else None,
        is_featured=data.is_featured,
        auto_renew=data.auto_renew,
    )
    db.add(plan)
    await db.flush()
    await db.refresh(plan)
    return PlanResponse.model_validate(plan)


@plans_router.patch("/{plan_id}", response_model=PlanResponse)
async def update_plan(
    plan_id: UUID,
    data: PlanUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(Plan).where(Plan.id == plan_id, Plan.tenant_id == ctx.tenant_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)

    await db.flush()
    await db.refresh(plan)
    return PlanResponse.model_validate(plan)


# ─── Payments Router ──────────────────────────────────────────────────────────

payments_router = APIRouter(prefix="/payments", tags=["Payments"])


@payments_router.get("", response_model=PaginatedResponse)
async def list_payments(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    user_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    query = select(Payment).where(Payment.tenant_id == ctx.tenant_id)
    count_q = select(func.count()).select_from(Payment).where(Payment.tenant_id == ctx.tenant_id)

    if status_filter:
        query = query.where(Payment.status == status_filter)
        count_q = count_q.where(Payment.status == status_filter)
    if user_id:
        query = query.where(Payment.user_id == user_id)
        count_q = count_q.where(Payment.user_id == user_id)

    total = (await db.execute(count_q)).scalar() or 0
    query = query.order_by(Payment.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    payments = result.scalars().all()

    return PaginatedResponse(
        items=[PaymentResponse.model_validate(p) for p in payments],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@payments_router.post("", response_model=PaymentResponse, status_code=201)
async def create_payment(
    data: PaymentCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    payment = Payment(
        tenant_id=ctx.tenant_id,
        user_id=data.user_id,
        amount=data.amount,
        currency=data.currency,
        method=data.method,
        description=data.description,
        membership_id=data.membership_id,
        status=PaymentStatus.COMPLETED if data.method in ("cash", "transfer") else PaymentStatus.PENDING,
        paid_at=datetime.now(timezone.utc) if data.method in ("cash", "transfer") else None,
    )
    db.add(payment)
    await db.flush()
    await db.refresh(payment)
    return PaymentResponse.model_validate(payment)
