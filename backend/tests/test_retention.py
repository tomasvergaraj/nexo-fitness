"""Unit tests for retention helpers (no DB)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.api.v1.endpoints.retention import _add_months, _compute_cohort_matrix, _compute_risk, _month_floor
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


# ─── _compute_cohort_matrix ──────────────────────────────────────────────────


def _cohort_starts(months: int, current_month: date) -> list[date]:
    return [_add_months(current_month, -i) for i in range(months - 1, -1, -1)]


def test_cohort_matrix_empty_returns_zero_rows():
    current = date(2026, 5, 1)
    starts = _cohort_starts(3, current)
    cohort_data = {c: [] for c in starts}

    matrix = _compute_cohort_matrix(cohort_data, starts, current, months=3)

    assert len(matrix) == 3
    assert all(row.cohort_size == 0 for row in matrix)
    assert all(cell.retained == 0 and cell.pct == 0.0 for row in matrix for cell in row.cells)


def test_cohort_matrix_all_retained_when_no_cancellations():
    """3 miembros se dan de alta en marzo, ninguno cancela → 100% en todos los meses."""
    current = date(2026, 5, 1)
    starts = _cohort_starts(3, current)  # [marzo, abril, mayo]
    march = starts[0]
    cohort_data = {c: [] for c in starts}
    cohort_data[march] = [
        (date(2026, 3, 5), None),
        (date(2026, 3, 10), None),
        (date(2026, 3, 20), None),
    ]

    matrix = _compute_cohort_matrix(cohort_data, starts, current, months=3)

    march_row = matrix[0]
    assert march_row.cohort_month == "2026-03"
    assert march_row.cohort_size == 3
    assert len(march_row.cells) == 3  # M0, M1, M2
    for cell in march_row.cells:
        assert cell.retained == 3
        assert cell.pct == 100.0


def test_cohort_matrix_decay_with_cancellations():
    """3 altas marzo, 1 cancela en abril (M1), 1 cancela en mayo (M2)."""
    current = date(2026, 5, 1)
    starts = _cohort_starts(3, current)
    march = starts[0]
    cohort_data = {c: [] for c in starts}
    cohort_data[march] = [
        (date(2026, 3, 1), None),
        (date(2026, 3, 1), datetime(2026, 4, 15, tzinfo=timezone.utc)),  # cancela en abril
        (date(2026, 3, 1), datetime(2026, 5, 10, tzinfo=timezone.utc)),  # cancela en mayo
    ]

    matrix = _compute_cohort_matrix(cohort_data, starts, current, months=3)

    march_row = matrix[0]
    # M0 (fin marzo = 2026-04-01): nadie canceló antes de abril → 3 retenidos
    assert march_row.cells[0].retained == 3
    # M1 (fin abril = 2026-05-01): el que canceló el 15-abril ya no está → 2 retenidos
    assert march_row.cells[1].retained == 2
    # M2 (fin mayo = 2026-06-01): el que canceló el 10-mayo tampoco → 1 retenido
    assert march_row.cells[2].retained == 1
    assert march_row.cells[2].pct == pytest.approx(33.3, rel=1e-2)


def test_cohort_matrix_younger_cohort_has_fewer_offsets():
    """Cohorte mayo (mes actual) tiene sólo M0; marzo tiene M0..M2."""
    current = date(2026, 5, 1)
    starts = _cohort_starts(3, current)  # [marzo, abril, mayo]
    cohort_data = {c: [(date(2026, c.month, 1), None)] for c in starts}

    matrix = _compute_cohort_matrix(cohort_data, starts, current, months=3)

    assert len(matrix[0].cells) == 3  # marzo: M0, M1, M2
    assert len(matrix[1].cells) == 2  # abril: M0, M1
    assert len(matrix[2].cells) == 1  # mayo: M0
