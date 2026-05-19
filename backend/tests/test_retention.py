"""Unit tests for retention helpers (no DB)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.api.v1.endpoints.retention import _add_months, _compute_risk, _month_floor
from app.models.business import Membership, MembershipStatus


# ─── _month_floor ────────────────────────────────────────────────────────────


def test_month_floor_returns_first_day():
    assert _month_floor(date(2026, 5, 19)) == date(2026, 5, 1)


def test_month_floor_idempotent_when_already_first():
    assert _month_floor(date(2026, 1, 1)) == date(2026, 1, 1)


# ─── _add_months ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "start,n,expected",
    [
        (date(2026, 1, 1), 0, date(2026, 1, 1)),
        (date(2026, 1, 1), 1, date(2026, 2, 1)),
        (date(2026, 11, 1), 1, date(2026, 12, 1)),
        (date(2026, 12, 1), 1, date(2027, 1, 1)),   # cruce de año
        (date(2026, 12, 1), 13, date(2028, 1, 1)),  # más de un año
        (date(2026, 6, 1), -6, date(2025, 12, 1)),  # negativo cruce
        (date(2026, 3, 1), -3, date(2025, 12, 1)),
        (date(2026, 1, 1), -1, date(2025, 12, 1)),
    ],
)
def test_add_months(start: date, n: int, expected: date):
    assert _add_months(start, n) == expected


# ─── _compute_risk ───────────────────────────────────────────────────────────


def _membership(status: MembershipStatus) -> Membership:
    return Membership(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=uuid4(),
        plan_id=uuid4(),
        status=status,
        starts_at=date(2026, 1, 1),
    )


def test_risk_high_when_no_membership():
    now = datetime(2026, 5, 19, tzinfo=timezone.utc)
    assert _compute_risk(None, last_checkin=now, now=now) == "high"


def test_risk_high_when_membership_expired():
    now = datetime(2026, 5, 19, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.EXPIRED)
    assert _compute_risk(m, last_checkin=now, now=now) == "high"


def test_risk_high_when_membership_cancelled():
    now = datetime(2026, 5, 19, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.CANCELLED)
    assert _compute_risk(m, last_checkin=now, now=now) == "high"


def test_risk_high_when_active_but_no_checkin():
    now = datetime(2026, 5, 19, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.ACTIVE)
    assert _compute_risk(m, last_checkin=None, now=now) == "high"


def test_risk_high_when_checkin_older_than_30_days():
    now = datetime(2026, 5, 19, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.ACTIVE)
    last = now - timedelta(days=31)
    assert _compute_risk(m, last_checkin=last, now=now) == "high"


def test_risk_medium_when_checkin_between_14_and_30_days():
    now = datetime(2026, 5, 19, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.ACTIVE)
    last = now - timedelta(days=20)
    assert _compute_risk(m, last_checkin=last, now=now) == "medium"


def test_risk_low_when_checkin_within_14_days():
    now = datetime(2026, 5, 19, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.ACTIVE)
    last = now - timedelta(days=7)
    assert _compute_risk(m, last_checkin=last, now=now) == "low"


def test_risk_handles_naive_datetime_checkin():
    """Si el último check-in viene sin tzinfo, debe asumirse UTC."""
    now = datetime(2026, 5, 19, 12, 0, 0, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.ACTIVE)
    naive = datetime(2026, 5, 18, 12, 0, 0)  # 1 día atrás, naive
    assert _compute_risk(m, last_checkin=naive, now=now) == "low"


def test_risk_boundary_exactly_14_days_is_medium():
    now = datetime(2026, 5, 19, 12, 0, 0, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.ACTIVE)
    last = now - timedelta(days=14)
    assert _compute_risk(m, last_checkin=last, now=now) == "medium"


def test_risk_boundary_exactly_30_days_is_high():
    now = datetime(2026, 5, 19, 12, 0, 0, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.ACTIVE)
    last = now - timedelta(days=30)
    assert _compute_risk(m, last_checkin=last, now=now) == "high"


def test_risk_frozen_membership_uses_checkin_logic():
    """Frozen no es expired/cancelled → cae a heurística de check-in."""
    now = datetime(2026, 5, 19, tzinfo=timezone.utc)
    m = _membership(MembershipStatus.FROZEN)
    last = now - timedelta(days=5)
    assert _compute_risk(m, last_checkin=last, now=now) == "low"
