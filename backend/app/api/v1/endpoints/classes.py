"""Classes and Reservations API endpoints."""

import structlog
from datetime import datetime, date, time, timedelta, timezone
from typing import Optional, List, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_tenant_context, TenantContext, require_roles, get_current_user
from app.integrations.email.email_service import email_service
from app.models.business import (
    Branch, CheckIn, CheckInInvestigationCase, ClassModality, ClassStatus, GymClass, Membership, MembershipStatus,
    Plan, ProgramBooking, Reservation, ReservationStatus, TrainingProgram,
)
from app.models.user import User, UserRole
from app.schemas.business import (
    BranchResponse, BulkCancelableClassItem, BulkClassCancelPreviewResponse, BulkClassCancelRequest,
    BulkClassCancelResponse, CheckInContextResponse, CheckInCreate, CheckInHistoryItemResponse,
    CheckInInvestigationCaseDetailResponse, CheckInInvestigationCaseResponse,
    CheckInInvestigationCaseUpdateRequest, CheckInResponse, CheckInScanRequest, ClassReservationDetailResponse,
    GymClassCreate, GymClassResponse, GymClassUpdate, PaginatedResponse, ProgramBookingCancelRequest,
    ProgramBookingCreate, ProgramBookingOut, ReservationCreate, ReservationResponse,
)
from app.services.branding_service import DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR, coerce_brand_color
from app.services.class_service import (
    build_gym_class_response,
    build_gym_class_responses,
    normalize_class_modality,
    validate_branch_assignment,
)
from app.services.membership_sale_service import sync_membership_timeline
from app.services.push_notification_service import create_and_dispatch_notification

logger = structlog.get_logger()

router = APIRouter(tags=["Classes & Reservations"])
SUSPICIOUS_QR_RULE = "qr_frequency"
SUSPICIOUS_QR_WINDOW_THRESHOLD = 3
SUSPICIOUS_QR_DAILY_THRESHOLD = 5
SUSPICIOUS_QR_WINDOW_HOURS = 2
CHECKIN_WINDOW_BEFORE_MINUTES = 60


def _valid_program_class_filter(tenant_id: UUID):
    return or_(
        GymClass.program_id.is_(None),
        select(TrainingProgram.id)
        .where(
            TrainingProgram.id == GymClass.program_id,
            TrainingProgram.tenant_id == tenant_id,
        )
        .exists(),
    )


def _role_value(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


def _build_checkin_response(
    checkin: CheckIn,
    user_name: Optional[str] = None,
    attendance_resolution: str = "none",
    resolved_gym_class_name: Optional[str] = None,
) -> CheckInResponse:
    return CheckInResponse(
        id=checkin.id,
        user_id=checkin.user_id,
        user_name=user_name,
        gym_class_id=checkin.gym_class_id,
        reservation_id=checkin.reservation_id,
        attendance_resolution=attendance_resolution,
        resolved_gym_class_name=resolved_gym_class_name,
        check_type=checkin.check_type,
        checked_in_at=checkin.checked_in_at,
    )


def _tenant_zone(ctx: TenantContext) -> ZoneInfo:
    tenant_timezone = ctx.tenant.timezone if ctx.tenant and ctx.tenant.timezone else "UTC"
    try:
        return ZoneInfo(tenant_timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _tenant_local_day_bounds(day: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    day_start_local = datetime.combine(day, time.min, tzinfo=zone)
    next_day_local = day_start_local + timedelta(days=1)
    return day_start_local.astimezone(timezone.utc), next_day_local.astimezone(timezone.utc)


def _checkin_history_response(
    checkin: CheckIn,
    *,
    user_name: Optional[str] = None,
    branch_name: Optional[str] = None,
    gym_class_name: Optional[str] = None,
    checked_in_by_name: Optional[str] = None,
) -> CheckInHistoryItemResponse:
    resolution: Optional[str] = None
    if checkin.reservation_id and checkin.gym_class_id:
        resolution = "linked"
    return CheckInHistoryItemResponse(
        id=checkin.id,
        user_id=checkin.user_id,
        user_name=user_name,
        branch_id=checkin.branch_id,
        branch_name=branch_name,
        gym_class_id=checkin.gym_class_id,
        gym_class_name=gym_class_name,
        reservation_id=checkin.reservation_id,
        attendance_resolution=resolution,
        check_type=checkin.check_type,
        checked_in_at=checkin.checked_in_at,
        checked_in_by=checkin.checked_in_by,
        checked_in_by_name=checked_in_by_name,
    )


def _checkin_case_response(
    case: CheckInInvestigationCase,
    *,
    user: Optional[User] = None,
    reviewer: Optional[User] = None,
) -> CheckInInvestigationCaseResponse:
    return CheckInInvestigationCaseResponse(
        id=case.id,
        user_id=case.user_id,
        user_name=user.full_name if user else None,
        user_email=user.email if user else None,
        status=case.status,
        rule_code=case.rule_code,
        local_day=case.local_day,
        first_triggered_at=case.first_triggered_at,
        last_triggered_at=case.last_triggered_at,
        daily_qr_count=case.daily_qr_count,
        window_qr_count=case.window_qr_count,
        review_notes=case.review_notes,
        reviewed_by=case.reviewed_by,
        reviewed_by_name=reviewer.full_name if reviewer else None,
        reviewed_at=case.reviewed_at,
        trigger_checkin_id=case.trigger_checkin_id,
    )


async def _build_checkin_history_items(
    db: AsyncSession,
    checkins: list[CheckIn],
) -> list[CheckInHistoryItemResponse]:
    if not checkins:
        return []

    user_ids = {checkin.user_id for checkin in checkins}
    actor_ids = {checkin.checked_in_by for checkin in checkins if checkin.checked_in_by}
    branch_ids = {checkin.branch_id for checkin in checkins if checkin.branch_id}
    class_ids = {checkin.gym_class_id for checkin in checkins if checkin.gym_class_id}

    users = (
        await db.execute(select(User).where(User.id.in_(user_ids | actor_ids)))
    ).scalars().all() if (user_ids or actor_ids) else []
    branches = (
        await db.execute(select(Branch).where(Branch.id.in_(branch_ids)))
    ).scalars().all() if branch_ids else []
    classes = (
        await db.execute(select(GymClass).where(GymClass.id.in_(class_ids)))
    ).scalars().all() if class_ids else []

    users_by_id = {user.id: user for user in users}
    branches_by_id = {branch.id: branch for branch in branches}
    classes_by_id = {gym_class.id: gym_class for gym_class in classes}

    return [
        _checkin_history_response(
            checkin,
            user_name=users_by_id.get(checkin.user_id).full_name if users_by_id.get(checkin.user_id) else None,
            branch_name=branches_by_id.get(checkin.branch_id).name if checkin.branch_id and branches_by_id.get(checkin.branch_id) else None,
            gym_class_name=classes_by_id.get(checkin.gym_class_id).name if checkin.gym_class_id and classes_by_id.get(checkin.gym_class_id) else None,
            checked_in_by_name=users_by_id.get(checkin.checked_in_by).full_name if checkin.checked_in_by and users_by_id.get(checkin.checked_in_by) else None,
        )
        for checkin in checkins
    ]


async def _build_checkin_case_items(
    db: AsyncSession,
    cases: list[CheckInInvestigationCase],
) -> list[CheckInInvestigationCaseResponse]:
    if not cases:
        return []

    user_ids = {case.user_id for case in cases}
    reviewer_ids = {case.reviewed_by for case in cases if case.reviewed_by}
    users = (
        await db.execute(select(User).where(User.id.in_(user_ids | reviewer_ids)))
    ).scalars().all() if (user_ids or reviewer_ids) else []
    users_by_id = {user.id: user for user in users}

    return [
        _checkin_case_response(
            case,
            user=users_by_id.get(case.user_id),
            reviewer=users_by_id.get(case.reviewed_by) if case.reviewed_by else None,
        )
        for case in cases
    ]


async def _build_checkin_case_detail(
    db: AsyncSession,
    ctx: TenantContext,
    case: CheckInInvestigationCase,
) -> CheckInInvestigationCaseDetailResponse:
    zone = _tenant_zone(ctx)
    day_start_utc, day_end_utc = _tenant_local_day_bounds(case.local_day, zone)
    related_checkins = (
        await db.execute(
            select(CheckIn)
            .where(
                CheckIn.tenant_id == ctx.tenant_id,
                CheckIn.user_id == case.user_id,
                CheckIn.check_type == "qr",
                CheckIn.checked_in_at >= day_start_utc,
                CheckIn.checked_in_at < day_end_utc,
            )
            .order_by(CheckIn.checked_in_at.desc())
        )
    ).scalars().all()
    related_items = await _build_checkin_history_items(db, related_checkins)

    users = (
        await db.execute(
            select(User).where(
                User.id.in_({case.user_id} | ({case.reviewed_by} if case.reviewed_by else set()))
            )
        )
    ).scalars().all()
    users_by_id = {user.id: user for user in users}
    summary = _checkin_case_response(
        case,
        user=users_by_id.get(case.user_id),
        reviewer=users_by_id.get(case.reviewed_by) if case.reviewed_by else None,
    )

    return CheckInInvestigationCaseDetailResponse(
        **summary.model_dump(),
        related_checkins=related_items,
    )


async def _detect_qr_frequency_case(
    db: AsyncSession,
    ctx: TenantContext,
    checkin: CheckIn,
) -> Optional[CheckInInvestigationCase]:
    if not ctx.tenant or checkin.check_type != "qr":
        return None

    zone = _tenant_zone(ctx)
    local_day = checkin.checked_in_at.astimezone(zone).date()
    day_start_utc, day_end_utc = _tenant_local_day_bounds(local_day, zone)
    window_start_utc = checkin.checked_in_at - timedelta(hours=SUSPICIOUS_QR_WINDOW_HOURS)

    daily_qr_count = (
        await db.execute(
            select(func.count())
            .select_from(CheckIn)
            .where(
                CheckIn.tenant_id == ctx.tenant_id,
                CheckIn.user_id == checkin.user_id,
                CheckIn.check_type == "qr",
                CheckIn.checked_in_at >= day_start_utc,
                CheckIn.checked_in_at < day_end_utc,
            )
        )
    ).scalar() or 0

    window_qr_count = (
        await db.execute(
            select(func.count())
            .select_from(CheckIn)
            .where(
                CheckIn.tenant_id == ctx.tenant_id,
                CheckIn.user_id == checkin.user_id,
                CheckIn.check_type == "qr",
                CheckIn.checked_in_at >= window_start_utc,
                CheckIn.checked_in_at <= checkin.checked_in_at,
            )
        )
    ).scalar() or 0

    if daily_qr_count < SUSPICIOUS_QR_DAILY_THRESHOLD and window_qr_count < SUSPICIOUS_QR_WINDOW_THRESHOLD:
        return None

    case = (
        await db.execute(
            select(CheckInInvestigationCase).where(
                CheckInInvestigationCase.tenant_id == ctx.tenant_id,
                CheckInInvestigationCase.user_id == checkin.user_id,
                CheckInInvestigationCase.local_day == local_day,
                CheckInInvestigationCase.rule_code == SUSPICIOUS_QR_RULE,
            )
        )
    ).scalar_one_or_none()

    if case is None:
        case = CheckInInvestigationCase(
            tenant_id=ctx.tenant_id,
            user_id=checkin.user_id,
            trigger_checkin_id=checkin.id,
            status="open",
            rule_code=SUSPICIOUS_QR_RULE,
            local_day=local_day,
            first_triggered_at=checkin.checked_in_at,
            last_triggered_at=checkin.checked_in_at,
            daily_qr_count=daily_qr_count,
            window_qr_count=window_qr_count,
        )
        db.add(case)
    else:
        case.trigger_checkin_id = checkin.id
        case.last_triggered_at = checkin.checked_in_at
        case.daily_qr_count = daily_qr_count
        case.window_qr_count = window_qr_count
        if case.status != "confirmed":
            case.status = "open"
            case.reviewed_by = None
            case.reviewed_at = None

    await db.flush()
    return case


def _build_class_reservation_detail_response(
    reservation: Reservation,
    user: Optional[User] = None,
    program_booking: Optional[ProgramBooking] = None,
    program: Optional[TrainingProgram] = None,
) -> ClassReservationDetailResponse:
    return ClassReservationDetailResponse(
        id=reservation.id,
        user_id=reservation.user_id,
        user_name=user.full_name if user else None,
        user_email=user.email if user else None,
        user_phone=user.phone if user else None,
        gym_class_id=reservation.gym_class_id,
        status=reservation.status.value if isinstance(reservation.status, ReservationStatus) else str(reservation.status),
        reservation_origin="program" if program_booking else "individual",
        program_booking_id=program_booking.id if program_booking else None,
        program_booking_status=program_booking.status if program_booking else None,
        program_name=program.name if program else None,
        waitlist_position=reservation.waitlist_position,
        cancel_reason=reservation.cancel_reason,
        cancelled_at=reservation.cancelled_at,
        attended_at=reservation.attended_at,
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


async def _resolve_eligible_reservation(
    db: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    now_utc: datetime,
    explicit_gym_class_id: Optional[UUID] = None,
) -> Optional[Reservation]:
    """Find the best reservation to link to a check-in.

    If explicit_gym_class_id is given, look for a reservation for that class.
    Otherwise auto-resolve by schedule proximity within the eligibility window.
    Only in_person and hybrid classes qualify (not online).
    Window: [start_time - 60min, end_time] inclusive.
    """
    window_open = now_utc - timedelta(minutes=CHECKIN_WINDOW_BEFORE_MINUTES)
    eligible_statuses = [ReservationStatus.CONFIRMED, ReservationStatus.NO_SHOW]
    eligible_modalities = [ClassModality.IN_PERSON, ClassModality.HYBRID]

    if explicit_gym_class_id:
        result = await db.execute(
            select(Reservation)
            .join(GymClass, GymClass.id == Reservation.gym_class_id)
            .where(
                Reservation.user_id == user_id,
                Reservation.gym_class_id == explicit_gym_class_id,
                Reservation.status.in_(eligible_statuses),
                GymClass.tenant_id == tenant_id,
                GymClass.modality.in_(eligible_modalities),
                GymClass.start_time >= window_open,
                GymClass.end_time >= now_utc,
            )
        )
        return result.scalar_one_or_none()

    # Return (Reservation, GymClass.start_time) rows so we can sort without lazy loading
    rows = (await db.execute(
        select(Reservation, GymClass.start_time)
        .join(GymClass, GymClass.id == Reservation.gym_class_id)
        .where(
            Reservation.user_id == user_id,
            Reservation.tenant_id == tenant_id,
            Reservation.status.in_(eligible_statuses),
            GymClass.tenant_id == tenant_id,
            GymClass.modality.in_(eligible_modalities),
            GymClass.start_time >= window_open,
            GymClass.end_time >= now_utc,
        )
        .order_by(GymClass.start_time.asc())
    )).all()
    if not rows:
        return None
    # Pick closest to now; ties already broken by asc order (earliest start_time)
    best_reservation, _ = min(rows, key=lambda row: abs((row[1] - now_utc).total_seconds()))
    return best_reservation


async def _create_checkin_record(
    db: AsyncSession,
    tenant_id: UUID,
    checked_in_by: UUID,
    user_id: UUID,
    gym_class_id: Optional[UUID],
    branch_id: Optional[UUID],
    check_type: str,
    reservation: Optional[Reservation] = None,
) -> tuple[CheckIn, str]:
    """Create a check-in record and optionally link it to a reservation.

    Returns (checkin, attendance_resolution) where resolution is one of:
      "linked"           — new attendance recorded
      "already_attended" — reservation was already attended; idempotent response
      "none"             — general check-in, no class linked
    """
    now_utc = datetime.now(timezone.utc)

    if reservation is not None:
        if reservation.status == ReservationStatus.ATTENDED:
            # Idempotent: find existing linked check-in if present
            existing_result = await db.execute(
                select(CheckIn).where(CheckIn.reservation_id == reservation.id)
            )
            existing = existing_result.scalar_one_or_none()
            if existing:
                return existing, "already_attended"
            # Legacy attended reservation without a linked checkin — create one but don't re-attend
            checkin = CheckIn(
                tenant_id=tenant_id,
                user_id=user_id,
                gym_class_id=reservation.gym_class_id,
                reservation_id=reservation.id,
                branch_id=branch_id,
                check_type=check_type,
                checked_in_by=checked_in_by,
                checked_in_at=now_utc,
            )
            db.add(checkin)
            await db.flush()
            await db.refresh(checkin)
            return checkin, "already_attended"

        # Link check-in to reservation and mark attended
        checkin = CheckIn(
            tenant_id=tenant_id,
            user_id=user_id,
            gym_class_id=reservation.gym_class_id,
            reservation_id=reservation.id,
            branch_id=branch_id,
            check_type=check_type,
            checked_in_by=checked_in_by,
            checked_in_at=now_utc,
        )
        db.add(checkin)
        reservation.status = ReservationStatus.ATTENDED
        reservation.attended_at = now_utc
        await db.flush()
        await db.refresh(checkin)
        return checkin, "linked"

    # General check-in — no class association
    checkin = CheckIn(
        tenant_id=tenant_id,
        user_id=user_id,
        gym_class_id=gym_class_id,
        reservation_id=None,
        branch_id=branch_id,
        check_type=check_type,
        checked_in_by=checked_in_by,
        checked_in_at=now_utc,
    )
    db.add(checkin)
    await db.flush()
    await db.refresh(checkin)
    return checkin, "none"


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
    member_plan_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
):
    valid_program_filter = _valid_program_class_filter(ctx.tenant_id)

    query = select(GymClass).where(GymClass.tenant_id == ctx.tenant_id, valid_program_filter)
    count_query = select(func.count()).select_from(GymClass).where(GymClass.tenant_id == ctx.tenant_id, valid_program_filter)

    # When a member_plan_id is provided, show only unrestricted classes or classes for that plan
    if member_plan_id is not None:
        plan_filter = or_(GymClass.restricted_plan_id.is_(None), GymClass.restricted_plan_id == member_plan_id)
        query = query.where(plan_filter)
        count_query = count_query.where(plan_filter)

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


def _validate_bulk_cancel_request(data: BulkClassCancelRequest) -> None:
    if data.date_from > data.date_to:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser mayor a la fecha final")
    if data.time_from >= data.time_to:
        raise HTTPException(status_code=400, detail="La hora inicial debe ser menor a la hora final")


def _bulk_cancel_date_bounds(
    data: BulkClassCancelRequest,
    zone: ZoneInfo,
) -> tuple[datetime, datetime]:
    range_start_local = datetime.combine(data.date_from, time.min, tzinfo=zone)
    range_end_local = datetime.combine(data.date_to + timedelta(days=1), time.min, tzinfo=zone)
    return range_start_local.astimezone(timezone.utc), range_end_local.astimezone(timezone.utc)


def _class_overlaps_bulk_cancel_window(
    gym_class: GymClass,
    zone: ZoneInfo,
    time_from: time,
    time_to: time,
) -> bool:
    start_local = gym_class.start_time.astimezone(zone)
    end_local = gym_class.end_time.astimezone(zone)
    window_start = datetime.combine(start_local.date(), time_from, tzinfo=zone)
    window_end = datetime.combine(start_local.date(), time_to, tzinfo=zone)
    return end_local > window_start and start_local < window_end


async def _resolve_bulk_cancel_classes(
    db: AsyncSession,
    ctx: TenantContext,
    data: BulkClassCancelRequest,
) -> list[GymClass]:
    _validate_bulk_cancel_request(data)
    zone = _tenant_zone(ctx)
    now_utc = datetime.now(timezone.utc)
    range_start_utc, range_end_utc = _bulk_cancel_date_bounds(data, zone)

    query = select(GymClass).where(
        GymClass.tenant_id == ctx.tenant_id,
        GymClass.status == ClassStatus.SCHEDULED,
        GymClass.start_time > now_utc,
        GymClass.start_time >= range_start_utc,
        GymClass.start_time < range_end_utc,
    )
    if data.branch_id:
        query = query.where(GymClass.branch_id == data.branch_id)
    if data.instructor_id:
        query = query.where(GymClass.instructor_id == data.instructor_id)

    classes = (
        await db.execute(query.order_by(GymClass.start_time.asc()))
    ).scalars().all()

    return [
        gym_class for gym_class in classes
        if _class_overlaps_bulk_cancel_window(gym_class, zone, data.time_from, data.time_to)
    ]


async def _load_bulk_cancel_active_reservations(
    db: AsyncSession,
    tenant_id: UUID,
    class_ids: list[UUID],
) -> list[Reservation]:
    if not class_ids:
        return []

    result = await db.execute(
        select(Reservation).where(
            Reservation.tenant_id == tenant_id,
            Reservation.gym_class_id.in_(class_ids),
            Reservation.status.in_([ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED]),
        )
    )
    return result.scalars().all()


def _summarize_bulk_cancel_reservations(
    reservations: list[Reservation],
) -> tuple[int, int, set[UUID]]:
    confirmed_count = sum(1 for reservation in reservations if reservation.status == ReservationStatus.CONFIRMED)
    waitlisted_count = sum(1 for reservation in reservations if reservation.status == ReservationStatus.WAITLISTED)
    user_ids = {reservation.user_id for reservation in reservations}
    return confirmed_count, waitlisted_count, user_ids


async def _build_bulk_cancel_items(
    db: AsyncSession,
    classes: list[GymClass],
) -> list[BulkCancelableClassItem]:
    if not classes:
        return []

    class_responses = await build_gym_class_responses(db, classes)
    return [
        BulkCancelableClassItem(
            id=gym_class.id,
            name=gym_class.name,
            start_time=gym_class.start_time,
            end_time=gym_class.end_time,
            branch_name=gym_class.branch_name,
            instructor_name=gym_class.instructor_name,
            current_bookings=gym_class.current_bookings,
        )
        for gym_class in class_responses
    ]


async def _build_bulk_cancel_preview_response(
    db: AsyncSession,
    ctx: TenantContext,
    data: BulkClassCancelRequest,
) -> BulkClassCancelPreviewResponse:
    classes = await _resolve_bulk_cancel_classes(db, ctx, data)
    reservations = await _load_bulk_cancel_active_reservations(db, ctx.tenant_id, [gym_class.id for gym_class in classes])
    confirmed_count, waitlisted_count, user_ids = _summarize_bulk_cancel_reservations(reservations)
    items = await _build_bulk_cancel_items(db, classes)

    return BulkClassCancelPreviewResponse(
        matched_classes=len(classes),
        confirmed_reservations=confirmed_count,
        waitlisted_reservations=waitlisted_count,
        notified_users=len(user_ids),
        items=items,
    )


def _build_bulk_cancel_notification_message(
    gym_class: GymClass,
    zone: ZoneInfo,
    cancel_reason: Optional[str] = None,
) -> str:
    start_local = gym_class.start_time.astimezone(zone)
    schedule_label = start_local.strftime("%d/%m a las %H:%M")
    message = f"La clase {gym_class.name} del {schedule_label} fue cancelada."
    if cancel_reason:
        return f"{message} Motivo: {cancel_reason}"
    return message


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

    bookings_by_user: dict[UUID, ProgramBooking] = {}
    programs_by_id: dict[UUID, TrainingProgram] = {}
    if gym_class.recurrence_group_id and reservation_rows:
        booking_rows = await db.execute(
            select(ProgramBooking, TrainingProgram)
            .outerjoin(TrainingProgram, TrainingProgram.id == ProgramBooking.program_id)
            .where(
                ProgramBooking.tenant_id == ctx.tenant_id,
                ProgramBooking.recurrence_group_id == gym_class.recurrence_group_id,
                ProgramBooking.user_id.in_([reservation.user_id for reservation, _user in reservation_rows]),
            )
        )
        for booking, program in booking_rows.all():
            bookings_by_user[booking.user_id] = booking
            if program:
                programs_by_id[program.id] = program

    items: list[ClassReservationDetailResponse] = []
    for reservation, user in reservation_rows:
        program_booking = bookings_by_user.get(reservation.user_id)
        program = programs_by_id.get(program_booking.program_id) if program_booking and program_booking.program_id else None
        items.append(
            _build_class_reservation_detail_response(
                reservation,
                user,
                program_booking=program_booking,
                program=program,
            )
        )
    return items


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


@router.post("/classes/bulk-cancel/preview", response_model=BulkClassCancelPreviewResponse)
async def preview_bulk_cancel_classes(
    data: BulkClassCancelRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    return await _build_bulk_cancel_preview_response(db, ctx, data)


@router.post("/classes/bulk-cancel", response_model=BulkClassCancelResponse)
async def bulk_cancel_classes(
    data: BulkClassCancelRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    zone = _tenant_zone(ctx)
    now_utc = datetime.now(timezone.utc)
    cancel_reason = data.cancel_reason.strip() if data.cancel_reason and data.cancel_reason.strip() else None

    classes = await _resolve_bulk_cancel_classes(db, ctx, data)
    reservations = await _load_bulk_cancel_active_reservations(db, ctx.tenant_id, [gym_class.id for gym_class in classes])
    confirmed_count, waitlisted_count, affected_user_ids = _summarize_bulk_cancel_reservations(reservations)
    reservations_by_class: dict[UUID, list[Reservation]] = {}
    for reservation in reservations:
        reservations_by_class.setdefault(reservation.gym_class_id, []).append(reservation)

    notification_failures = 0
    cancelled_classes = 0
    cancelled_reservations = 0
    skipped_classes = 0
    cancelled_items: list[GymClass] = []

    for gym_class in classes:
        if (
            gym_class.status != ClassStatus.SCHEDULED
            or gym_class.start_time <= now_utc
            or not _class_overlaps_bulk_cancel_window(gym_class, zone, data.time_from, data.time_to)
        ):
            skipped_classes += 1
            continue

        gym_class.status = ClassStatus.CANCELLED
        gym_class.current_bookings = 0
        cancelled_classes += 1
        cancelled_items.append(gym_class)

        class_reservations = reservations_by_class.get(gym_class.id, [])
        for reservation in class_reservations:
            reservation.status = ReservationStatus.CANCELLED
            reservation.cancelled_at = now_utc
            if cancel_reason:
                reservation.cancel_reason = cancel_reason
            cancelled_reservations += 1

            if not data.notify_members:
                continue

            try:
                dispatch_result = await create_and_dispatch_notification(
                    db,
                    tenant_id=ctx.tenant_id,
                    user_id=reservation.user_id,
                    title="Clase cancelada",
                    message=_build_bulk_cancel_notification_message(gym_class, zone, cancel_reason),
                    type="warning",
                    action_url="?tab=agenda",
                )
            except Exception as exc:  # pragma: no cover - defensive logging
                notification_failures += 1
                logger.warning(
                    "bulk_class_cancel_notification_failed",
                    exc_info=exc,
                    tenant_id=str(ctx.tenant_id),
                    class_id=str(gym_class.id),
                    user_id=str(reservation.user_id),
                )
                continue

            notification_failures += sum(1 for delivery in dispatch_result.deliveries if delivery.status == "error")

    await db.flush()

    items = await _build_bulk_cancel_items(db, cancelled_items)
    return BulkClassCancelResponse(
        matched_classes=len(classes),
        confirmed_reservations=confirmed_count,
        waitlisted_reservations=waitlisted_count,
        notified_users=len(affected_user_ids) if data.notify_members else 0,
        items=items,
        cancelled_classes=cancelled_classes,
        cancelled_reservations=cancelled_reservations,
        notification_failures=notification_failures,
        skipped_classes=skipped_classes,
    )


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

    # Check existing reservation (any status)
    existing_result = await db.execute(
        select(Reservation).where(
            Reservation.user_id == user_id,
            Reservation.gym_class_id == data.gym_class_id,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        if existing.status in (ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED):
            raise HTTPException(status_code=400, detail="Ya existe una reserva para esta clase")
        # Reactivate cancelled/no_show reservation instead of inserting (avoids UniqueConstraint violation)

    # Check plan reservation limits
    membership_state = await sync_membership_timeline(db, tenant_id=ctx.tenant_id, user_id=user_id)
    membership = membership_state.access_membership
    if membership:
        plan = await db.get(Plan, membership.plan_id)
        if plan:
            class_dt = gym_class.start_time
            if plan.max_reservations_per_week:
                week_start = class_dt.date() - timedelta(days=class_dt.weekday())
                week_end = week_start + timedelta(days=7)
                week_count_result = await db.execute(
                    select(func.count()).select_from(Reservation).join(
                        GymClass, Reservation.gym_class_id == GymClass.id
                    ).where(
                        Reservation.user_id == user_id,
                        Reservation.tenant_id == ctx.tenant_id,
                        Reservation.status == ReservationStatus.CONFIRMED,
                        GymClass.start_time >= datetime.combine(week_start, datetime.min.time(), tzinfo=timezone.utc),
                        GymClass.start_time < datetime.combine(week_end, datetime.min.time(), tzinfo=timezone.utc),
                    )
                )
                if (week_count_result.scalar() or 0) >= plan.max_reservations_per_week:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Has alcanzado el límite de {plan.max_reservations_per_week} reservas por semana de tu plan"
                    )
            if plan.max_reservations_per_month:
                month_start = class_dt.date().replace(day=1)
                if month_start.month == 12:
                    month_end = month_start.replace(year=month_start.year + 1, month=1)
                else:
                    month_end = month_start.replace(month=month_start.month + 1)
                month_count_result = await db.execute(
                    select(func.count()).select_from(Reservation).join(
                        GymClass, Reservation.gym_class_id == GymClass.id
                    ).where(
                        Reservation.user_id == user_id,
                        Reservation.tenant_id == ctx.tenant_id,
                        Reservation.status == ReservationStatus.CONFIRMED,
                        GymClass.start_time >= datetime.combine(month_start, datetime.min.time(), tzinfo=timezone.utc),
                        GymClass.start_time < datetime.combine(month_end, datetime.min.time(), tzinfo=timezone.utc),
                    )
                )
                if (month_count_result.scalar() or 0) >= plan.max_reservations_per_month:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Has alcanzado el límite de {plan.max_reservations_per_month} reservas por mes de tu plan"
                    )

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

    if existing:
        existing.status = reservation_status
        existing.waitlist_position = waitlist_pos
        existing.cancel_reason = None
        existing.cancelled_at = None
        reservation = existing
    else:
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
    await db.commit()
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

@router.get("/checkins/context", response_model=CheckInContextResponse)
async def get_checkin_context(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    if ctx.tenant is None:
        raise HTTPException(status_code=400, detail="No encontramos la cuenta actual del gimnasio")

    branches = (
        await db.execute(
            select(Branch)
            .where(Branch.tenant_id == ctx.tenant_id, Branch.is_active == True)
            .order_by(Branch.created_at.asc())
        )
    ).scalars().all()

    return CheckInContextResponse(
        tenant_name=ctx.tenant.name,
        tenant_slug=ctx.tenant.slug,
        timezone=ctx.tenant.timezone,
        logo_url=ctx.tenant.logo_url,
        primary_color=coerce_brand_color(ctx.tenant.primary_color, DEFAULT_PRIMARY_COLOR),
        secondary_color=coerce_brand_color(ctx.tenant.secondary_color, DEFAULT_SECONDARY_COLOR),
        branches=[BranchResponse.model_validate(branch) for branch in branches],
    )


@router.get("/checkins", response_model=PaginatedResponse)
async def list_checkins(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    branch_id: Optional[UUID] = Query(None),
    user_id: Optional[UUID] = Query(None),
    check_type: Optional[str] = Query(None, pattern=r"^(manual|qr|auto)$"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser mayor a la fecha final")

    zone = _tenant_zone(ctx)
    query = select(CheckIn).where(CheckIn.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(CheckIn).where(CheckIn.tenant_id == ctx.tenant_id)

    if branch_id:
        query = query.where(CheckIn.branch_id == branch_id)
        count_query = count_query.where(CheckIn.branch_id == branch_id)
    if user_id:
        query = query.where(CheckIn.user_id == user_id)
        count_query = count_query.where(CheckIn.user_id == user_id)
    if check_type:
        query = query.where(CheckIn.check_type == check_type)
        count_query = count_query.where(CheckIn.check_type == check_type)
    if date_from:
        start_utc, _ = _tenant_local_day_bounds(date_from, zone)
        query = query.where(CheckIn.checked_in_at >= start_utc)
        count_query = count_query.where(CheckIn.checked_in_at >= start_utc)
    if date_to:
        _, end_utc = _tenant_local_day_bounds(date_to, zone)
        query = query.where(CheckIn.checked_in_at < end_utc)
        count_query = count_query.where(CheckIn.checked_in_at < end_utc)

    total = (await db.execute(count_query)).scalar() or 0
    checkins = (
        await db.execute(
            query
            .order_by(CheckIn.checked_in_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).scalars().all()

    return PaginatedResponse(
        items=await _build_checkin_history_items(db, checkins),
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page if per_page else 0,
    )


@router.get("/checkins/suspicious-cases", response_model=PaginatedResponse)
async def list_checkin_investigation_cases(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: str = Query("open", pattern=r"^(open|dismissed|confirmed|all)$"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    query = select(CheckInInvestigationCase).where(
        CheckInInvestigationCase.tenant_id == ctx.tenant_id,
        CheckInInvestigationCase.rule_code == SUSPICIOUS_QR_RULE,
    )
    count_query = select(func.count()).select_from(CheckInInvestigationCase).where(
        CheckInInvestigationCase.tenant_id == ctx.tenant_id,
        CheckInInvestigationCase.rule_code == SUSPICIOUS_QR_RULE,
    )

    if status != "all":
        query = query.where(CheckInInvestigationCase.status == status)
        count_query = count_query.where(CheckInInvestigationCase.status == status)

    total = (await db.execute(count_query)).scalar() or 0
    cases = (
        await db.execute(
            query
            .order_by(CheckInInvestigationCase.last_triggered_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).scalars().all()

    return PaginatedResponse(
        items=await _build_checkin_case_items(db, cases),
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page if per_page else 0,
    )


@router.get("/checkins/suspicious-cases/{case_id}", response_model=CheckInInvestigationCaseDetailResponse)
async def get_checkin_investigation_case(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    case = (
        await db.execute(
            select(CheckInInvestigationCase).where(
                CheckInInvestigationCase.id == case_id,
                CheckInInvestigationCase.tenant_id == ctx.tenant_id,
                CheckInInvestigationCase.rule_code == SUSPICIOUS_QR_RULE,
            )
        )
    ).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="No encontramos el caso sospechoso solicitado")

    return await _build_checkin_case_detail(db, ctx, case)


@router.patch("/checkins/suspicious-cases/{case_id}", response_model=CheckInInvestigationCaseDetailResponse)
async def update_checkin_investigation_case(
    case_id: UUID,
    data: CheckInInvestigationCaseUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
    _user=Depends(require_roles("owner", "admin")),
):
    case = (
        await db.execute(
            select(CheckInInvestigationCase).where(
                CheckInInvestigationCase.id == case_id,
                CheckInInvestigationCase.tenant_id == ctx.tenant_id,
                CheckInInvestigationCase.rule_code == SUSPICIOUS_QR_RULE,
            )
        )
    ).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="No encontramos el caso sospechoso solicitado")

    if data.status is not None:
        case.status = data.status
    if data.review_notes is not None:
        case.review_notes = data.review_notes.strip() or None
    if data.status is not None or data.review_notes is not None:
        case.reviewed_by = current_user.id
        case.reviewed_at = datetime.now(timezone.utc)

    await db.flush()
    return await _build_checkin_case_detail(db, ctx, case)


@router.post("/checkins", response_model=CheckInResponse, status_code=201)
async def create_checkin(
    data: CheckInCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    client = await _get_checkin_client(db, ctx.tenant_id, data.user_id)
    now_utc = datetime.now(timezone.utc)
    reservation = await _resolve_eligible_reservation(
        db, ctx.tenant_id, client.id, now_utc, data.gym_class_id
    )
    if data.gym_class_id and reservation is None:
        raise HTTPException(status_code=409, detail="No se encontró una reserva vigente para esta clase")
    checkin, resolution = await _create_checkin_record(
        db=db,
        tenant_id=ctx.tenant_id,
        checked_in_by=current_user.id,
        user_id=client.id,
        gym_class_id=data.gym_class_id,
        branch_id=data.branch_id,
        check_type=data.check_type,
        reservation=reservation,
    )
    gym_class_name: Optional[str] = None
    if checkin.gym_class_id and reservation:
        gym_class_result = await db.execute(select(GymClass).where(GymClass.id == checkin.gym_class_id))
        gym_class = gym_class_result.scalar_one_or_none()
        gym_class_name = gym_class.name if gym_class else None
    return _build_checkin_response(checkin, user_name=client.full_name, attendance_resolution=resolution, resolved_gym_class_name=gym_class_name)


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

    membership_state = await sync_membership_timeline(db, tenant_id=ctx.tenant_id, user_id=client.id)
    membership = membership_state.access_membership
    if not membership or membership.id != membership_id:
        raise HTTPException(status_code=400, detail="El código QR no corresponde a una membresía activa")

    now_utc = datetime.now(timezone.utc)
    reservation = await _resolve_eligible_reservation(
        db, ctx.tenant_id, client.id, now_utc, data.gym_class_id
    )
    if data.gym_class_id and reservation is None:
        raise HTTPException(status_code=409, detail="No se encontró una reserva vigente para esta clase")
    checkin, resolution = await _create_checkin_record(
        db=db,
        tenant_id=ctx.tenant_id,
        checked_in_by=current_user.id,
        user_id=client.id,
        gym_class_id=data.gym_class_id,
        branch_id=data.branch_id,
        check_type="qr",
        reservation=reservation,
    )
    gym_class_name: Optional[str] = None
    if checkin.gym_class_id and reservation:
        gym_class_result = await db.execute(select(GymClass).where(GymClass.id == checkin.gym_class_id))
        gym_class = gym_class_result.scalar_one_or_none()
        gym_class_name = gym_class.name if gym_class else None
    await _detect_qr_frequency_case(db, ctx, checkin)
    return _build_checkin_response(checkin, user_name=client.full_name, attendance_resolution=resolution, resolved_gym_class_name=gym_class_name)


# ─── Replicate Classes ────────────────────────────────────────────────────────

class ReplicateRequest(BaseModel):
    mode: Literal["day", "week", "month"]
    source_date: date
    target_dates: List[date]  # for day: target days; week: any day in target week; month: any day in target month


@router.post("/classes/replicate", status_code=201)
async def replicate_classes(
    body: ReplicateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _: User = Depends(require_roles("owner", "admin")),
):
    """Copy all classes from a source day/week/month into one or more target periods."""

    created: list[dict] = []

    if body.mode == "day":
        source_start = datetime.combine(body.source_date, datetime.min.time(), tzinfo=timezone.utc)
        source_end = datetime.combine(body.source_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        result = await db.execute(
            select(GymClass).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.start_time >= source_start,
                GymClass.start_time < source_end,
                GymClass.status != ClassStatus.CANCELLED,
            )
        )
        source_classes = result.scalars().all()

        for target_date in body.target_dates:
            delta = target_date - body.source_date
            for cls in source_classes:
                new_cls = GymClass(
                    tenant_id=cls.tenant_id,
                    branch_id=cls.branch_id,
                    name=cls.name,
                    description=cls.description,
                    class_type=cls.class_type,
                    modality=cls.modality,
                    status=ClassStatus.SCHEDULED,
                    instructor_id=cls.instructor_id,
                    start_time=cls.start_time + timedelta(days=delta.days),
                    end_time=cls.end_time + timedelta(days=delta.days),
                    max_capacity=cls.max_capacity,
                    current_bookings=0,
                    waitlist_enabled=cls.waitlist_enabled,
                    online_link=cls.online_link,
                    cancellation_deadline_hours=cls.cancellation_deadline_hours,
                    color=cls.color,
                    program_id=cls.program_id,
                    repeat_type="none",
                )
                db.add(new_cls)
                created.append({"name": new_cls.name, "date": str(target_date)})

    elif body.mode == "week":
        # Source week: Monday of the week containing source_date
        source_monday = body.source_date - timedelta(days=body.source_date.weekday())
        source_start = datetime.combine(source_monday, datetime.min.time(), tzinfo=timezone.utc)
        source_end = datetime.combine(source_monday + timedelta(days=7), datetime.min.time(), tzinfo=timezone.utc)
        result = await db.execute(
            select(GymClass).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.start_time >= source_start,
                GymClass.start_time < source_end,
                GymClass.status != ClassStatus.CANCELLED,
            )
        )
        source_classes = result.scalars().all()

        for target_date in body.target_dates:
            target_monday = target_date - timedelta(days=target_date.weekday())
            week_delta = (target_monday - source_monday).days
            for cls in source_classes:
                new_cls = GymClass(
                    tenant_id=cls.tenant_id,
                    branch_id=cls.branch_id,
                    name=cls.name,
                    description=cls.description,
                    class_type=cls.class_type,
                    modality=cls.modality,
                    status=ClassStatus.SCHEDULED,
                    instructor_id=cls.instructor_id,
                    start_time=cls.start_time + timedelta(days=week_delta),
                    end_time=cls.end_time + timedelta(days=week_delta),
                    max_capacity=cls.max_capacity,
                    current_bookings=0,
                    waitlist_enabled=cls.waitlist_enabled,
                    online_link=cls.online_link,
                    cancellation_deadline_hours=cls.cancellation_deadline_hours,
                    color=cls.color,
                    program_id=cls.program_id,
                    repeat_type="none",
                )
                db.add(new_cls)
                created.append({"name": new_cls.name, "date": str(cls.start_time.date() + timedelta(days=week_delta))})

    elif body.mode == "month":
        source_month_start = body.source_date.replace(day=1)
        if source_month_start.month == 12:
            source_month_end = source_month_start.replace(year=source_month_start.year + 1, month=1)
        else:
            source_month_end = source_month_start.replace(month=source_month_start.month + 1)

        result = await db.execute(
            select(GymClass).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.start_time >= datetime.combine(source_month_start, datetime.min.time(), tzinfo=timezone.utc),
                GymClass.start_time < datetime.combine(source_month_end, datetime.min.time(), tzinfo=timezone.utc),
                GymClass.status != ClassStatus.CANCELLED,
            )
        )
        source_classes = result.scalars().all()

        import calendar as cal_module
        for target_date in body.target_dates:
            target_month_start = target_date.replace(day=1)
            for cls in source_classes:
                src_day = cls.start_time.day
                days_in_target = cal_module.monthrange(target_month_start.year, target_month_start.month)[1]
                target_day = min(src_day, days_in_target)
                try:
                    new_date = target_month_start.replace(day=target_day)
                except ValueError:
                    new_date = target_month_start.replace(day=days_in_target)
                delta_days = (new_date - cls.start_time.date()).days
                new_cls = GymClass(
                    tenant_id=cls.tenant_id,
                    branch_id=cls.branch_id,
                    name=cls.name,
                    description=cls.description,
                    class_type=cls.class_type,
                    modality=cls.modality,
                    status=ClassStatus.SCHEDULED,
                    instructor_id=cls.instructor_id,
                    start_time=cls.start_time + timedelta(days=delta_days),
                    end_time=cls.end_time + timedelta(days=delta_days),
                    max_capacity=cls.max_capacity,
                    current_bookings=0,
                    waitlist_enabled=cls.waitlist_enabled,
                    online_link=cls.online_link,
                    cancellation_deadline_hours=cls.cancellation_deadline_hours,
                    color=cls.color,
                    program_id=cls.program_id,
                    repeat_type="none",
                )
                db.add(new_cls)
                created.append({"name": new_cls.name, "date": str(new_date)})

    await db.commit()
    return {"created": len(created), "classes": created}


# ─── Program Bookings ─────────────────────────────────────────────────────────

async def _build_program_booking_out(
    db: AsyncSession,
    booking: ProgramBooking,
    *,
    user: Optional[User] = None,
    program: Optional[TrainingProgram] = None,
) -> ProgramBookingOut:
    if user is None:
        user = await db.get(User, booking.user_id)
    if booking.program_id and program is None:
        program = await db.get(TrainingProgram, booking.program_id)

    reservations_result = await db.execute(
        select(Reservation)
        .join(GymClass, Reservation.gym_class_id == GymClass.id)
        .where(
            Reservation.user_id == booking.user_id,
            GymClass.recurrence_group_id == booking.recurrence_group_id,
            Reservation.status.in_([ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED]),
        )
    )
    reservations = reservations_result.scalars().all()

    total_result = await db.execute(
        select(func.count())
        .select_from(GymClass)
        .where(
            GymClass.recurrence_group_id == booking.recurrence_group_id,
            GymClass.status != ClassStatus.CANCELLED,
        )
    )
    total_classes = total_result.scalar() or 0

    reserved = sum(1 for r in reservations if r.status == ReservationStatus.CONFIRMED)
    waitlisted = sum(1 for r in reservations if r.status == ReservationStatus.WAITLISTED)

    return ProgramBookingOut(
        id=booking.id,
        user_id=booking.user_id,
        program_id=booking.program_id,
        user_name=user.full_name if user else None,
        user_email=user.email if user else None,
        user_phone=user.phone if user else None,
        program_name=program.name if program else None,
        recurrence_group_id=booking.recurrence_group_id,
        status=booking.status,
        total_classes=total_classes,
        reserved_classes=reserved,
        waitlisted_classes=waitlisted,
        failed_classes=max(0, total_classes - reserved - waitlisted),
        cancel_reason=booking.cancel_reason,
        cancelled_at=booking.cancelled_at,
        created_at=booking.created_at,
    )


async def _send_program_booking_created_email(
    *,
    booking_owner: User,
    gym_name: str,
    program_name: str,
    booking_out: ProgramBookingOut,
) -> None:
    if not booking_owner.email:
        return

    try:
        await email_service.send_program_booking_created(
            to_email=booking_owner.email,
            first_name=booking_owner.first_name,
            gym_name=gym_name,
            program_name=program_name,
            total_classes=booking_out.total_classes,
            confirmed_classes=booking_out.reserved_classes,
            waitlisted_classes=booking_out.waitlisted_classes,
        )
    except Exception as exc:
        logger.warning(
            "program_booking_created_email_failed",
            booking_id=str(booking_out.id),
            user_id=str(booking_owner.id),
            exc_info=exc,
        )


async def _send_program_booking_cancelled_email(
    *,
    booking_owner: User,
    gym_name: str,
    program_name: str,
    cancelled_classes: int,
    skipped_deadline: int,
    cancel_reason: Optional[str],
) -> None:
    if not booking_owner.email:
        return

    try:
        await email_service.send_program_booking_cancelled(
            to_email=booking_owner.email,
            first_name=booking_owner.first_name,
            gym_name=gym_name,
            program_name=program_name,
            cancelled_classes=cancelled_classes,
            skipped_deadline=skipped_deadline,
            cancel_reason=cancel_reason,
        )
    except Exception as exc:
        logger.warning(
            "program_booking_cancelled_email_failed",
            user_id=str(booking_owner.id),
            program_name=program_name,
            exc_info=exc,
        )


@router.post("/program-bookings", response_model=ProgramBookingOut, status_code=201)
async def create_program_booking(
    data: ProgramBookingCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    # Verify program belongs to tenant
    program = await db.get(TrainingProgram, data.program_id)
    if not program or program.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Programa no encontrado")

    # Check for existing active booking
    existing_result = await db.execute(
        select(ProgramBooking).where(
            ProgramBooking.user_id == current_user.id,
            ProgramBooking.recurrence_group_id == data.recurrence_group_id,
            ProgramBooking.status == "active",
        )
    )
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya tenés una reserva activa para este programa")

    # Get future classes in this recurrence group
    now = datetime.now(timezone.utc)
    classes_result = await db.execute(
        select(GymClass).where(
            GymClass.recurrence_group_id == data.recurrence_group_id,
            GymClass.tenant_id == ctx.tenant_id,
            GymClass.status != ClassStatus.CANCELLED,
            GymClass.start_time > now,
        ).order_by(GymClass.start_time)
    )
    classes = classes_result.scalars().all()

    # Create booking record
    booking = ProgramBooking(
        tenant_id=ctx.tenant_id,
        user_id=current_user.id,
        program_id=data.program_id,
        recurrence_group_id=data.recurrence_group_id,
        status="active",
    )
    db.add(booking)

    # Reserve each class
    for gym_class in classes:
        existing_res_result = await db.execute(
            select(Reservation).where(
                Reservation.user_id == current_user.id,
                Reservation.gym_class_id == gym_class.id,
            )
        )
        existing_res = existing_res_result.scalar_one_or_none()
        if existing_res and existing_res.status in (ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED):
            continue

        if gym_class.current_bookings >= gym_class.max_capacity:
            if not gym_class.waitlist_enabled:
                continue
            res_status = ReservationStatus.WAITLISTED
            wl_count_result = await db.execute(
                select(func.count()).where(
                    Reservation.gym_class_id == gym_class.id,
                    Reservation.status == ReservationStatus.WAITLISTED,
                )
            )
            waitlist_pos = (wl_count_result.scalar() or 0) + 1
        else:
            res_status = ReservationStatus.CONFIRMED
            waitlist_pos = None
            gym_class.current_bookings += 1

        if existing_res:
            existing_res.status = res_status
            existing_res.waitlist_position = waitlist_pos
            existing_res.cancel_reason = None
            existing_res.cancelled_at = None
        else:
            new_res = Reservation(
                tenant_id=ctx.tenant_id,
                user_id=current_user.id,
                gym_class_id=gym_class.id,
                status=res_status,
                waitlist_position=waitlist_pos,
            )
            db.add(new_res)

    await db.flush()
    await db.refresh(booking)
    result = await _build_program_booking_out(db, booking, user=current_user, program=program)
    await db.commit()
    await _send_program_booking_created_email(
        booking_owner=current_user,
        gym_name=ctx.tenant.name if ctx.tenant else "Nexo Fitness",
        program_name=program.name,
        booking_out=result,
    )
    return result


@router.get("/program-bookings", response_model=list[ProgramBookingOut])
async def list_program_bookings(
    status: Optional[str] = Query(default=None, description="active | cancelled | all"),
    program_id: Optional[UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    current_role = _role_value(current_user)
    is_staff = current_role in {"owner", "admin", "reception", "trainer"}

    query = select(ProgramBooking).where(ProgramBooking.tenant_id == ctx.tenant_id)
    if not is_staff:
        query = query.where(ProgramBooking.user_id == current_user.id)
    if program_id:
        query = query.where(ProgramBooking.program_id == program_id)
    if status and status != "all":
        query = query.where(ProgramBooking.status == status)

    query = query.order_by(ProgramBooking.created_at.desc())
    result = await db.execute(query)
    bookings = result.scalars().all()

    users_by_id: dict[UUID, User] = {}
    user_ids = list({booking.user_id for booking in bookings})
    if user_ids:
        user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_by_id = {user.id: user for user in user_rows.scalars().all()}

    programs_by_id: dict[UUID, TrainingProgram] = {}
    program_ids = list({booking.program_id for booking in bookings if booking.program_id})
    if program_ids:
        program_rows = await db.execute(select(TrainingProgram).where(TrainingProgram.id.in_(program_ids)))
        programs_by_id = {program.id: program for program in program_rows.scalars().all()}

    return [
        await _build_program_booking_out(
            db,
            booking,
            user=users_by_id.get(booking.user_id),
            program=programs_by_id.get(booking.program_id) if booking.program_id else None,
        )
        for booking in bookings
    ]


@router.get("/program-bookings/{booking_id}", response_model=ProgramBookingOut)
async def get_program_booking(
    booking_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    booking = await db.get(ProgramBooking, booking_id)
    if not booking or booking.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Reserva de programa no encontrada")

    current_role = _role_value(current_user)
    is_staff = current_role in {"owner", "admin", "reception", "trainer"}
    if booking.user_id != current_user.id and not is_staff:
        raise HTTPException(status_code=403, detail="No autorizado")

    booking_user = await db.get(User, booking.user_id)
    booking_program = await db.get(TrainingProgram, booking.program_id) if booking.program_id else None
    return await _build_program_booking_out(db, booking, user=booking_user, program=booking_program)


@router.get("/program-bookings/{booking_id}/reservations", response_model=list[ReservationResponse])
async def list_program_booking_reservations(
    booking_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    booking = await db.get(ProgramBooking, booking_id)
    if not booking or booking.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Reserva de programa no encontrada")

    current_role = _role_value(current_user)
    is_staff = current_role in {"owner", "admin", "reception", "trainer"}
    if booking.user_id != current_user.id and not is_staff:
        raise HTTPException(status_code=403, detail="No autorizado")

    result = await db.execute(
        select(Reservation)
        .join(GymClass, Reservation.gym_class_id == GymClass.id)
        .where(
            Reservation.user_id == booking.user_id,
            GymClass.recurrence_group_id == booking.recurrence_group_id,
        )
        .order_by(GymClass.start_time)
    )
    reservations = result.scalars().all()
    return [ReservationResponse.model_validate(r) for r in reservations]


@router.delete("/program-bookings/{booking_id}", status_code=200)
async def cancel_program_booking(
    booking_id: UUID,
    force: bool = Query(default=False, description="Staff only: ignore cancellation deadlines"),
    data: Optional[ProgramBookingCancelRequest] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    booking = await db.get(ProgramBooking, booking_id)
    if not booking or booking.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Reserva de programa no encontrada")

    booking_owner = await db.get(User, booking.user_id)
    program = await db.get(TrainingProgram, booking.program_id) if booking.program_id else None

    current_role = _role_value(current_user)
    is_staff = current_role in {"owner", "admin", "reception"}
    if booking.user_id != current_user.id and not is_staff:
        raise HTTPException(status_code=403, detail="No autorizado")

    if force and not is_staff:
        raise HTTPException(status_code=403, detail="Solo el staff puede forzar cancelaciones")

    if booking.status == "cancelled":
        raise HTTPException(status_code=400, detail="Esta reserva ya está cancelada")

    now = datetime.now(timezone.utc)

    # Get all active reservations for this recurrence group
    reservations_result = await db.execute(
        select(Reservation)
        .join(GymClass, Reservation.gym_class_id == GymClass.id)
        .where(
            Reservation.user_id == booking.user_id,
            GymClass.recurrence_group_id == booking.recurrence_group_id,
            Reservation.status.in_([ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED]),
            GymClass.start_time > now,
        )
    )
    reservations = reservations_result.scalars().all()

    cancelled_count = 0
    skipped_deadline = 0
    cancel_reason = data.cancel_reason if data else None

    for reservation in reservations:
        gym_class = await db.get(GymClass, reservation.gym_class_id)
        if not gym_class:
            continue

        if not force and reservation.status == ReservationStatus.CONFIRMED and gym_class.cancellation_deadline_hours > 0:
            deadline = gym_class.start_time - timedelta(hours=gym_class.cancellation_deadline_hours)
            if now > deadline:
                skipped_deadline += 1
                continue

        was_confirmed = reservation.status == ReservationStatus.CONFIRMED
        reservation.status = ReservationStatus.CANCELLED
        reservation.cancelled_at = now
        if cancel_reason:
            reservation.cancel_reason = cancel_reason

        if was_confirmed and gym_class.current_bookings > 0:
            gym_class.current_bookings -= 1
            waitlisted_result = await db.execute(
                select(Reservation).where(
                    Reservation.gym_class_id == gym_class.id,
                    Reservation.status == ReservationStatus.WAITLISTED,
                ).order_by(Reservation.waitlist_position)
            )
            first_waiting = waitlisted_result.scalars().first()
            if first_waiting:
                first_waiting.status = ReservationStatus.CONFIRMED
                first_waiting.waitlist_position = None
                gym_class.current_bookings += 1

        cancelled_count += 1

    booking.status = "cancelled"
    booking.cancelled_at = now
    if cancel_reason:
        booking.cancel_reason = cancel_reason

    await db.commit()
    if booking_owner:
        await _send_program_booking_cancelled_email(
            booking_owner=booking_owner,
            gym_name=ctx.tenant.name if ctx.tenant else "Nexo Fitness",
            program_name=program.name if program else "Programa",
            cancelled_classes=cancelled_count,
            skipped_deadline=skipped_deadline,
            cancel_reason=cancel_reason,
        )
    return {"cancelled": cancelled_count, "skipped_deadline": skipped_deadline}
