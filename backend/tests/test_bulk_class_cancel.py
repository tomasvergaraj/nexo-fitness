from __future__ import annotations

from datetime import date, datetime, time, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.classes import (
    _build_bulk_cancel_notification_message,
    _bulk_cancel_date_bounds,
    _class_overlaps_bulk_cancel_window,
    _summarize_bulk_cancel_reservations,
    _validate_bulk_cancel_request,
)
from app.models.business import ClassModality, ClassStatus, GymClass, Reservation, ReservationStatus
from app.schemas.business import BulkClassCancelRequest


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


def test_bulk_cancel_notification_message_omits_reason_when_absent() -> None:
    zone = ZoneInfo("America/Santiago")
    gym_class = make_gym_class(
        datetime(2026, 4, 22, 22, 0, tzinfo=timezone.utc),
        datetime(2026, 4, 22, 23, 0, tzinfo=timezone.utc),
    )

    message = _build_bulk_cancel_notification_message(gym_class, zone, None)

    assert "Spinning" in message
    assert "Motivo" not in message


# ─── validate_bulk_cancel_request ────────────────────────────────────────────


def _request(
    *,
    date_from: date = date(2026, 4, 22),
    date_to: date = date(2026, 4, 23),
    time_from: time = time(6, 0),
    time_to: time = time(23, 0),
) -> BulkClassCancelRequest:
    return BulkClassCancelRequest(
        date_from=date_from,
        date_to=date_to,
        time_from=time_from,
        time_to=time_to,
        notify_members=True,
    )


def test_validate_bulk_cancel_request_accepts_valid_range() -> None:
    _validate_bulk_cancel_request(_request())


def test_validate_bulk_cancel_request_rejects_inverted_dates() -> None:
    req = _request(date_from=date(2026, 4, 23), date_to=date(2026, 4, 22))
    with pytest.raises(HTTPException) as exc:
        _validate_bulk_cancel_request(req)
    assert exc.value.status_code == 400
    assert "fecha inicial" in exc.value.detail.lower()


def test_validate_bulk_cancel_request_rejects_inverted_times() -> None:
    req = _request(time_from=time(20, 0), time_to=time(10, 0))
    with pytest.raises(HTTPException) as exc:
        _validate_bulk_cancel_request(req)
    assert exc.value.status_code == 400
    assert "hora" in exc.value.detail.lower()


def test_validate_bulk_cancel_request_rejects_equal_times() -> None:
    req = _request(time_from=time(8, 0), time_to=time(8, 0))
    with pytest.raises(HTTPException):
        _validate_bulk_cancel_request(req)


# ─── bulk_cancel_date_bounds ─────────────────────────────────────────────────


def test_bulk_cancel_date_bounds_converts_local_to_utc() -> None:
    """Santiago en abril está en UTC-4. Un día local 00:00 = 04:00 UTC."""
    zone = ZoneInfo("America/Santiago")
    req = _request(date_from=date(2026, 4, 22), date_to=date(2026, 4, 22))

    start_utc, end_utc = _bulk_cancel_date_bounds(req, zone)

    assert start_utc == datetime(2026, 4, 22, 4, 0, tzinfo=timezone.utc)
    # end es inicio del día siguiente local → 23/04 00:00 ST = 23/04 04:00 UTC
    assert end_utc == datetime(2026, 4, 23, 4, 0, tzinfo=timezone.utc)


def test_bulk_cancel_date_bounds_multi_day_range() -> None:
    zone = ZoneInfo("UTC")
    req = _request(date_from=date(2026, 1, 1), date_to=date(2026, 1, 7))

    start_utc, end_utc = _bulk_cancel_date_bounds(req, zone)

    assert start_utc == datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    assert end_utc == datetime(2026, 1, 8, 0, 0, tzinfo=timezone.utc)
