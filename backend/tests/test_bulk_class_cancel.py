from __future__ import annotations

from datetime import datetime, time, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.api.v1.endpoints.classes import (
    _build_bulk_cancel_notification_message,
    _class_overlaps_bulk_cancel_window,
    _summarize_bulk_cancel_reservations,
)
from app.models.business import ClassModality, ClassStatus, GymClass, Reservation, ReservationStatus


def make_gym_class(start_time: datetime, end_time: datetime) -> GymClass:
    return GymClass(
        id=uuid4(),
        tenant_id=uuid4(),
        name="Spinning",
        modality=ClassModality.IN_PERSON,
        status=ClassStatus.SCHEDULED,
        start_time=start_time,
        end_time=end_time,
        max_capacity=20,
        current_bookings=8,
        waitlist_enabled=True,
        repeat_type="none",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def make_reservation(user_id, status: ReservationStatus) -> Reservation:  # noqa: ANN001
    return Reservation(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=user_id,
        gym_class_id=uuid4(),
        status=status,
        created_at=datetime.now(timezone.utc),
    )


def test_bulk_cancel_window_matches_visible_overlap() -> None:
    zone = ZoneInfo("America/Santiago")
    gym_class = make_gym_class(
        datetime(2026, 4, 22, 10, 30, tzinfo=timezone.utc),
        datetime(2026, 4, 22, 11, 30, tzinfo=timezone.utc),
    )

    assert _class_overlaps_bulk_cancel_window(gym_class, zone, time(6, 0), time(8, 0)) is True


def test_bulk_cancel_window_excludes_classes_outside_visible_hours() -> None:
    zone = ZoneInfo("America/Santiago")
    gym_class = make_gym_class(
        datetime(2026, 4, 22, 3, 0, tzinfo=timezone.utc),
        datetime(2026, 4, 22, 4, 0, tzinfo=timezone.utc),
    )

    assert _class_overlaps_bulk_cancel_window(gym_class, zone, time(6, 0), time(8, 0)) is False


def test_bulk_cancel_window_respects_strict_boundaries() -> None:
    zone = ZoneInfo("UTC")
    gym_class = make_gym_class(
        datetime(2026, 4, 22, 5, 0, tzinfo=timezone.utc),
        datetime(2026, 4, 22, 6, 0, tzinfo=timezone.utc),
    )

    assert _class_overlaps_bulk_cancel_window(gym_class, zone, time(6, 0), time(8, 0)) is False


def test_summarize_bulk_cancel_reservations_counts_statuses_and_unique_users() -> None:
    shared_user_id = uuid4()
    reservations = [
        make_reservation(shared_user_id, ReservationStatus.CONFIRMED),
        make_reservation(shared_user_id, ReservationStatus.WAITLISTED),
        make_reservation(uuid4(), ReservationStatus.CONFIRMED),
    ]

    confirmed_count, waitlisted_count, user_ids = _summarize_bulk_cancel_reservations(reservations)

    assert confirmed_count == 2
    assert waitlisted_count == 1
    assert len(user_ids) == 2


def test_bulk_cancel_notification_message_includes_reason() -> None:
    zone = ZoneInfo("America/Santiago")
    gym_class = make_gym_class(
        datetime(2026, 4, 22, 22, 0, tzinfo=timezone.utc),
        datetime(2026, 4, 22, 23, 0, tzinfo=timezone.utc),
    )

    message = _build_bulk_cancel_notification_message(gym_class, zone, "Error al replicar")

    assert "Spinning" in message
    assert "Motivo: Error al replicar" in message
