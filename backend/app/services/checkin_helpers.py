"""Helpers para construcción de respuestas, validación y queries de check-ins.

Mezcla de helpers puros (sin DB) y async (con DB). Re-exportados desde
`app.api.v1.endpoints.classes` con prefijo `_` para retrocompatibilidad
con tests existentes (test_reservation_bookable, test_checkin_cases,
test_checkin_reservation_alignment).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import TenantContext
from app.core.timezone import tenant_local_day_bounds, tenant_zone
from app.models.business import (
    Branch,
    CheckIn,
    CheckInInvestigationCase,
    ClassModality,
    GymClass,
    Membership,
    MembershipStatus,
    Reservation,
    ReservationStatus,
)
from app.models.user import User, UserRole
from app.schemas.business import (
    CheckInHistoryItemResponse,
    CheckInInvestigationCaseDetailResponse,
    CheckInInvestigationCaseResponse,
    CheckInResponse,
)


# Reglas de detección de fraude de QR
SUSPICIOUS_QR_RULE = "qr_frequency"
SUSPICIOUS_QR_WINDOW_THRESHOLD = 3
SUSPICIOUS_QR_DAILY_THRESHOLD = 5
SUSPICIOUS_QR_WINDOW_HOURS = 2

# Ventana de elegibilidad para vincular check-in con reserva de clase
CHECKIN_WINDOW_BEFORE_MINUTES = 60


def ensure_class_bookable(gym_class: GymClass, *, is_staff: bool, now_utc: datetime) -> None:
    """Validate that a class is open for new reservations.

    Staff (owner/admin/reception) bypass time checks to allow retroactive entry.
    Raises HTTPException(400) on past or in-window classes.
    """
    if is_staff:
        return
    class_start = gym_class.start_time
    if class_start.tzinfo is None:
        class_start = class_start.replace(tzinfo=timezone.utc)
    if class_start <= now_utc:
        raise HTTPException(
            status_code=400,
            detail="No se puede reservar una clase que ya comenzó o finalizó",
        )
    close_minutes = getattr(gym_class, "reservation_closes_minutes_before", 0) or 0
    if close_minutes > 0:
        cutoff = class_start - timedelta(minutes=close_minutes)
        if now_utc >= cutoff:
            raise HTTPException(
                status_code=400,
                detail=f"Las reservas para esta clase cerraron {close_minutes} minutos antes del inicio",
            )


def build_checkin_response(
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


def checkin_history_response(
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


def checkin_case_response(
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


def parse_qr_payload(qr_payload: str) -> tuple[str, UUID, UUID]:
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


# ─── DB-bound helpers ────────────────────────────────────────────────────────


async def build_checkin_history_items(
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
        checkin_history_response(
            checkin,
            user_name=users_by_id.get(checkin.user_id).full_name if users_by_id.get(checkin.user_id) else None,
            branch_name=branches_by_id.get(checkin.branch_id).name if checkin.branch_id and branches_by_id.get(checkin.branch_id) else None,
            gym_class_name=classes_by_id.get(checkin.gym_class_id).name if checkin.gym_class_id and classes_by_id.get(checkin.gym_class_id) else None,
            checked_in_by_name=users_by_id.get(checkin.checked_in_by).full_name if checkin.checked_in_by and users_by_id.get(checkin.checked_in_by) else None,
        )
        for checkin in checkins
    ]


async def build_checkin_case_items(
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
        checkin_case_response(
            case,
            user=users_by_id.get(case.user_id),
            reviewer=users_by_id.get(case.reviewed_by) if case.reviewed_by else None,
        )
        for case in cases
    ]


async def build_checkin_case_detail(
    db: AsyncSession,
    ctx: TenantContext,
    case: CheckInInvestigationCase,
) -> CheckInInvestigationCaseDetailResponse:
    zone = tenant_zone(ctx)
    day_start_utc, day_end_utc = tenant_local_day_bounds(case.local_day, zone)
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
    related_items = await build_checkin_history_items(db, related_checkins)

    users = (
        await db.execute(
            select(User).where(
                User.id.in_({case.user_id} | ({case.reviewed_by} if case.reviewed_by else set()))
            )
        )
    ).scalars().all()
    users_by_id = {user.id: user for user in users}
    summary = checkin_case_response(
        case,
        user=users_by_id.get(case.user_id),
        reviewer=users_by_id.get(case.reviewed_by) if case.reviewed_by else None,
    )

    return CheckInInvestigationCaseDetailResponse(
        **summary.model_dump(),
        related_checkins=related_items,
    )


async def detect_qr_frequency_case(
    db: AsyncSession,
    ctx: TenantContext,
    checkin: CheckIn,
) -> Optional[CheckInInvestigationCase]:
    if not ctx.tenant or checkin.check_type != "qr":
        return None

    zone = tenant_zone(ctx)
    local_day = checkin.checked_in_at.astimezone(zone).date()
    day_start_utc, day_end_utc = tenant_local_day_bounds(local_day, zone)
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


async def get_checkin_client(
    db: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
) -> User:
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
            User.role == UserRole.CLIENT,
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="No encontramos un cliente activo para registrar el ingreso")
    return user


async def resolve_eligible_reservation(
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
    best_reservation, _ = min(rows, key=lambda row: abs((row[1] - now_utc).total_seconds()))
    return best_reservation


async def create_checkin_record(
    db: AsyncSession,
    tenant_id: UUID,
    checked_in_by: UUID,
    user_id: UUID,
    gym_class_id: Optional[UUID],
    branch_id: Optional[UUID],
    check_type: str,
    reservation: Optional[Reservation] = None,
    access_membership: Optional[Membership] = None,
) -> tuple[CheckIn, str]:
    """Create a check-in record and optionally link it to a reservation.

    Returns (checkin, attendance_resolution) where resolution is one of:
      "linked"           — new attendance recorded
      "already_attended" — reservation was already attended; idempotent response
      "none"             — general check-in, no class linked

    Si `access_membership` es punch_pass/drop_in (uses_remaining is not None),
    valida que tenga pases disponibles y decrementa el contador. Si llega a 0
    marca la membresía como EXPIRED y setea expires_at = hoy.
    """
    now_utc = datetime.now(timezone.utc)

    # Punch pass / drop-in: validar + decrementar antes de crear el checkin.
    # Solo aplica cuando se está reutilizando un check-in (already_attended NO
    # debe decrementar de nuevo — eso lo manejamos abajo).
    if access_membership is not None and access_membership.uses_remaining is not None:
        is_duplicate_attendance = (
            reservation is not None and reservation.status == ReservationStatus.ATTENDED
        )
        if not is_duplicate_attendance:
            # Decremento atómico condicional: serializa check-ins concurrentes del
            # mismo pase (doble-scan QR / kiosko+recepción). El UPDATE solo descuenta
            # si aún quedan pases; 0 filas afectadas = sin pases → rebota. Evita el
            # read-modify-write con lost-update que dejaba gastar de más.
            new_remaining = (
                await db.execute(
                    update(Membership)
                    .where(Membership.id == access_membership.id, Membership.uses_remaining > 0)
                    .values(uses_remaining=Membership.uses_remaining - 1)
                    .returning(Membership.uses_remaining)
                )
            ).scalar_one_or_none()
            if new_remaining is None:
                raise HTTPException(
                    status_code=400,
                    detail="No quedan pases disponibles en esta membresía.",
                )
            # Sincroniza el objeto ORM en memoria con el valor atómico de la DB.
            access_membership.uses_remaining = new_remaining
            if new_remaining <= 0:
                access_membership.status = MembershipStatus.EXPIRED
                access_membership.expires_at = now_utc.date()

    if reservation is not None:
        if reservation.status == ReservationStatus.ATTENDED:
            existing_result = await db.execute(
                select(CheckIn).where(CheckIn.reservation_id == reservation.id)
            )
            existing = existing_result.scalar_one_or_none()
            if existing:
                return existing, "already_attended"
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
