"""Tests for class booking time validation (`_ensure_class_bookable`)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.classes import _ensure_class_bookable
from app.models.business import ClassModality, ClassStatus, GymClass


def make_gym_class(
    *,
    start_offset_minutes: int = 60,
    duration_minutes: int = 60,
    reservation_closes_minutes_before: int = 0,
    naive: bool = False,
) -> GymClass:
    now = datetime.now(timezone.utc)
    start = now + timedelta(minutes=start_offset_minutes)
    end = start + timedelta(minutes=duration_minutes)
    if naive:
        start = start.replace(tzinfo=None)
        end = end.replace(tzinfo=None)
    return GymClass(
        id=uuid4(),
        tenant_id=uuid4(),
        name="Spinning",
        modality=ClassModality.IN_PERSON,
        status=ClassStatus.SCHEDULED,
        start_time=start,
        end_time=end,
        max_capacity=20,
        current_bookings=0,
        waitlist_enabled=True,
        reservation_closes_minutes_before=reservation_closes_minutes_before,
        repeat_type="none",
        created_at=now,
        updated_at=now,
    )


def test_future_class_is_bookable_for_client() -> None:
    gym_class = make_gym_class(start_offset_minutes=120)
    _ensure_class_bookable(gym_class, is_staff=False, now_utc=datetime.now(timezone.utc))


def test_past_class_rejected_for_client() -> None:
    gym_class = make_gym_class(start_offset_minutes=-60)
    with pytest.raises(HTTPException) as exc:
        _ensure_class_bookable(gym_class, is_staff=False, now_utc=datetime.now(timezone.utc))
    assert exc.value.status_code == 400
    assert "ya comenzó" in exc.value.detail


def test_in_progress_class_rejected_for_client() -> None:
    # start 10 min ago, ends 50 min from now
    gym_class = make_gym_class(start_offset_minutes=-10, duration_minutes=60)
    with pytest.raises(HTTPException) as exc:
        _ensure_class_bookable(gym_class, is_staff=False, now_utc=datetime.now(timezone.utc))
    assert exc.value.status_code == 400


def test_staff_bypass_for_past_class() -> None:
    gym_class = make_gym_class(start_offset_minutes=-120)
    # No exception
    _ensure_class_bookable(gym_class, is_staff=True, now_utc=datetime.now(timezone.utc))


def test_close_window_blocks_late_client_reservation() -> None:
    # Class starts in 20 min, close window 30 min → cutoff already passed
    gym_class = make_gym_class(start_offset_minutes=20, reservation_closes_minutes_before=30)
    with pytest.raises(HTTPException) as exc:
        _ensure_class_bookable(gym_class, is_staff=False, now_utc=datetime.now(timezone.utc))
    assert exc.value.status_code == 400
    assert "cerraron" in exc.value.detail


def test_close_window_allows_early_reservation() -> None:
    # Class starts in 60 min, close window 30 min → cutoff still 30 min away
    gym_class = make_gym_class(start_offset_minutes=60, reservation_closes_minutes_before=30)
    _ensure_class_bookable(gym_class, is_staff=False, now_utc=datetime.now(timezone.utc))


def test_zero_close_window_does_not_block() -> None:
    gym_class = make_gym_class(start_offset_minutes=5, reservation_closes_minutes_before=0)
    _ensure_class_bookable(gym_class, is_staff=False, now_utc=datetime.now(timezone.utc))


def test_naive_datetime_is_treated_as_utc() -> None:
    gym_class = make_gym_class(start_offset_minutes=-30, naive=True)
    with pytest.raises(HTTPException):
        _ensure_class_bookable(gym_class, is_staff=False, now_utc=datetime.now(timezone.utc))


def test_class_starting_exactly_now_is_rejected() -> None:
    now = datetime.now(timezone.utc)
    gym_class = make_gym_class(start_offset_minutes=0)
    gym_class.start_time = now
    with pytest.raises(HTTPException):
        _ensure_class_bookable(gym_class, is_staff=False, now_utc=now)


def test_close_window_bypass_for_staff() -> None:
    gym_class = make_gym_class(start_offset_minutes=5, reservation_closes_minutes_before=30)
    _ensure_class_bookable(gym_class, is_staff=True, now_utc=datetime.now(timezone.utc))
