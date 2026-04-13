from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from app.models.business import Plan, PromoCode, PlanDuration
from app.services.promo_code_service import (
    build_valid_promo_pricing_result,
    calculate_effective_plan_price,
)


def make_plan(**overrides) -> Plan:
    plan = Plan(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        name="Plan Store",
        description="Plan publico",
        price=Decimal("30000"),
        discount_pct=Decimal("10"),
        currency="CLP",
        duration_type=PlanDuration.MONTHLY,
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


def make_promo(**overrides) -> PromoCode:
    promo = PromoCode(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        code="PROMO20",
        name="Promo store",
        discount_type="percent",
        discount_value=Decimal("20"),
        uses_count=0,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(promo, key, value)
    return promo


def test_calculate_effective_plan_price_applies_plan_discount_before_checkout() -> None:
    plan = make_plan(price=Decimal("39990"), discount_pct=Decimal("15"))

    effective_price = calculate_effective_plan_price(plan)

    assert effective_price == Decimal("33992")


def test_build_valid_promo_pricing_result_applies_promo_on_discounted_plan_price() -> None:
    plan = make_plan(price=Decimal("30000"), discount_pct=Decimal("10"))
    promo = make_promo(discount_type="percent", discount_value=Decimal("20"))

    pricing = build_valid_promo_pricing_result(plan=plan, promo=promo)

    assert pricing.valid is True
    assert pricing.price_before_promo == Decimal("27000")
    assert pricing.promo_discount_amount == Decimal("5400")
    assert pricing.final_price == Decimal("21600")


def test_build_valid_promo_pricing_result_caps_fixed_discount_to_zero_floor() -> None:
    plan = make_plan(price=Decimal("12000"), discount_pct=Decimal("0"))
    promo = make_promo(discount_type="fixed", discount_value=Decimal("20000"))

    pricing = build_valid_promo_pricing_result(plan=plan, promo=promo)

    assert pricing.price_before_promo == Decimal("12000")
    assert pricing.promo_discount_amount == Decimal("12000")
    assert pricing.final_price == Decimal("0")
