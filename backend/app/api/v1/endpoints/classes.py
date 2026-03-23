"""Classes and Reservations API endpoints."""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_tenant_context, TenantContext, require_roles, get_current_user
from app.models.business import (
    GymClass, ClassStatus, Reservation, ReservationStatus, CheckIn,
)
from app.models.user import User
from app.schemas.business import (
    GymClassCreate, GymClassUpdate, GymClassResponse,
    ReservationCreate, ReservationResponse,
    CheckInCreate, CheckInResponse,
    PaginatedResponse,
)

router = APIRouter(tags=["Classes & Reservations"])


# ─── Classes ──────────────────────────────────────────────────────────────────

@router.get("/classes", response_model=PaginatedResponse)
async def list_classes(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    branch_id: Optional[UUID] = None,
    instructor_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
):
    query = select(GymClass).where(GymClass.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(GymClass).where(GymClass.tenant_id == ctx.tenant_id)

    if status:
        query = query.where(GymClass.status == status)
        count_query = count_query.where(GymClass.status == status)
    if branch_id:
        query = query.where(GymClass.branch_id == branch_id)
        count_query = count_query.where(GymClass.branch_id == branch_id)
    if instructor_id:
        query = query.where(GymClass.instructor_id == instructor_id)
    if date_from:
        query = query.where(GymClass.start_time >= date_from)
    if date_to:
        query = query.where(GymClass.start_time <= date_to)

    total = (await db.execute(count_query)).scalar() or 0
    query = query.order_by(GymClass.start_time.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    classes = result.scalars().all()

    return PaginatedResponse(
        items=[GymClassResponse.model_validate(c) for c in classes],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@router.post("/classes", response_model=GymClassResponse, status_code=201)
async def create_class(
    data: GymClassCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    gym_class = GymClass(
        tenant_id=ctx.tenant_id,
        **data.model_dump(),
    )
    db.add(gym_class)
    await db.flush()
    await db.refresh(gym_class)
    return GymClassResponse.model_validate(gym_class)


@router.get("/classes/{class_id}", response_model=GymClassResponse)
async def get_class(
    class_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
):
    result = await db.execute(
        select(GymClass).where(GymClass.id == class_id, GymClass.tenant_id == ctx.tenant_id)
    )
    gym_class = result.scalar_one_or_none()
    if not gym_class:
        raise HTTPException(status_code=404, detail="Class not found")
    return GymClassResponse.model_validate(gym_class)


@router.patch("/classes/{class_id}", response_model=GymClassResponse)
async def update_class(
    class_id: UUID,
    data: GymClassUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    result = await db.execute(
        select(GymClass).where(GymClass.id == class_id, GymClass.tenant_id == ctx.tenant_id)
    )
    gym_class = result.scalar_one_or_none()
    if not gym_class:
        raise HTTPException(status_code=404, detail="Class not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(gym_class, field, value)

    await db.flush()
    await db.refresh(gym_class)
    return GymClassResponse.model_validate(gym_class)


@router.delete("/classes/{class_id}", status_code=204)
async def cancel_class(
    class_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(GymClass).where(GymClass.id == class_id, GymClass.tenant_id == ctx.tenant_id)
    )
    gym_class = result.scalar_one_or_none()
    if not gym_class:
        raise HTTPException(status_code=404, detail="Class not found")

    gym_class.status = ClassStatus.CANCELLED
    # Cancel all reservations
    reservations = await db.execute(
        select(Reservation).where(
            Reservation.gym_class_id == class_id,
            Reservation.status == ReservationStatus.CONFIRMED,
        )
    )
    for r in reservations.scalars().all():
        r.status = ReservationStatus.CANCELLED
        r.cancelled_at = datetime.now(timezone.utc)

    await db.flush()


# ─── Reservations ─────────────────────────────────────────────────────────────

@router.post("/reservations", response_model=ReservationResponse, status_code=201)
async def create_reservation(
    data: ReservationCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    # Get class
    result = await db.execute(
        select(GymClass).where(GymClass.id == data.gym_class_id, GymClass.tenant_id == ctx.tenant_id)
    )
    gym_class = result.scalar_one_or_none()
    if not gym_class:
        raise HTTPException(status_code=404, detail="Class not found")

    if gym_class.status == ClassStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Class is cancelled")

    user_id = data.user_id or current_user.id

    # Check existing reservation
    existing = await db.execute(
        select(Reservation).where(
            Reservation.user_id == user_id,
            Reservation.gym_class_id == data.gym_class_id,
            Reservation.status.in_([ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED]),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already reserved for this class")

    # Determine status
    if gym_class.current_bookings >= gym_class.max_capacity:
        if not gym_class.waitlist_enabled:
            raise HTTPException(status_code=400, detail="Class is full")
        reservation_status = ReservationStatus.WAITLISTED
        # Get waitlist position
        wl_count = await db.execute(
            select(func.count()).where(
                Reservation.gym_class_id == data.gym_class_id,
                Reservation.status == ReservationStatus.WAITLISTED,
            )
        )
        waitlist_pos = (wl_count.scalar() or 0) + 1
    else:
        reservation_status = ReservationStatus.CONFIRMED
        waitlist_pos = None
        gym_class.current_bookings += 1

    reservation = Reservation(
        tenant_id=ctx.tenant_id,
        user_id=user_id,
        gym_class_id=data.gym_class_id,
        status=reservation_status,
        waitlist_position=waitlist_pos,
    )
    db.add(reservation)
    await db.flush()
    await db.refresh(reservation)
    return ReservationResponse.model_validate(reservation)


@router.delete("/reservations/{reservation_id}", status_code=204)
async def cancel_reservation(
    reservation_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Reservation).where(
            Reservation.id == reservation_id,
            Reservation.tenant_id == ctx.tenant_id,
        )
    )
    reservation = result.scalar_one_or_none()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    # Only owner of reservation or staff can cancel
    if reservation.user_id != current_user.id and current_user.role.value not in ("owner", "admin", "reception"):
        raise HTTPException(status_code=403, detail="Not authorized")

    was_confirmed = reservation.status == ReservationStatus.CONFIRMED
    reservation.status = ReservationStatus.CANCELLED
    reservation.cancelled_at = datetime.now(timezone.utc)

    # If was confirmed, decrement bookings and promote from waitlist
    if was_confirmed:
        gym_class = await db.get(GymClass, reservation.gym_class_id)
        if gym_class and gym_class.current_bookings > 0:
            gym_class.current_bookings -= 1

            # Promote first from waitlist
            waitlisted = await db.execute(
                select(Reservation).where(
                    Reservation.gym_class_id == reservation.gym_class_id,
                    Reservation.status == ReservationStatus.WAITLISTED,
                ).order_by(Reservation.waitlist_position)
            )
            first_waiting = waitlisted.scalars().first()
            if first_waiting:
                first_waiting.status = ReservationStatus.CONFIRMED
                first_waiting.waitlist_position = None
                gym_class.current_bookings += 1

    await db.flush()


# ─── Check-in ─────────────────────────────────────────────────────────────────

@router.post("/checkins", response_model=CheckInResponse, status_code=201)
async def create_checkin(
    data: CheckInCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    checkin = CheckIn(
        tenant_id=ctx.tenant_id,
        user_id=data.user_id,
        gym_class_id=data.gym_class_id,
        branch_id=data.branch_id,
        check_type=data.check_type,
        checked_in_by=current_user.id,
    )
    db.add(checkin)

    # If class check-in, update reservation status
    if data.gym_class_id:
        res_result = await db.execute(
            select(Reservation).where(
                Reservation.user_id == data.user_id,
                Reservation.gym_class_id == data.gym_class_id,
                Reservation.status == ReservationStatus.CONFIRMED,
            )
        )
        reservation = res_result.scalar_one_or_none()
        if reservation:
            reservation.status = ReservationStatus.ATTENDED
            reservation.attended_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(checkin)
    return CheckInResponse.model_validate(checkin)
