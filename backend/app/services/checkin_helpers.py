"""Helpers puros para construcción de respuestas y validación de check-ins.

Sin acceso a DB. Funciones testables aisladas. Re-exportadas desde
`app.api.v1.endpoints.classes` para retrocompatibilidad con tests.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException

from app.models.business import CheckIn, CheckInInvestigationCase, GymClass
from app.models.user import User
from app.schemas.business import (
    CheckInHistoryItemResponse,
    CheckInInvestigationCaseResponse,
    CheckInResponse,
)


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
