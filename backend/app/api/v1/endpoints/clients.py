"""Clients, Plans, and Payments API endpoints."""

import json
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_, cast, Date, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_tenant_context, TenantContext, require_roles, require_plans_write
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.business import Plan, Membership, MembershipStatus, Payment, PaymentStatus, Reservation, ReservationStatus, CheckIn
from app.schemas.auth import UserCreate, UserUpdate, UserResponse, UserClientResponse, UserDetailResponse, ClientListResponse
from app.schemas.business import (
    PlanCreate, PlanUpdate, PlanResponse,
    PaymentCreate, PaymentResponse,
    PaginatedResponse,
)
from app.services.tenant_quota_service import assert_can_create_client
from app.services.membership_sale_service import apply_payment_membership_snapshot, resolve_membership_timeline
from app.services.user_account_service import purge_user_account

# ─── Clients Router ──────────────────────────────────────────────────────────

clients_router = APIRouter(prefix="/clients", tags=["Clients"])


@clients_router.get("", response_model=ClientListResponse)
async def list_clients(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    tag: Optional[str] = None,
    birthday_month: bool = Query(False),
    churn_risk: Optional[str] = Query(None, pattern="^(high|medium|low)$"),
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

    if birthday_month:
        current_month = datetime.now(timezone.utc).month
        base = base.where(
            User.date_of_birth != None,
            extract("month", User.date_of_birth) == current_month,
        )
        count_base = count_base.where(
            User.date_of_birth != None,
            extract("month", User.date_of_birth) == current_month,
        )

    total = (await db.execute(count_base)).scalar() or 0
    query = base.order_by(User.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    clients = result.scalars().all()

    # Enrich each client with their effective current membership
    client_ids = [c.id for c in clients]
    membership_rows = (
        await db.execute(
            select(Membership)
            .where(
                Membership.tenant_id == ctx.tenant_id,
                Membership.user_id.in_(client_ids),
            )
            .order_by(Membership.starts_at.desc(), Membership.created_at.desc())
        )
    ).scalars().all()

    memberships_by_user: dict[UUID, list[Membership]] = {}
    for m in membership_rows:
        memberships_by_user.setdefault(m.user_id, []).append(m)

    latest_membership: dict[UUID, Membership] = {}
    for user_id, items in memberships_by_user.items():
        state = resolve_membership_timeline(items, persist=False)
        if state.current_membership:
            latest_membership[user_id] = state.current_membership

    # Load plan names for those memberships
    plan_ids = list({m.plan_id for m in latest_membership.values() if m.plan_id})
    plans_by_id = {
        p.id: p
        for p in (await db.execute(select(Plan).where(Plan.id.in_(plan_ids)))).scalars().all()
    } if plan_ids else {}

    # Batch-fetch last check-in date per client for churn scoring
    last_checkin_rows = (
        await db.execute(
            select(CheckIn.user_id, func.max(CheckIn.checked_in_at).label("last_at"))
            .where(CheckIn.tenant_id == ctx.tenant_id, CheckIn.user_id.in_(client_ids))
            .group_by(CheckIn.user_id)
        )
    ).all()
    last_checkin_by_user: dict = {row.user_id: row.last_at for row in last_checkin_rows}

    def compute_churn_risk(membership: Optional[Membership], last_checkin_at) -> str:
        now = datetime.now(timezone.utc)
        # Expired or cancelled membership → high risk regardless of activity
        if not membership or (
            hasattr(membership.status, 'value') and membership.status.value in ("expired", "cancelled")
        ):
            return "high"
        if last_checkin_at is None:
            return "high"
        # Normalise timezone
        lc = last_checkin_at
        if lc.tzinfo is None:
            lc = lc.replace(tzinfo=timezone.utc)
        days_since = (now - lc).days
        if days_since >= 30:
            return "high"
        if days_since >= 14:
            return "medium"
        return "low"

    items = []
    for c in clients:
        membership = latest_membership.get(c.id)
        plan = plans_by_id.get(membership.plan_id) if membership and membership.plan_id else None
        last_ci = last_checkin_by_user.get(c.id)
        risk = compute_churn_risk(membership, last_ci)

        # Apply churn_risk filter post-enrichment (avoids complex SQL join)
        if churn_risk and risk != churn_risk:
            continue

        # date_of_birth may be a datetime — normalize to date
        dob = c.date_of_birth
        if hasattr(dob, 'date'):
            dob = dob.date()
        items.append(
            UserClientResponse(
                **UserResponse.model_validate(c).model_dump(),
                date_of_birth=dob,
                membership_id=membership.id if membership else None,
                membership_status=membership.status.value if membership else None,
                membership_expires_at=membership.expires_at if membership else None,
                membership_notes=membership.notes if membership else None,
                plan_name=plan.name if plan else None,
                churn_risk=risk,
            )
        )

    return ClientListResponse(
        items=items,
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
        raise HTTPException(status_code=400, detail="El correo ya está registrado")
    if not ctx.tenant:
        raise HTTPException(status_code=403, detail="No hay tenant activo para crear clientes")

    await assert_can_create_client(db, ctx.tenant)

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
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return UserDetailResponse.model_validate(client)


@clients_router.get("/{client_id}/membership-history")
async def get_client_membership_history(
    client_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    """Return full membership history for a client."""
    client = (await db.execute(
        select(User).where(User.id == client_id, User.tenant_id == ctx.tenant_id)
    )).scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    memberships = (await db.execute(
        select(Membership)
        .where(Membership.tenant_id == ctx.tenant_id, Membership.user_id == client_id)
        .order_by(Membership.starts_at.desc(), Membership.created_at.desc())
    )).scalars().all()

    plan_ids = list({m.plan_id for m in memberships if m.plan_id})
    plans_by_id = {}
    if plan_ids:
        plans_by_id = {
            p.id: p for p in (await db.execute(select(Plan).where(Plan.id.in_(plan_ids)))).scalars().all()
        }
    membership_ids = [membership.id for membership in memberships]
    payments_by_membership: dict[UUID, Payment] = {}
    if membership_ids:
        payment_rows = (
            await db.execute(
                select(Payment)
                .where(Payment.tenant_id == ctx.tenant_id, Payment.membership_id.in_(membership_ids))
                .order_by(func.coalesce(Payment.paid_at, Payment.created_at).desc(), Payment.created_at.desc())
            )
        ).scalars().all()
        for payment in payment_rows:
            if payment.membership_id and payment.membership_id not in payments_by_membership:
                payments_by_membership[payment.membership_id] = payment

    return [
        {
            "id": str(m.id),
            "plan_name": plans_by_id[m.plan_id].name if m.plan_id in plans_by_id else "Plan eliminado",
            "status": m.status.value if hasattr(m.status, "value") else str(m.status),
            "starts_at": m.starts_at.isoformat() if m.starts_at else None,
            "expires_at": m.expires_at.isoformat() if m.expires_at else None,
            "frozen_until": m.frozen_until.isoformat() if m.frozen_until else None,
            "notes": m.notes,
            "previous_membership_id": str(m.previous_membership_id) if m.previous_membership_id else None,
            "sale_source": m.sale_source,
            "payment_id": str(payments_by_membership[m.id].id) if m.id in payments_by_membership else None,
            "amount": str(payments_by_membership[m.id].amount) if m.id in payments_by_membership else None,
            "currency": payments_by_membership[m.id].currency if m.id in payments_by_membership else None,
            "method": (
                payments_by_membership[m.id].method.value
                if m.id in payments_by_membership and hasattr(payments_by_membership[m.id].method, "value")
                else str(payments_by_membership[m.id].method)
                if m.id in payments_by_membership
                else None
            ),
            "payment_status": (
                payments_by_membership[m.id].status.value
                if m.id in payments_by_membership and hasattr(payments_by_membership[m.id].status, "value")
                else str(payments_by_membership[m.id].status)
                if m.id in payments_by_membership
                else None
            ),
            "paid_at": payments_by_membership[m.id].paid_at.isoformat() if m.id in payments_by_membership and payments_by_membership[m.id].paid_at else None,
            "created_at": m.created_at.isoformat(),
        }
        for m in memberships
    ]


@clients_router.get("/{client_id}/stats")
async def get_client_stats(
    client_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    """Return attendance statistics for a single client."""
    # Verify client belongs to tenant
    client = (await db.execute(
        select(User).where(User.id == client_id, User.tenant_id == ctx.tenant_id)
    )).scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    # Total reservations (any status)
    total_reservations = (await db.execute(
        select(func.count()).select_from(Reservation)
        .where(Reservation.tenant_id == ctx.tenant_id, Reservation.user_id == client_id)
    )).scalar() or 0

    # Confirmed reservations (attended + confirmed)
    confirmed_reservations = (await db.execute(
        select(func.count()).select_from(Reservation)
        .where(
            Reservation.tenant_id == ctx.tenant_id,
            Reservation.user_id == client_id,
            Reservation.status.in_([ReservationStatus.CONFIRMED, ReservationStatus.ATTENDED]),
        )
    )).scalar() or 0

    # Cancelled reservations
    cancelled_reservations = (await db.execute(
        select(func.count()).select_from(Reservation)
        .where(
            Reservation.tenant_id == ctx.tenant_id,
            Reservation.user_id == client_id,
            Reservation.status == ReservationStatus.CANCELLED,
        )
    )).scalar() or 0

    # Total check-ins (actual attendance)
    total_checkins = (await db.execute(
        select(func.count()).select_from(CheckIn)
        .where(CheckIn.tenant_id == ctx.tenant_id, CheckIn.user_id == client_id)
    )).scalar() or 0

    # Last visit
    last_visit = (await db.execute(
        select(func.max(CheckIn.checked_in_at))
        .where(CheckIn.tenant_id == ctx.tenant_id, CheckIn.user_id == client_id)
    )).scalar()

    # Attendance rate: check-ins vs confirmed reservations
    attendance_rate = round(total_checkins / confirmed_reservations * 100) if confirmed_reservations > 0 else 0

    return {
        "total_reservations": total_reservations,
        "confirmed_reservations": confirmed_reservations,
        "cancelled_reservations": cancelled_reservations,
        "total_checkins": total_checkins,
        "attendance_rate": attendance_rate,
        "last_visit": last_visit.isoformat() if last_visit else None,
    }


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
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    update_data = data.model_dump(exclude_unset=True)

    # Validar unicidad de email si se está cambiando
    if "email" in update_data and update_data["email"] and update_data["email"] != client.email:
        existing = await db.execute(
            select(User).where(User.email == update_data["email"], User.id != client_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="El correo ya está registrado por otro usuario")

    if update_data.get("is_active") is True and not client.is_active:
        if not ctx.tenant:
            raise HTTPException(status_code=403, detail="No hay tenant activo para reactivar clientes")
        await assert_can_create_client(db, ctx.tenant)

    if "tags" in update_data and update_data["tags"] is not None:
        update_data["tags"] = json.dumps(update_data["tags"])
    for field, value in update_data.items():
        setattr(client, field, value)

    await db.flush()
    await db.refresh(client)
    return UserResponse.model_validate(client)


@clients_router.delete("/{client_id}/hard-delete", status_code=204)
async def hard_delete_client(
    client_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(User).where(
            User.id == client_id,
            User.tenant_id == ctx.tenant_id,
            User.role == UserRole.CLIENT,
        )
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    await purge_user_account(db, user=client, actor=current_user, tenant_id=ctx.tenant_id)


@clients_router.post("/{client_id}/reset-password", status_code=204)
async def reset_client_password(
    client_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    new_password = data.get("new_password", "")
    if not new_password or len(new_password) < 8:
        raise HTTPException(status_code=422, detail="La contraseña debe tener al menos 8 caracteres")
    if not any(c.isupper() for c in new_password):
        raise HTTPException(status_code=422, detail="La contraseña debe incluir al menos una mayúscula")
    if not any(c.isdigit() for c in new_password):
        raise HTTPException(status_code=422, detail="La contraseña debe incluir al menos un número")

    result = await db.execute(
        select(User).where(User.id == client_id, User.tenant_id == ctx.tenant_id)
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

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
    _user=Depends(require_plans_write()),
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
    _user=Depends(require_plans_write()),
):
    result = await db.execute(
        select(Plan).where(Plan.id == plan_id, Plan.tenant_id == ctx.tenant_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")

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
    membership = None
    plan = None
    if data.membership_id:
        membership = await db.get(Membership, data.membership_id)
        if not membership or membership.tenant_id != ctx.tenant_id or membership.user_id != data.user_id:
            raise HTTPException(status_code=404, detail="Membresía no encontrada para este pago")
        plan = await db.get(Plan, membership.plan_id)

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
    if membership:
        apply_payment_membership_snapshot(payment, membership=membership, plan=plan)
    db.add(payment)
    await db.flush()
    await db.refresh(payment)
    return PaymentResponse.model_validate(payment)
