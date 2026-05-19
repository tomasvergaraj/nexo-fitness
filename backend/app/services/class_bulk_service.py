"""Helpers para operaciones masivas sobre clases (bulk cancel / reassign).

Funciones puras + queries DB sin lógica HTTP. Re-exportadas desde
`app.api.v1.endpoints.classes` para retrocompatibilidad con tests existentes.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import TenantContext
from app.core.timezone import tenant_zone
from app.models.business import ClassStatus, GymClass, Reservation, ReservationStatus
from app.models.user import User, UserRole
from app.schemas.business import (
    BulkCancelableClassItem,
    BulkClassCancelPreviewResponse,
    BulkClassCancelRequest,
    BulkReassignableClassItem,
    BulkReassignInstructorRequest,
)
from app.services.class_service import build_gym_class_responses


def validate_bulk_cancel_request(data: BulkClassCancelRequest) -> None:
    if data.date_from > data.date_to:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser mayor a la fecha final")
    if data.time_from >= data.time_to:
        raise HTTPException(status_code=400, detail="La hora inicial debe ser menor a la hora final")


def bulk_cancel_date_bounds(
    data: BulkClassCancelRequest,
    zone: ZoneInfo,
) -> tuple[datetime, datetime]:
    range_start_local = datetime.combine(data.date_from, time.min, tzinfo=zone)
    range_end_local = datetime.combine(data.date_to + timedelta(days=1), time.min, tzinfo=zone)
    return range_start_local.astimezone(timezone.utc), range_end_local.astimezone(timezone.utc)


def class_overlaps_bulk_cancel_window(
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


def summarize_bulk_cancel_reservations(
    reservations: list[Reservation],
) -> tuple[int, int, set[UUID]]:
    confirmed_count = sum(1 for reservation in reservations if reservation.status == ReservationStatus.CONFIRMED)
    waitlisted_count = sum(1 for reservation in reservations if reservation.status == ReservationStatus.WAITLISTED)
    user_ids = {reservation.user_id for reservation in reservations}
    return confirmed_count, waitlisted_count, user_ids


def build_bulk_cancel_notification_message(
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


# ─── DB-bound bulk-cancel helpers ────────────────────────────────────────────


async def resolve_bulk_cancel_classes(
    db: AsyncSession,
    ctx: TenantContext,
    data: BulkClassCancelRequest,
) -> list[GymClass]:
    validate_bulk_cancel_request(data)
    zone = tenant_zone(ctx)
    now_utc = datetime.now(timezone.utc)
    range_start_utc, range_end_utc = bulk_cancel_date_bounds(data, zone)

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
        if class_overlaps_bulk_cancel_window(gym_class, zone, data.time_from, data.time_to)
    ]


async def load_bulk_cancel_active_reservations(
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
    return list(result.scalars().all())


async def build_bulk_cancel_items(
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


async def build_bulk_cancel_preview_response(
    db: AsyncSession,
    ctx: TenantContext,
    data: BulkClassCancelRequest,
) -> BulkClassCancelPreviewResponse:
    classes = await resolve_bulk_cancel_classes(db, ctx, data)
    reservations = await load_bulk_cancel_active_reservations(
        db, ctx.tenant_id, [gym_class.id for gym_class in classes]
    )
    confirmed_count, waitlisted_count, user_ids = summarize_bulk_cancel_reservations(reservations)
    items = await build_bulk_cancel_items(db, classes)

    return BulkClassCancelPreviewResponse(
        matched_classes=len(classes),
        confirmed_reservations=confirmed_count,
        waitlisted_reservations=waitlisted_count,
        notified_users=len(user_ids),
        items=items,
    )


# ─── DB-bound bulk-reassign helpers ──────────────────────────────────────────


async def resolve_bulk_reassign_classes(
    db: AsyncSession,
    ctx: TenantContext,
    data: BulkReassignInstructorRequest,
) -> tuple[list[GymClass], User]:
    if data.from_instructor_id == data.to_instructor_id:
        raise HTTPException(status_code=400, detail="El instructor origen y destino deben ser distintos")

    target = (
        await db.execute(
            select(User).where(
                User.id == data.to_instructor_id,
                User.tenant_id == ctx.tenant_id,
                User.role.in_([UserRole.TRAINER, UserRole.OWNER, UserRole.ADMIN]),
                User.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Instructor destino no encontrado o inactivo")

    zone = tenant_zone(ctx)
    now_utc = datetime.now(timezone.utc)
    today_local = now_utc.astimezone(zone).date()
    date_from = data.date_from or today_local
    date_to = data.date_to or (today_local + timedelta(days=90))
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to no puede ser anterior a date_from")

    range_start_utc = datetime.combine(date_from, time(0, 0), tzinfo=zone).astimezone(timezone.utc)
    range_end_utc = datetime.combine(date_to + timedelta(days=1), time(0, 0), tzinfo=zone).astimezone(timezone.utc)

    query = select(GymClass).where(
        GymClass.tenant_id == ctx.tenant_id,
        GymClass.status == ClassStatus.SCHEDULED,
        GymClass.start_time > now_utc,
        GymClass.start_time >= range_start_utc,
        GymClass.start_time < range_end_utc,
        GymClass.instructor_id == data.from_instructor_id,
    )
    if data.branch_id:
        query = query.where(GymClass.branch_id == data.branch_id)

    classes = (await db.execute(query.order_by(GymClass.start_time.asc()))).scalars().all()
    return list(classes), target


async def build_bulk_reassign_items(
    db: AsyncSession,
    classes: list[GymClass],
) -> list[BulkReassignableClassItem]:
    if not classes:
        return []
    enriched = await build_gym_class_responses(db, classes)
    return [
        BulkReassignableClassItem(
            id=c.id,
            name=c.name,
            start_time=c.start_time,
            branch_name=c.branch_name,
            current_bookings=c.current_bookings,
        )
        for c in enriched
    ]
