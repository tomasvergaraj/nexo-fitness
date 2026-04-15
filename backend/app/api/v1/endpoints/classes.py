"""Classes and Reservations API endpoints."""

import structlog
from datetime import datetime, date, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_tenant_context, TenantContext, require_roles, get_current_user
from app.models.business import (
    GymClass, ClassStatus, Reservation, ReservationStatus, CheckIn, Membership, MembershipStatus,
)
from app.models.user import User, UserRole
from app.schemas.business import (
    GymClassCreate, GymClassUpdate, GymClassResponse,
    ReservationCreate, ReservationResponse,
    ClassReservationDetailResponse,
    CheckInCreate, CheckInResponse, CheckInScanRequest,
    PaginatedResponse,
)
from app.services.class_service import (
    build_gym_class_response,
    build_gym_class_responses,
    normalize_class_modality,
    validate_branch_assignment,
)

logger = structlog.get_logger()

router = APIRouter(tags=["Classes & Reservations"])


def _role_value(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


def _build_checkin_response(checkin: CheckIn, user_name: Optional[str] = None) -> CheckInResponse:
    return CheckInResponse(
        id=checkin.id,
        user_id=checkin.user_id,
        user_name=user_name,
        gym_class_id=checkin.gym_class_id,
        check_type=checkin.check_type,
        checked_in_at=checkin.checked_in_at,
    )


def _build_class_reservation_detail_response(
    reservation: Reservation,
    user: Optional[User] = None,
) -> ClassReservationDetailResponse:
    return ClassReservationDetailResponse(
        id=reservation.id,
        user_id=reservation.user_id,
        user_name=user.full_name if user else None,
        user_email=user.email if user else None,
        user_phone=user.phone if user else None,
        gym_class_id=reservation.gym_class_id,
        status=reservation.status.value if isinstance(reservation.status, ReservationStatus) else str(reservation.status),
        waitlist_position=reservation.waitlist_position,
        cancel_reason=reservation.cancel_reason,
        cancelled_at=reservation.cancelled_at,
        created_at=reservation.created_at,
    )


async def _get_checkin_client(
    db: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
) -> User:
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == tenant_id,
            User.is_active == True,
            User.role == UserRole.CLIENT,
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="No encontramos un cliente activo para registrar el ingreso")
    return user


async def _create_checkin_record(
    db: AsyncSession,
    tenant_id: UUID,
    checked_in_by: UUID,
    user_id: UUID,
    gym_class_id: Optional[UUID],
    branch_id: Optional[UUID],
    check_type: str,
) -> CheckIn:
    checkin = CheckIn(
        tenant_id=tenant_id,
        user_id=user_id,
        gym_class_id=gym_class_id,
        branch_id=branch_id,
        check_type=check_type,
        checked_in_by=checked_in_by,
    )
    db.add(checkin)

    if gym_class_id:
        res_result = await db.execute(
            select(Reservation).where(
                Reservation.user_id == user_id,
                Reservation.gym_class_id == gym_class_id,
                Reservation.status == ReservationStatus.CONFIRMED,
            )
        )
        reservation = res_result.scalar_one_or_none()
        if reservation:
            reservation.status = ReservationStatus.ATTENDED
            reservation.attended_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(checkin)
    return checkin


def _parse_qr_payload(qr_payload: str) -> tuple[str, UUID, UUID]:
    payload = qr_payload.strip()
    parts = payload.split(":")
    if len(parts) != 4 or parts[0].lower() != "nexo":
        raise HTTPException(status_code=400, detail="El código QR no es válido para registrar el ingreso")

    tenant_slug = parts[1].strip().lower()
    try:
        user_id = UUID(parts[2].strip())
        membership_id = UUID(parts[3].strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="El código QR no es válido para registrar el ingreso") from exc

    return tenant_slug, user_id, membership_id


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
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    program_id: Optional[UUID] = None,
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
        count_query = count_query.where(GymClass.instructor_id == instructor_id)
    if program_id:
        query = query.where(GymClass.program_id == program_id)
        count_query = count_query.where(GymClass.program_id == program_id)
    if date_from:
        query = query.where(GymClass.start_time >= date_from)
        count_query = count_query.where(GymClass.start_time >= date_from)
    if date_to:
        query = query.where(GymClass.start_time <= date_to)
        count_query = count_query.where(GymClass.start_time <= date_to)

    order_col = GymClass.start_time.asc() if sort_order == "asc" else GymClass.start_time.desc()
    total = (await db.execute(count_query)).scalar() or 0
    query = query.order_by(order_col).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    classes = result.scalars().all()

    items = await build_gym_class_responses(db, classes)

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


def _next_occurrence(base: datetime, repeat_type: str, step: int) -> datetime:
    """Return base shifted by `step` recurrence intervals."""
    if repeat_type == "daily":
        return base + timedelta(days=step)
    if repeat_type == "weekly":
        return base + timedelta(weeks=step)
    if repeat_type == "monthly":
        # Add months manually to avoid calendar edge cases
        month = base.month - 1 + step
        year = base.year + month // 12
        month = month % 12 + 1
        day = min(base.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
        return base.replace(year=year, month=month, day=day)
    raise ValueError(f"Unknown repeat_type: {repeat_type}")


@router.post("/classes", response_model=GymClassResponse, status_code=201)
async def create_class(
    data: GymClassCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    normalized_modality = normalize_class_modality(data.modality)
    await validate_branch_assignment(
        db,
        tenant_id=ctx.tenant_id,
        modality=normalized_modality,
        branch_id=data.branch_id,
    )
    duration = data.end_time - data.start_time
    base_fields = data.model_dump(exclude={"repeat_type", "repeat_until", "start_time", "end_time"})
    base_fields["modality"] = normalized_modality

    if data.repeat_type != "none" and data.repeat_until:
        group_id = uuid4()
        first_class: Optional[GymClass] = None
        step = 0
        while True:
            occ_start = _next_occurrence(data.start_time, data.repeat_type, step)
            if occ_start.date() > data.repeat_until:
                break
            occ_end = occ_start + duration
            gym_class = GymClass(
                tenant_id=ctx.tenant_id,
                start_time=occ_start,
                end_time=occ_end,
                repeat_type=data.repeat_type,
                repeat_until=data.repeat_until,
                recurrence_group_id=group_id,
                **base_fields,
            )
            db.add(gym_class)
            if step == 0:
                first_class = gym_class
            step += 1
        await db.flush()
        if first_class:
            await db.refresh(first_class)
            return await build_gym_class_response(db, first_class)
        # Fallback (no occurrences generated — repeat_until before start)
        gym_class = GymClass(
            tenant_id=ctx.tenant_id,
            start_time=data.start_time,
            end_time=data.end_time,
            repeat_type="none",
            **base_fields,
        )
        db.add(gym_class)
        await db.flush()
        await db.refresh(gym_class)
        return await build_gym_class_response(db, gym_class)

    gym_class = GymClass(
        tenant_id=ctx.tenant_id,
        start_time=data.start_time,
        end_time=data.end_time,
        repeat_type=data.repeat_type,
        repeat_until=data.repeat_until,
        **base_fields,
    )
    db.add(gym_class)
    await db.flush()
    await db.refresh(gym_class)
    return await build_gym_class_response(db, gym_class)


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
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    return await build_gym_class_response(db, gym_class)


@router.get("/classes/{class_id}/reservations", response_model=list[ClassReservationDetailResponse])
async def list_class_reservations(
    class_id: UUID,
    include_cancelled: bool = Query(default=True, description="Incluir reservas canceladas y no-show"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    gym_class = (
        await db.execute(
            select(GymClass).where(GymClass.id == class_id, GymClass.tenant_id == ctx.tenant_id)
        )
    ).scalar_one_or_none()
    if not gym_class:
        raise HTTPException(status_code=404, detail="Clase no encontrada")

    reservation_query = (
        select(Reservation, User)
        .join(User, User.id == Reservation.user_id)
        .where(
            Reservation.tenant_id == ctx.tenant_id,
            Reservation.gym_class_id == class_id,
        )
        .order_by(Reservation.created_at.asc())
    )
    if not include_cancelled:
        reservation_query = reservation_query.where(
            Reservation.status.notin_([ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW])
        )

    rows = await db.execute(reservation_query)

    status_order = {
        ReservationStatus.CONFIRMED: 0,
        ReservationStatus.ATTENDED: 1,
        ReservationStatus.WAITLISTED: 2,
        ReservationStatus.NO_SHOW: 3,
        ReservationStatus.CANCELLED: 4,
    }
    reservation_rows = rows.all()
    reservation_rows.sort(
        key=lambda row: (
            status_order.get(row[0].status, 99),
            (row[1].first_name or "").lower(),
            (row[1].last_name or "").lower(),
            row[0].created_at,
        )
    )
    return [
        _build_class_reservation_detail_response(reservation, user)
        for reservation, user in reservation_rows
    ]


@router.patch("/classes/{class_id}", response_model=GymClassResponse)
async def update_class(
    class_id: UUID,
    data: GymClassUpdate,
    series: bool = Query(default=False, description="Si es True aplica los cambios a todas las futuras de la serie"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    result = await db.execute(
        select(GymClass).where(GymClass.id == class_id, GymClass.tenant_id == ctx.tenant_id)
    )
    gym_class = result.scalar_one_or_none()
    if not gym_class:
        raise HTTPException(status_code=404, detail="Clase no encontrada")

    update_data = data.model_dump(exclude_unset=True)
    effective_modality = normalize_class_modality(update_data.get("modality", gym_class.modality))
    effective_branch_id = update_data["branch_id"] if "branch_id" in update_data else gym_class.branch_id
    await validate_branch_assignment(
        db,
        tenant_id=ctx.tenant_id,
        modality=effective_modality,
        branch_id=effective_branch_id,
    )
    update_data["modality"] = effective_modality

    # Collect classes to update: single or all future in the series
    if series and gym_class.recurrence_group_id:
        series_result = await db.execute(
            select(GymClass).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.recurrence_group_id == gym_class.recurrence_group_id,
                GymClass.status == ClassStatus.SCHEDULED,
                GymClass.start_time >= gym_class.start_time,
            )
        )
        classes_to_update = series_result.scalars().all()
    else:
        classes_to_update = [gym_class]

    # Fields that depend on per-instance time and should NOT be bulk-applied
    time_fields = {"start_time", "end_time"}
    bulk_update = {k: v for k, v in update_data.items() if k not in time_fields} if series else update_data

    for cls in classes_to_update:
        for field, value in bulk_update.items():
            setattr(cls, field, value)

    await db.flush()
    await db.refresh(gym_class)
    return await build_gym_class_response(db, gym_class)


@router.delete("/classes/{class_id}", status_code=204)
async def cancel_class(
    class_id: UUID,
    cancel_reason: Optional[str] = Query(default=None, max_length=500),
    series: bool = Query(default=False, description="Si es True cancela toda la serie de recurrencia"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(GymClass).where(GymClass.id == class_id, GymClass.tenant_id == ctx.tenant_id)
    )
    gym_class = result.scalar_one_or_none()
    if not gym_class:
        raise HTTPException(status_code=404, detail="Clase no encontrada")

    # Collect classes to cancel (single or entire series)
    if series and gym_class.recurrence_group_id:
        series_result = await db.execute(
            select(GymClass).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.recurrence_group_id == gym_class.recurrence_group_id,
                GymClass.status == ClassStatus.SCHEDULED,
                GymClass.start_time >= datetime.now(timezone.utc),
            )
        )
        classes_to_cancel = series_result.scalars().all()
    else:
        classes_to_cancel = [gym_class]

    for cls in classes_to_cancel:
        cls.status = ClassStatus.CANCELLED
        cls.current_bookings = 0
        # Cancel all active reservations for this class
        reservations = await db.execute(
            select(Reservation).where(
                Reservation.gym_class_id == cls.id,
                Reservation.status.in_([ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED]),
            )
        )
        for r in reservations.scalars().all():
            r.status = ReservationStatus.CANCELLED
            r.cancelled_at = datetime.now(timezone.utc)
            if cancel_reason:
                r.cancel_reason = cancel_reason.strip()

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
        raise HTTPException(status_code=404, detail="Clase no encontrada")

    if gym_class.status == ClassStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="La clase está cancelada")

    requested_user_id = data.user_id or current_user.id
    current_role = _role_value(current_user)
    is_staff = current_role in {"owner", "admin", "reception"}

    if requested_user_id != current_user.id and not is_staff:
        raise HTTPException(status_code=403, detail="Los clientes solo pueden reservar para sí mismos")

    if requested_user_id != current_user.id:
        requested_user = await db.get(User, requested_user_id)
        if not requested_user or requested_user.tenant_id != ctx.tenant_id:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

    user_id = requested_user_id

    # Check existing reservation
    existing = await db.execute(
        select(Reservation).where(
            Reservation.user_id == user_id,
            Reservation.gym_class_id == data.gym_class_id,
            Reservation.status.in_([ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED]),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya existe una reserva para esta clase")

    # Determine status
    if gym_class.current_bookings >= gym_class.max_capacity:
        if not gym_class.waitlist_enabled:
            raise HTTPException(status_code=400, detail="La clase está llena")
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


@router.get("/reservations", response_model=PaginatedResponse)
async def list_reservations(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    user_id: Optional[UUID] = None,
    upcoming_only: bool = False,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    current_role = _role_value(current_user)
    is_staff = current_role in {"owner", "admin", "reception", "trainer"}
    effective_user_id = user_id

    if not is_staff:
        effective_user_id = current_user.id
    elif user_id:
        requested_user = await db.get(User, user_id)
        if not requested_user or requested_user.tenant_id != ctx.tenant_id:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

    query = select(Reservation).where(Reservation.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(Reservation).where(Reservation.tenant_id == ctx.tenant_id)

    if effective_user_id:
        query = query.where(Reservation.user_id == effective_user_id)
        count_query = count_query.where(Reservation.user_id == effective_user_id)
    if status:
        query = query.where(Reservation.status == status)
        count_query = count_query.where(Reservation.status == status)
    if upcoming_only:
        upcoming_filter = GymClass.start_time >= datetime.now(timezone.utc)
        query = query.join(GymClass, Reservation.gym_class_id == GymClass.id).where(upcoming_filter)
        count_query = count_query.join(GymClass, Reservation.gym_class_id == GymClass.id).where(upcoming_filter)

    total = (await db.execute(count_query)).scalar() or 0
    reservations = (
        await db.execute(
            query.order_by(Reservation.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).scalars().all()

    return PaginatedResponse(
        items=[ReservationResponse.model_validate(reservation) for reservation in reservations],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@router.delete("/reservations/{reservation_id}", status_code=204)
async def cancel_reservation(
    reservation_id: UUID,
    cancel_reason: Optional[str] = Query(default=None, max_length=500),
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
        raise HTTPException(status_code=404, detail="Reserva no encontrada")

    # Only owner of reservation or staff can cancel
    current_role = _role_value(current_user)
    is_staff = current_role in ("owner", "admin", "reception")
    if reservation.user_id != current_user.id and not is_staff:
        raise HTTPException(status_code=403, detail="No autorizado")

    # Enforce cancellation deadline for clients (staff can always cancel)
    if not is_staff and reservation.status == ReservationStatus.CONFIRMED:
        gym_class_for_deadline = await db.get(GymClass, reservation.gym_class_id)
        if gym_class_for_deadline and gym_class_for_deadline.cancellation_deadline_hours > 0:
            deadline = gym_class_for_deadline.start_time - timedelta(
                hours=gym_class_for_deadline.cancellation_deadline_hours
            )
            if datetime.now(timezone.utc) > deadline:
                raise HTTPException(
                    status_code=400,
                    detail=f"No se puede cancelar con menos de {gym_class_for_deadline.cancellation_deadline_hours} hora(s) de anticipación",
                )

    was_confirmed = reservation.status == ReservationStatus.CONFIRMED
    reservation.status = ReservationStatus.CANCELLED
    reservation.cancelled_at = datetime.now(timezone.utc)
    if cancel_reason:
        reservation.cancel_reason = cancel_reason.strip()

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

                # Notify the promoted member
                try:
                    from app.services.push_notification_service import create_and_dispatch_notification
                    class_time = gym_class.start_time.strftime("%H:%M") if gym_class.start_time else ""
                    await create_and_dispatch_notification(
                        db,
                        tenant_id=gym_class.tenant_id,
                        user_id=first_waiting.user_id,
                        title="¡Tienes lugar en la clase!",
                        message=f"Pasaste de la lista de espera a confirmado en {gym_class.name}{f' a las {class_time}' if class_time else ''}. ¡Te esperamos!",
                        type="success",
                        action_url="?tab=agenda",
                    )
                except Exception as exc:
                    logger.warning("waitlist_push_failed", exc_info=exc)

    await db.flush()


@router.patch("/reservations/{reservation_id}", response_model=ReservationResponse)
async def update_reservation_status(
    reservation_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
    status: str = Query(..., description="Nuevo estado: no_show | attended"),
):
    """Staff can mark a reservation as no_show or attended."""
    allowed_transitions = {ReservationStatus.NO_SHOW, ReservationStatus.ATTENDED}
    try:
        new_status = ReservationStatus(status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Estado no válido. Opciones: {[s.value for s in allowed_transitions]}")
    if new_status not in allowed_transitions:
        raise HTTPException(status_code=400, detail="Solo se permite marcar no_show o attended")

    result = await db.execute(
        select(Reservation).where(
            Reservation.id == reservation_id,
            Reservation.tenant_id == ctx.tenant_id,
        )
    )
    reservation = result.scalar_one_or_none()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reserva no encontrada")
    if reservation.status not in (ReservationStatus.CONFIRMED, ReservationStatus.ATTENDED, ReservationStatus.NO_SHOW):
        raise HTTPException(status_code=400, detail="Solo se puede actualizar reservas confirmadas")

    reservation.status = new_status
    if new_status == ReservationStatus.ATTENDED:
        reservation.attended_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(reservation)
    return ReservationResponse.model_validate(reservation)


# ─── Check-in ─────────────────────────────────────────────────────────────────

@router.post("/checkins", response_model=CheckInResponse, status_code=201)
async def create_checkin(
    data: CheckInCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    client = await _get_checkin_client(db, ctx.tenant_id, data.user_id)
    checkin = await _create_checkin_record(
        db=db,
        tenant_id=ctx.tenant_id,
        checked_in_by=current_user.id,
        user_id=client.id,
        gym_class_id=data.gym_class_id,
        branch_id=data.branch_id,
        check_type=data.check_type,
    )
    return _build_checkin_response(checkin, user_name=client.full_name)


@router.post("/checkins/scan", response_model=CheckInResponse, status_code=201)
async def create_checkin_from_qr(
    data: CheckInScanRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    if ctx.tenant is None:
        raise HTTPException(status_code=400, detail="No encontramos la cuenta actual para validar el código")

    tenant_slug, user_id, membership_id = _parse_qr_payload(data.qr_payload)
    if tenant_slug != ctx.tenant.slug.lower():
        raise HTTPException(status_code=400, detail="Este código QR no pertenece a este gimnasio")

    client = await _get_checkin_client(db, ctx.tenant_id, user_id)

    membership = (
        await db.execute(
            select(Membership).where(
                Membership.id == membership_id,
                Membership.tenant_id == ctx.tenant_id,
                Membership.user_id == client.id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=400, detail="El código QR no corresponde a una membresía activa")

    checkin = await _create_checkin_record(
        db=db,
        tenant_id=ctx.tenant_id,
        checked_in_by=current_user.id,
        user_id=client.id,
        gym_class_id=data.gym_class_id,
        branch_id=data.branch_id,
        check_type="qr",
    )
    return _build_checkin_response(checkin, user_name=client.full_name)
