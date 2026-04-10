"""Utilities for exporting member reservations as iCalendar files."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Mapping, Sequence
from uuid import UUID

from app.models.business import GymClass, Reservation, ReservationStatus


def _format_ical_datetime(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _escape_ical_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build_member_calendar_ical(
    *,
    tenant_name: str | None,
    reservations: Sequence[Reservation],
    classes_by_id: Mapping[UUID, GymClass],
    generated_at: datetime | None = None,
) -> str:
    """Build an iCalendar file for a member's future reservations."""
    gym_name = tenant_name or "Gimnasio"
    now_stamp = _format_ical_datetime(generated_at or datetime.now(timezone.utc))

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:-//NexoFitness//{gym_name}//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{gym_name} — Mis clases",
        "X-WR-TIMEZONE:America/Santiago",
    ]

    future_reservations = sorted(
        (reservation for reservation in reservations if reservation.gym_class_id in classes_by_id),
        key=lambda reservation: classes_by_id[reservation.gym_class_id].start_time,
    )

    for reservation in future_reservations:
        gym_class = classes_by_id[reservation.gym_class_id]
        status_value = (
            reservation.status.value if isinstance(reservation.status, ReservationStatus) else str(reservation.status)
        )
        status_label = "CONFIRMED" if status_value == ReservationStatus.CONFIRMED.value else "TENTATIVE"

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{reservation.id}@nexofitness",
                f"DTSTAMP:{now_stamp}",
                f"DTSTART:{_format_ical_datetime(gym_class.start_time)}",
                f"DTEND:{_format_ical_datetime(gym_class.end_time)}",
                f"SUMMARY:{_escape_ical_text(gym_class.name)}",
                f"DESCRIPTION:{_escape_ical_text(gym_class.description or '')}",
                f"STATUS:{status_label}",
                "BEGIN:VALARM",
                "ACTION:DISPLAY",
                f"DESCRIPTION:{_escape_ical_text(f'Recordatorio: {gym_class.name} comienza en 1 hora')}",
                "TRIGGER:-PT1H",
                "END:VALARM",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
