"""Tests para Plan.plan_kind, Plan.total_uses y Membership.uses_remaining.

Cubre:
- Estado resuelto de membresía considera uses_remaining
- create_checkin_record decrementa uses_remaining en punch_pass/drop_in
- Cuando uses_remaining llega a 0, la membresía pasa a EXPIRED
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.business import (
    CheckIn,
    Membership,
    MembershipStatus,
    Plan,
    PlanDuration,
    PlanKind,
    Reservation,
    ReservationStatus,
)
from app.services.checkin_helpers import create_checkin_record
from app.services.membership_sale_service import (
    _resolved_membership_status,
    resolve_membership_timeline,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────


def make_plan(**overrides) -> Plan:
    plan = Plan(
        id=uuid4(),
        tenant_id=uuid4(),
        name="Pack 10 clases",
        description=None,
        price=Decimal("60000"),
        discount_pct=None,
        currency="CLP",
        duration_type=PlanDuration.CUSTOM,
        duration_days=90,
        plan_kind=PlanKind.PUNCH_PASS,
        total_uses=10,
        is_active=True,
        is_featured=False,
        is_trial=False,
        auto_renew=False,
        sort_order=0,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for k, v in overrides.items():
        setattr(plan, k, v)
    return plan


def make_membership(**overrides) -> Membership:
    membership = Membership(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=uuid4(),
        plan_id=uuid4(),
        status=MembershipStatus.ACTIVE,
        starts_at=date(2026, 5, 1),
        expires_at=date(2026, 8, 1),
        auto_renew=False,
        uses_remaining=10,
        created_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )
    for k, v in overrides.items():
        setattr(membership, k, v)
    return membership


class FakeSession:
    """Sesión mínima — captura objetos añadidos y soporta flush/refresh.

    `execute` emula el UPDATE atómico condicional de punch passes
    (`UPDATE memberships SET uses_remaining = uses_remaining-1 WHERE id=:id AND
    uses_remaining>0 RETURNING uses_remaining`): descuenta sobre `membership`
    sólo si quedan pases y devuelve el nuevo valor, o None si está agotado.
    """

    def __init__(self, membership=None):
        self.added: list = []
        self.flushed = 0
        self._membership = membership

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushed += 1
        # Simula IDs autogenerados
        for obj in self.added:
            if isinstance(obj, CheckIn) and getattr(obj, "id", None) is None:
                obj.id = uuid4()

    async def refresh(self, _obj):
        return None

    async def execute(self, _stmt):
        m = self._membership
        new_val = None
        if m is not None and m.uses_remaining is not None and m.uses_remaining > 0:
            m.uses_remaining -= 1
            new_val = m.uses_remaining

        class _Result:
            def scalar_one_or_none(_self):
                return new_val

        return _Result()


# ─── Status resolution ───────────────────────────────────────────────────────


def test_punch_pass_active_with_remaining_uses() -> None:
    m = make_membership(uses_remaining=5)
    assert _resolved_membership_status(m, date(2026, 5, 15)) == MembershipStatus.ACTIVE


def test_punch_pass_expired_when_uses_zero() -> None:
    m = make_membership(uses_remaining=0)
    assert _resolved_membership_status(m, date(2026, 5, 15)) == MembershipStatus.EXPIRED


def test_punch_pass_expired_when_uses_negative_defensive() -> None:
    # Caso defensivo: si por race condition queda en -1, sigue siendo expired.
    m = make_membership(uses_remaining=-1)
    assert _resolved_membership_status(m, date(2026, 5, 15)) == MembershipStatus.EXPIRED


def test_subscription_unaffected_by_uses_remaining_logic() -> None:
    # Suscripción normal: uses_remaining es None, status sigue lógica de fechas.
    m = make_membership(uses_remaining=None, expires_at=date(2026, 6, 1))
    assert _resolved_membership_status(m, date(2026, 5, 15)) == MembershipStatus.ACTIVE


def test_timeline_exposes_punch_pass_as_access_membership() -> None:
    m = make_membership(uses_remaining=3)
    state = resolve_membership_timeline([m], today=date(2026, 5, 15))
    assert state.access_membership is m
    assert state.resolved_statuses[m.id] == MembershipStatus.ACTIVE


def test_timeline_excludes_exhausted_punch_pass() -> None:
    m = make_membership(uses_remaining=0)
    state = resolve_membership_timeline([m], today=date(2026, 5, 15))
    assert state.access_membership is None
    assert state.resolved_statuses[m.id] == MembershipStatus.EXPIRED


# ─── Check-in decrement ───────────────────────────────────────────────────────


def test_create_checkin_decrements_punch_pass() -> None:
    membership = make_membership(uses_remaining=5)
    session = FakeSession(membership=membership)
    checkin, resolution = asyncio.run(
        create_checkin_record(
            db=session,  # type: ignore[arg-type]
            tenant_id=membership.tenant_id,
            checked_in_by=uuid4(),
            user_id=membership.user_id,
            gym_class_id=None,
            branch_id=None,
            check_type="manual",
            reservation=None,
            access_membership=membership,
        )
    )
    assert resolution == "none"
    assert isinstance(checkin, CheckIn)
    assert membership.uses_remaining == 4
    assert membership.status == MembershipStatus.ACTIVE


def test_create_checkin_marks_expired_on_last_use() -> None:
    membership = make_membership(uses_remaining=1)
    session = FakeSession(membership=membership)
    asyncio.run(
        create_checkin_record(
            db=session,  # type: ignore[arg-type]
            tenant_id=membership.tenant_id,
            checked_in_by=uuid4(),
            user_id=membership.user_id,
            gym_class_id=None,
            branch_id=None,
            check_type="manual",
            reservation=None,
            access_membership=membership,
        )
    )
    assert membership.uses_remaining == 0
    assert membership.status == MembershipStatus.EXPIRED
    assert membership.expires_at == datetime.now(timezone.utc).date()


def test_create_checkin_rejects_when_no_uses() -> None:
    membership = make_membership(uses_remaining=0)
    session = FakeSession(membership=membership)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            create_checkin_record(
                db=session,  # type: ignore[arg-type]
                tenant_id=membership.tenant_id,
                checked_in_by=uuid4(),
                user_id=membership.user_id,
                gym_class_id=None,
                branch_id=None,
                check_type="manual",
                reservation=None,
                access_membership=membership,
            )
        )
    assert exc.value.status_code == 400
    assert "pases" in exc.value.detail.lower()


def test_create_checkin_skips_decrement_when_already_attended() -> None:
    """Idempotencia: si una reserva ya está ATTENDED, no se descuenta dos veces."""
    membership = make_membership(uses_remaining=3)
    session = FakeSession()

    # Simular una reserva ya marcada como attended; create_checkin_record
    # devolverá "already_attended" sin tocar uses_remaining.
    class FakeCheckInQuery:
        async def execute(self, stmt):
            class _Result:
                def scalar_one_or_none(self_inner):
                    return None  # No hay CheckIn previo (caso edge)
            return _Result()

    reservation = Reservation(
        id=uuid4(),
        tenant_id=membership.tenant_id,
        user_id=membership.user_id,
        gym_class_id=uuid4(),
        status=ReservationStatus.ATTENDED,
        attended_at=datetime.now(timezone.utc),
    )

    # FakeSession debe responder a `db.execute` también.
    async def fake_execute(_stmt):
        class _Result:
            def scalar_one_or_none(self_inner):
                return None
        return _Result()

    session.execute = fake_execute  # type: ignore[assignment]

    asyncio.run(
        create_checkin_record(
            db=session,  # type: ignore[arg-type]
            tenant_id=membership.tenant_id,
            checked_in_by=uuid4(),
            user_id=membership.user_id,
            gym_class_id=reservation.gym_class_id,
            branch_id=None,
            check_type="manual",
            reservation=reservation,
            access_membership=membership,
        )
    )
    # Reserva ya estaba attended → uses_remaining intacto.
    assert membership.uses_remaining == 3


def test_create_checkin_subscription_does_not_touch_uses() -> None:
    membership = make_membership(uses_remaining=None)
    session = FakeSession()
    asyncio.run(
        create_checkin_record(
            db=session,  # type: ignore[arg-type]
            tenant_id=membership.tenant_id,
            checked_in_by=uuid4(),
            user_id=membership.user_id,
            gym_class_id=None,
            branch_id=None,
            check_type="manual",
            reservation=None,
            access_membership=membership,
        )
    )
    assert membership.uses_remaining is None
    assert membership.status == MembershipStatus.ACTIVE
