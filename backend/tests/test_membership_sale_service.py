from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.models.business import Plan, PlanDuration
from app.services.membership_sale_service import resolve_membership_expiration, resolve_plan_sale_amount


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
