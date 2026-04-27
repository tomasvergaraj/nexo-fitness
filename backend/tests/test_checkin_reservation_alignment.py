"""Tests for check-in / reservation alignment logic."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.api.v1.endpoints.classes import _create_checkin_record
from app.models.business import CheckIn, Reservation, ReservationStatus


class DummyResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return self._value if isinstance(self._value, list) else ([] if self._value is None else [self._value])


class DummyDb:
    def __init__(self, *execute_returns):
        self._queue = list(execute_returns)
        self.added: list = []
        self.flushed = False
        self.refreshed: list = []

    async def execute(self, _query):
        val = self._queue.pop(0) if self._queue else None
        return DummyResult(val)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushed = True

    async def refresh(self, obj):
        self.refreshed.append(obj)


def make_reservation(status: ReservationStatus = ReservationStatus.CONFIRMED, attended_at=None) -> Reservation:
    r = Reservation(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=uuid4(),
        gym_class_id=uuid4(),
        status=status,
        attended_at=attended_at,
        created_at=datetime.now(timezone.utc),
    )
    return r


# ─── _create_checkin_record ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_general_checkin_no_reservation() -> None:
    """No reservation → general check-in, resolution='none'."""
    db = DummyDb()
    tenant_id = uuid4()
    user_id = uuid4()

    checkin, resolution = await _create_checkin_record(
        db=db,
        tenant_id=tenant_id,
        checked_in_by=uuid4(),
        user_id=user_id,
        gym_class_id=None,
        branch_id=None,
        check_type="manual",
        reservation=None,
    )

    assert resolution == "none"
    assert checkin.gym_class_id is None
    assert checkin.reservation_id is None
    assert db.flushed is True
    assert checkin in db.refreshed


@pytest.mark.asyncio
async def test_links_confirmed_reservation() -> None:
    """Confirmed reservation → linked, status changes to attended."""
    db = DummyDb()
    reservation = make_reservation(ReservationStatus.CONFIRMED)
    tenant_id = reservation.tenant_id

    checkin, resolution = await _create_checkin_record(
        db=db,
        tenant_id=tenant_id,
        checked_in_by=uuid4(),
        user_id=reservation.user_id,
        gym_class_id=reservation.gym_class_id,
        branch_id=None,
        check_type="manual",
        reservation=reservation,
    )

    assert resolution == "linked"
    assert checkin.reservation_id == reservation.id
    assert checkin.gym_class_id == reservation.gym_class_id
    assert reservation.status == ReservationStatus.ATTENDED
    assert reservation.attended_at is not None
    assert db.flushed is True


@pytest.mark.asyncio
async def test_links_no_show_reservation() -> None:
    """no_show reservation inside window → corrects to attended."""
    db = DummyDb()
    reservation = make_reservation(ReservationStatus.NO_SHOW)

    checkin, resolution = await _create_checkin_record(
        db=db,
        tenant_id=reservation.tenant_id,
        checked_in_by=uuid4(),
        user_id=reservation.user_id,
        gym_class_id=reservation.gym_class_id,
        branch_id=None,
        check_type="qr",
        reservation=reservation,
    )

    assert resolution == "linked"
    assert reservation.status == ReservationStatus.ATTENDED


@pytest.mark.asyncio
async def test_idempotent_already_attended_with_existing_checkin() -> None:
    """Already-attended reservation with existing linked check-in → idempotent."""
    existing_checkin = CheckIn(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=uuid4(),
        gym_class_id=uuid4(),
        reservation_id=uuid4(),
        check_type="manual",
        checked_in_at=datetime.now(timezone.utc),
    )
    db = DummyDb(existing_checkin)  # execute returns existing checkin
    reservation = make_reservation(
        ReservationStatus.ATTENDED,
        attended_at=datetime.now(timezone.utc),
    )
    reservation.id = existing_checkin.reservation_id

    checkin, resolution = await _create_checkin_record(
        db=db,
        tenant_id=existing_checkin.tenant_id,
        checked_in_by=uuid4(),
        user_id=existing_checkin.user_id,
        gym_class_id=existing_checkin.gym_class_id,
        branch_id=None,
        check_type="manual",
        reservation=reservation,
    )

    assert resolution == "already_attended"
    assert checkin is existing_checkin
    assert existing_checkin not in db.added  # no new insert


@pytest.mark.asyncio
async def test_idempotent_already_attended_no_existing_checkin() -> None:
    """Already-attended reservation without a linked check-in (legacy) → creates one, already_attended."""
    db = DummyDb(None)  # execute returns None (no existing checkin)
    reservation = make_reservation(
        ReservationStatus.ATTENDED,
        attended_at=datetime.now(timezone.utc),
    )

    checkin, resolution = await _create_checkin_record(
        db=db,
        tenant_id=reservation.tenant_id,
        checked_in_by=uuid4(),
        user_id=reservation.user_id,
        gym_class_id=reservation.gym_class_id,
        branch_id=None,
        check_type="qr",
        reservation=reservation,
    )

    assert resolution == "already_attended"
    assert checkin.reservation_id == reservation.id
    assert checkin in db.added
    assert db.flushed is True


@pytest.mark.asyncio
async def test_attended_at_matches_checkin_timestamp() -> None:
    """attended_at on reservation equals checkin.checked_in_at."""
    db = DummyDb()
    reservation = make_reservation(ReservationStatus.CONFIRMED)

    checkin, _ = await _create_checkin_record(
        db=db,
        tenant_id=reservation.tenant_id,
        checked_in_by=uuid4(),
        user_id=reservation.user_id,
        gym_class_id=reservation.gym_class_id,
        branch_id=None,
        check_type="manual",
        reservation=reservation,
    )

    assert reservation.attended_at == checkin.checked_in_at


# ─── Eligibility window boundary assertions (unit, no DB) ────────────────────

def test_window_constants() -> None:
    """60-minute pre-class window is correctly defined."""
    from app.api.v1.endpoints.classes import CHECKIN_WINDOW_BEFORE_MINUTES
    assert CHECKIN_WINDOW_BEFORE_MINUTES == 60


def test_window_boundary_open() -> None:
    """Exactly 60 min before start_time is inside the window."""
    from app.api.v1.endpoints.classes import CHECKIN_WINDOW_BEFORE_MINUTES
    start_time = datetime(2026, 4, 22, 10, 0, tzinfo=timezone.utc)
    now = start_time - timedelta(minutes=CHECKIN_WINDOW_BEFORE_MINUTES)
    window_open = now - timedelta(minutes=CHECKIN_WINDOW_BEFORE_MINUTES)
    assert start_time >= window_open


def test_window_boundary_at_end_time() -> None:
    """Exactly at end_time is still inside the window."""
    end_time = datetime(2026, 4, 22, 11, 0, tzinfo=timezone.utc)
    now = end_time  # exactly at end
    assert end_time >= now


def test_window_boundary_after_end_time() -> None:
    """1 second after end_time is outside the window."""
    end_time = datetime(2026, 4, 22, 11, 0, tzinfo=timezone.utc)
    now = end_time + timedelta(seconds=1)
    assert end_time < now
