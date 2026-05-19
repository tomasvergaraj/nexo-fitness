"""Helpers puros para operaciones masivas sobre clases (bulk cancel / reassign).

Sin acceso a DB ni a HTTP. Funciones puras testables. Re-exportadas desde
`app.api.v1.endpoints.classes` para retrocompatibilidad con tests existentes.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.models.business import GymClass, Reservation, ReservationStatus
from app.schemas.business import BulkClassCancelRequest


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
