from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.models.business import Membership, MembershipStatus, Payment, PaymentMethod, PaymentStatus, Plan, PlanDuration
from app.services.membership_sale_service import (
    apply_payment_membership_snapshot,
    resolve_membership_expiration,
    resolve_membership_timeline,
    resolve_plan_sale_amount,
)


def make_plan(**overrides) -> Plan:
    plan = Plan(
        id=uuid4(),
        tenant_id=uuid4(),
        name="Plan Full",
        description="Acceso completo",
        price=Decimal("30000"),
        discount_pct=None,
        currency="CLP",
        duration_type=PlanDuration.MONTHLY,
        duration_days=30,
        is_active=True,
        is_featured=False,
        auto_renew=True,
        sort_order=0,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(plan, key, value)
    return plan


def make_membership(**overrides) -> Membership:
    membership = Membership(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=uuid4(),
        plan_id=uuid4(),
        status=MembershipStatus.PENDING,
        starts_at=date(2026, 4, 22),
        expires_at=date(2026, 5, 22),
        auto_renew=False,
        created_at=datetime(2026, 4, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 4, 1, tzinfo=timezone.utc),
    )
    for key, value in overrides.items():
        setattr(membership, key, value)
    return membership


def test_resolve_plan_sale_amount_uses_plan_discount_when_not_overridden() -> None:
    plan = make_plan(price=Decimal("40000"), discount_pct=Decimal("25"))

    amount = resolve_plan_sale_amount(plan)

    assert amount == Decimal("30000.00")


def test_resolve_plan_sale_amount_accepts_custom_override() -> None:
    plan = make_plan(price=Decimal("40000"), discount_pct=Decimal("25"))

    amount = resolve_plan_sale_amount(plan, Decimal("27990"))

    assert amount == Decimal("27990.00")


def test_resolve_membership_expiration_prefers_explicit_date() -> None:
    plan = make_plan(duration_days=30)

    expires_at = resolve_membership_expiration(
        starts_at=date(2026, 4, 13),
        plan=plan,
        explicit_expires_at=date(2026, 5, 20),
    )

    assert expires_at == date(2026, 5, 20)


def test_resolve_membership_expiration_uses_plan_duration_when_available() -> None:
    plan = make_plan(duration_days=90)

    expires_at = resolve_membership_expiration(
        starts_at=date(2026, 4, 13),
        plan=plan,
    )

    assert expires_at == date(2026, 7, 12)


def test_resolve_membership_expiration_returns_none_for_perpetual_plans() -> None:
    plan = make_plan(duration_type=PlanDuration.PERPETUAL, duration_days=None)

    expires_at = resolve_membership_expiration(
        starts_at=date(2026, 4, 13),
        plan=plan,
    )

    assert expires_at is None


def test_resolve_membership_timeline_promotes_due_pending_and_keeps_future_programmed() -> None:
    user_id = uuid4()
    active = make_membership(
        user_id=user_id,
        status=MembershipStatus.ACTIVE,
        starts_at=date(2026, 3, 22),
        expires_at=date(2026, 4, 22),
        created_at=datetime(2026, 3, 22, tzinfo=timezone.utc),
    )
    due_pending = make_membership(
        user_id=user_id,
        status=MembershipStatus.PENDING,
        starts_at=date(2026, 4, 22),
        expires_at=date(2026, 5, 22),
        created_at=datetime(2026, 4, 10, tzinfo=timezone.utc),
    )
    future_pending = make_membership(
        user_id=user_id,
        status=MembershipStatus.PENDING,
        starts_at=date(2026, 5, 22),
        expires_at=date(2026, 6, 22),
        created_at=datetime(2026, 4, 11, tzinfo=timezone.utc),
    )

    state = resolve_membership_timeline(
        [active, due_pending, future_pending],
        today=date(2026, 4, 22),
        persist=True,
    )

    assert active.status == MembershipStatus.EXPIRED
    assert due_pending.status == MembershipStatus.ACTIVE
    assert state.current_membership == due_pending
    assert state.access_membership == due_pending
    assert state.next_membership == future_pending


def test_resolve_membership_timeline_keeps_frozen_period_without_access() -> None:
    frozen = make_membership(
        status=MembershipStatus.FROZEN,
        starts_at=date(2026, 4, 1),
        expires_at=date(2026, 5, 1),
    )

    state = resolve_membership_timeline([frozen], today=date(2026, 4, 22), persist=True)

    assert state.current_membership == frozen
    assert state.access_membership is None
    assert frozen.status == MembershipStatus.FROZEN


def test_apply_payment_membership_snapshot_preserves_plan_and_period() -> None:
    plan = make_plan(id=uuid4(), name="Plan Elite")
    membership = make_membership(
        plan_id=plan.id,
        starts_at=date(2026, 4, 22),
        expires_at=date(2026, 5, 22),
        status=MembershipStatus.PENDING,
    )
    payment = Payment(
        id=uuid4(),
        tenant_id=membership.tenant_id,
        user_id=membership.user_id,
        membership_id=membership.id,
        amount=Decimal("29990"),
        currency="CLP",
        status=PaymentStatus.COMPLETED,
        method=PaymentMethod.CASH,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    apply_payment_membership_snapshot(payment, membership=membership, plan=plan)

    assert payment.plan_id_snapshot == plan.id
    assert payment.plan_name_snapshot == "Plan Elite"
    assert payment.membership_starts_at_snapshot == membership.starts_at
    assert payment.membership_expires_at_snapshot == membership.expires_at
    assert payment.membership_status_snapshot == MembershipStatus.PENDING.value
