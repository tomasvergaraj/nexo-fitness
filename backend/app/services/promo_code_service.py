"""Shared promo-code pricing and validation helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Plan, PromoCode

CLP_QUANTUM = Decimal("1")
DEFAULT_QUANTUM = Decimal("0.01")


@dataclass
class PromoCodePricingResult:
    valid: bool
    reason: str | None
    plan: Plan | None
    promo: PromoCode | None
    price_before_promo: Decimal | None
    promo_discount_amount: Decimal | None
    final_price: Decimal | None


def _currency_quantum(currency: str | None) -> Decimal:
    return CLP_QUANTUM if str(currency or "").upper() == "CLP" else DEFAULT_QUANTUM


def round_currency_amount(value: Decimal | int | float | str, currency: str | None) -> Decimal:
    return Decimal(str(value)).quantize(_currency_quantum(currency), rounding=ROUND_HALF_UP)


def calculate_effective_plan_price(plan: Plan) -> Decimal:
    base_price = round_currency_amount(plan.price or 0, getattr(plan, "currency", None))
    discount_pct = Decimal(str(plan.discount_pct or 0))
    if discount_pct <= 0:
        return base_price

    discounted_price = base_price * (Decimal("1") - (discount_pct / Decimal("100")))
    if discounted_price < 0:
        discounted_price = Decimal("0")
    return round_currency_amount(discounted_price, getattr(plan, "currency", None))


def calculate_promo_discount_amount(
    *,
    promo: PromoCode,
    price_before_promo: Decimal,
    currency: str | None,
) -> Decimal:
    if promo.discount_type == "percent":
        discount_amount = price_before_promo * Decimal(str(promo.discount_value or 0)) / Decimal("100")
    else:
        discount_amount = Decimal(str(promo.discount_value or 0))

    discount_amount = round_currency_amount(discount_amount, currency)
    if discount_amount > price_before_promo:
        return price_before_promo
    if discount_amount < 0:
        return Decimal("0")
    return discount_amount


def build_valid_promo_pricing_result(
    *,
    plan: Plan,
    promo: PromoCode | None,
) -> PromoCodePricingResult:
    price_before_promo = calculate_effective_plan_price(plan)
    promo_discount_amount = Decimal("0")
    if promo is not None:
        promo_discount_amount = calculate_promo_discount_amount(
            promo=promo,
            price_before_promo=price_before_promo,
            currency=getattr(plan, "currency", None),
        )
    final_price = round_currency_amount(
        max(price_before_promo - promo_discount_amount, Decimal("0")),
        getattr(plan, "currency", None),
    )
    return PromoCodePricingResult(
        valid=True,
        reason=None,
        plan=plan,
        promo=promo,
        price_before_promo=price_before_promo,
        promo_discount_amount=promo_discount_amount,
        final_price=final_price,
    )


def _invalid_promo_result(reason: str, *, plan: Plan | None = None) -> PromoCodePricingResult:
    return PromoCodePricingResult(
        valid=False,
        reason=reason,
        plan=plan,
        promo=None,
        price_before_promo=calculate_effective_plan_price(plan) if plan is not None else None,
        promo_discount_amount=None,
        final_price=None,
    )


async def resolve_tenant_promo_pricing(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    plan_id: UUID,
    promo_code: Optional[str] = None,
    promo_code_id: Optional[UUID] = None,
) -> PromoCodePricingResult:
    plan = (
        await db.execute(
            select(Plan).where(Plan.id == plan_id, Plan.tenant_id == tenant_id)
        )
    ).scalars().first()
    if not plan:
        return _invalid_promo_result("Plan no encontrado.")

    if not promo_code and not promo_code_id:
        return build_valid_promo_pricing_result(plan=plan, promo=None)

    promo_query = select(PromoCode).where(PromoCode.tenant_id == tenant_id)
    if promo_code_id:
        promo_query = promo_query.where(PromoCode.id == promo_code_id)
    else:
        promo_query = promo_query.where(PromoCode.code == promo_code.upper().strip())

    promo = (await db.execute(promo_query)).scalars().first()
    if not promo or not promo.is_active:
        return _invalid_promo_result("Código no válido o inactivo.", plan=plan)

    now = datetime.now(timezone.utc)
    if promo.expires_at and promo.expires_at < now:
        return _invalid_promo_result("El código ha expirado.", plan=plan)

    if promo.max_uses is not None and promo.uses_count >= promo.max_uses:
        return _invalid_promo_result("El código ha alcanzado su límite de usos.", plan=plan)

    if promo.plan_ids:
        try:
            allowed_ids = json.loads(promo.plan_ids)
        except json.JSONDecodeError:
            allowed_ids = []
        if str(plan_id) not in allowed_ids:
            return _invalid_promo_result("Este código no aplica para el plan seleccionado.", plan=plan)

    return build_valid_promo_pricing_result(plan=plan, promo=promo)
