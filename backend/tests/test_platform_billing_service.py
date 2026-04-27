from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models.platform import PlatformPromoCode
from app.models.tenant import LicenseType
from app.services.platform_billing_service import (
    build_platform_saas_quote,
    resolve_platform_saas_quote,
)
from app.services.saas_plan_service import SaaSPlanDefinition


class FakeScalarResult:
    def __init__(self, promo: PlatformPromoCode | None) -> None:
        self.promo = promo

    def first(self) -> PlatformPromoCode | None:
        return self.promo


class FakeResult:
    def __init__(self, promo: PlatformPromoCode | None) -> None:
        self.promo = promo

    def scalars(self) -> FakeScalarResult:
        return FakeScalarResult(self.promo)


class FakeDb:
    def __init__(self, promo: PlatformPromoCode | None) -> None:
        self.promo = promo

    async def execute(self, _query):  # noqa: ANN001
        return FakeResult(self.promo)


def make_plan() -> SaaSPlanDefinition:
    return SaaSPlanDefinition(
        key="monthly",
        name="Plan Mensual",
        description="Plan de prueba",
        license_type=LicenseType.MONTHLY,
        price=Decimal("10000"),
        currency="CLP",
        billing_interval="month",
        trial_days=14,
        max_members=200,
        max_branches=2,
        features=("Soporte",),
        stripe_price_id="",
        fintoc_enabled=False,
        webpay_enabled=True,
        highlighted=False,
    )


def make_promo(**overrides) -> PlatformPromoCode:
    promo = PlatformPromoCode(
        code="PROMO10",
        name="Promo Test",
        discount_type="percent",
        discount_value=Decimal("10"),
        is_active=True,
        uses_count=0,
        max_uses=None,
        plan_keys=None,
    )
    for key, value in overrides.items():
        setattr(promo, key, value)
    return promo


def test_build_platform_saas_quote_applies_discount_before_tax() -> None:
    pricing = build_platform_saas_quote(
        plan=make_plan(),
        promo=make_promo(),
    )

    assert pricing.valid is True
    assert pricing.base_price == Decimal("10000")
    assert pricing.promo_discount_amount == Decimal("1000")
    assert pricing.taxable_subtotal == Decimal("9000")
    assert pricing.tax_amount == Decimal("1710")
    assert pricing.total_amount == Decimal("10710")


def test_build_platform_saas_quote_caps_fixed_discount_to_plan_value() -> None:
    pricing = build_platform_saas_quote(
        plan=make_plan(),
        promo=make_promo(discount_type="fixed", discount_value=Decimal("15000")),
    )

    assert pricing.valid is True
    assert pricing.promo_discount_amount == Decimal("10000")
    assert pricing.taxable_subtotal == Decimal("0")
    assert pricing.tax_amount == Decimal("0")
    assert pricing.total_amount == Decimal("0")


@pytest.mark.asyncio
async def test_resolve_platform_saas_quote_rejects_expired_promo(monkeypatch: pytest.MonkeyPatch) -> None:
    plan = make_plan()

    async def fake_resolve_plan(*_args, **_kwargs) -> SaaSPlanDefinition:
        return plan

    monkeypatch.setattr(
        "app.services.platform_billing_service._resolve_platform_plan",
        fake_resolve_plan,
    )

    promo = make_promo(expires_at=datetime.now(timezone.utc) - timedelta(days=1))
    pricing = await resolve_platform_saas_quote(FakeDb(promo), plan_key=plan.key, promo_code=promo.code)

    assert pricing.valid is False
    assert pricing.reason == "El código promocional ha expirado."
    assert pricing.promo is None
    assert pricing.taxable_subtotal == Decimal("10000")
    assert pricing.total_amount == Decimal("11900")


@pytest.mark.asyncio
async def test_resolve_platform_saas_quote_rejects_plan_scope_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    plan = make_plan()

    async def fake_resolve_plan(*_args, **_kwargs) -> SaaSPlanDefinition:
        return plan

    monkeypatch.setattr(
        "app.services.platform_billing_service._resolve_platform_plan",
        fake_resolve_plan,
    )

    promo = make_promo(plan_keys='["annual"]')
    pricing = await resolve_platform_saas_quote(FakeDb(promo), plan_key=plan.key, promo_code=promo.code)

    assert pricing.valid is False
    assert pricing.reason == "Este código no aplica para el plan seleccionado."
    assert pricing.promo is None
