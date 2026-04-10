from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.models.business import (
    ClassModality,
    ClassStatus,
    GymClass,
    Reservation,
    ReservationStatus,
)
from app.services.calendar_export_service import build_member_calendar_ical


def make_gym_class(*, name: str, start_time: datetime, end_time: datetime) -> GymClass:
    return GymClass(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        branch_id=None,
        name=name,
        description=f"Clase de {name}",
        class_type="fitness",
        modality=ClassModality.IN_PERSON,
        status=ClassStatus.SCHEDULED,
        instructor_id=None,
        start_time=start_time,
        end_time=end_time,
        max_capacity=20,
        current_bookings=1,
        waitlist_enabled=True,
        online_link=None,
        cancellation_deadline_hours=2,
        is_recurring=False,
        recurrence_rule=None,
        color=None,
    )


def make_reservation(*, gym_class_id, status: ReservationStatus) -> Reservation:  # noqa: ANN001
    return Reservation(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        gym_class_id=gym_class_id,
        status=status,
        waitlist_position=None,
        cancelled_at=None,
        cancel_reason=None,
        attended_at=None,
    )


def test_build_member_calendar_ical_only_includes_future_classes_with_alarm() -> None:
    now = datetime(2026, 4, 10, 12, 0, tzinfo=timezone.utc)
    future_class = make_gym_class(
        name="Yoga Flow",
        start_time=now + timedelta(hours=2),
        end_time=now + timedelta(hours=3),
    )
    past_class = make_gym_class(
        name="Spinning",
        start_time=now - timedelta(days=1),
        end_time=now - timedelta(days=1, hours=-1),
    )

    future_reservation = make_reservation(
        gym_class_id=future_class.id,
        status=ReservationStatus.CONFIRMED,
    )
    past_reservation = make_reservation(
        gym_class_id=past_class.id,
        status=ReservationStatus.CONFIRMED,
    )

    ical_content = build_member_calendar_ical(
        tenant_name="Nexo Fitness",
        reservations=[future_reservation, past_reservation],
        classes_by_id={future_class.id: future_class},
        generated_at=now,
    )

    assert ical_content.count("BEGIN:VEVENT") == 1
    assert "SUMMARY:Yoga Flow" in ical_content
    assert "SUMMARY:Spinning" not in ical_content
    assert "BEGIN:VALARM" in ical_content
    assert "TRIGGER:-PT1H" in ical_content
    assert "DESCRIPTION:Recordatorio: Yoga Flow comienza en 1 hora" in ical_content


def test_build_member_calendar_ical_marks_waitlisted_reservations_as_tentative() -> None:
    now = datetime(2026, 4, 10, 12, 0, tzinfo=timezone.utc)
    gym_class = make_gym_class(
        name="Pilates",
        start_time=now + timedelta(days=1),
        end_time=now + timedelta(days=1, hours=1),
    )
    reservation = make_reservation(
        gym_class_id=gym_class.id,
        status=ReservationStatus.WAITLISTED,
    )

    ical_content = build_member_calendar_ical(
        tenant_name="Nexo Fitness",
        reservations=[reservation],
        classes_by_id={gym_class.id: gym_class},
        generated_at=now,
    )

    assert "SUMMARY:Pilates" in ical_content
    assert "STATUS:TENTATIVE" in ical_content
