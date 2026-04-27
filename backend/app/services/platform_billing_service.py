"""Pricing, promo codes, and payment tracking for platform SaaS billing."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import PaymentMethod
from app.models.platform import PlatformBillingPayment, PlatformPromoCode, SaaSPlan
from app.services.saas_plan_service import (
    SAAS_TAX_RATE_PERCENT,
    SaaSPlanDefinition,
    calculate_tax_breakdown,
    default_saas_plan_definitions,
    definition_from_record,
    ensure_default_saas_plans,
    round_currency_amount,
)


@dataclass
class PlatformSaaSPricingResult:
    valid: bool
    reason: str | None
    plan: SaaSPlanDefinition | None
    promo: PlatformPromoCode | None
    base_price: Decimal | None
    promo_discount_amount: Decimal | None
    taxable_subtotal: Decimal | None
    tax_rate: Decimal | None
    tax_amount: Decimal | None
    total_amount: Decimal | None


def normalize_platform_promo_code(code: str) -> str:
    return code.upper().strip()


def normalize_plan_keys(values: list[str] | tuple[str, ...] | None) -> list[str]:
    normalized: list[str] = []
    for value in values or []:
        cleaned = str(value).strip().lower()
        if cleaned and cleaned not in normalized:
            normalized.append(cleaned)
    return normalized


def serialize_plan_keys(values: list[str] | tuple[str, ...] | None) -> str | None:
    normalized = normalize_plan_keys(values)
    return json.dumps(normalized) if normalized else None


def parse_plan_keys(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return normalize_plan_keys([str(item) for item in parsed])


def calculate_platform_promo_discount_amount(
    *,
    promo: PlatformPromoCode,
    base_price: Decimal,
    currency: str | None,
) -> Decimal:
    if promo.discount_type == "percent":
        discount_amount = base_price * Decimal(str(promo.discount_value or 0)) / Decimal("100")
    else:
        discount_amount = Decimal(str(promo.discount_value or 0))

    discount_amount = round_currency_amount(discount_amount, currency)
    if discount_amount < 0:
        return Decimal("0")
    if discount_amount > base_price:
        return base_price
    return discount_amount


def _normalize_discount_value(discount_type: str, discount_value: Decimal) -> Decimal:
    if discount_type == "percent":
        return Decimal(str(discount_value)).quantize(Decimal("0.01"))
    return round_currency_amount(discount_value, "CLP")


def build_platform_saas_quote(
    *,
    plan: SaaSPlanDefinition,
    promo: PlatformPromoCode | None,
) -> PlatformSaaSPricingResult:
    base_price = round_currency_amount(plan.price or 0, plan.currency)
    promo_discount_amount = Decimal("0")
    if promo is not None:
        promo_discount_amount = calculate_platform_promo_discount_amount(
            promo=promo,
            base_price=base_price,
            currency=plan.currency,
        )

    taxable_subtotal = round_currency_amount(max(base_price - promo_discount_amount, Decimal("0")), plan.currency)
    _, tax_amount, total_amount = calculate_tax_breakdown(taxable_subtotal, plan.currency)

    return PlatformSaaSPricingResult(
        valid=True,
        reason=None,
        plan=plan,
        promo=promo,
        base_price=base_price,
        promo_discount_amount=promo_discount_amount,
        taxable_subtotal=taxable_subtotal,
        tax_rate=SAAS_TAX_RATE_PERCENT,
        tax_amount=tax_amount,
        total_amount=total_amount,
    )


def _invalid_platform_quote(
    reason: str,
    *,
    plan: SaaSPlanDefinition | None = None,
) -> PlatformSaaSPricingResult:
    if plan is None:
        return PlatformSaaSPricingResult(
            valid=False,
            reason=reason,
            plan=None,
            promo=None,
            base_price=None,
            promo_discount_amount=None,
            taxable_subtotal=None,
            tax_rate=SAAS_TAX_RATE_PERCENT,
            tax_amount=None,
            total_amount=None,
        )

    base_price = round_currency_amount(plan.price or 0, plan.currency)
    taxable_subtotal, tax_amount, total_amount = calculate_tax_breakdown(base_price, plan.currency)
    return PlatformSaaSPricingResult(
        valid=False,
        reason=reason,
        plan=plan,
        promo=None,
        base_price=base_price,
        promo_discount_amount=Decimal("0"),
        taxable_subtotal=taxable_subtotal,
        tax_rate=SAAS_TAX_RATE_PERCENT,
        tax_amount=tax_amount,
        total_amount=total_amount,
    )


def _metadata_decimal(metadata: dict, key: str, default: str = "0") -> Decimal:
    raw_value = metadata.get(key, default)
    try:
        return Decimal(str(raw_value))
    except Exception:
        return Decimal(default)


async def _resolve_platform_plan(
    db: AsyncSession,
    *,
    plan_key: str,
    require_public: bool,
) -> SaaSPlanDefinition | None:
    await ensure_default_saas_plans(db)
    query = select(SaaSPlan).where(
        SaaSPlan.key == plan_key.strip().lower(),
        SaaSPlan.is_active.is_(True),
    )
    if require_public:
        query = query.where(SaaSPlan.is_public.is_(True))
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if record:
        return definition_from_record(record)

    fallback = next(
        (
            plan
            for plan in default_saas_plan_definitions()
            if plan.key == plan_key.strip().lower() and plan.is_active and (plan.is_public or not require_public)
        ),
        None,
    )
    return fallback


async def pricing_from_snapshot(
    db: AsyncSession,
    *,
    plan_key: str,
    metadata: dict,
    require_public_plan: bool = False,
) -> PlatformSaaSPricingResult:
    plan = await _resolve_platform_plan(db, plan_key=plan_key, require_public=require_public_plan)
    if plan is None:
        return _invalid_platform_quote("Plan SaaS no disponible.")

    promo = None
    promo_code_id = str(metadata.get("promo_code_id") or "").strip()
    if promo_code_id:
        try:
            promo = await db.get(PlatformPromoCode, UUID(promo_code_id))
        except ValueError:
            promo = None

    base_price = round_currency_amount(_metadata_decimal(metadata, "base_amount", str(plan.price)), plan.currency)
    promo_discount_amount = round_currency_amount(_metadata_decimal(metadata, "promo_discount_amount", "0"), plan.currency)
    taxable_subtotal = round_currency_amount(
        _metadata_decimal(metadata, "taxable_subtotal", str(max(base_price - promo_discount_amount, Decimal("0")))),
        plan.currency,
    )
    tax_rate = round_currency_amount(_metadata_decimal(metadata, "tax_rate", str(SAAS_TAX_RATE_PERCENT)), plan.currency)
    tax_amount = round_currency_amount(_metadata_decimal(metadata, "tax_amount", "0"), plan.currency)
    total_amount = round_currency_amount(_metadata_decimal(metadata, "total_amount", str(taxable_subtotal + tax_amount)), plan.currency)

    return PlatformSaaSPricingResult(
        valid=True,
        reason=None,
        plan=plan,
        promo=promo,
        base_price=base_price,
        promo_discount_amount=promo_discount_amount,
        taxable_subtotal=taxable_subtotal,
        tax_rate=tax_rate,
        tax_amount=tax_amount,
        total_amount=total_amount,
    )


async def resolve_platform_saas_quote(
    db: AsyncSession,
    *,
    plan_key: str,
    promo_code: str | None = None,
    promo_code_id: UUID | None = None,
    require_public_plan: bool = True,
) -> PlatformSaaSPricingResult:
    plan = await _resolve_platform_plan(db, plan_key=plan_key, require_public=require_public_plan)
    if plan is None:
        return _invalid_platform_quote("Plan SaaS no disponible.")

    if not promo_code and not promo_code_id:
        return build_platform_saas_quote(plan=plan, promo=None)

    promo_query = select(PlatformPromoCode)
    if promo_code_id:
        promo_query = promo_query.where(PlatformPromoCode.id == promo_code_id)
    else:
        promo_query = promo_query.where(PlatformPromoCode.code == normalize_platform_promo_code(promo_code or ""))

    promo = (await db.execute(promo_query)).scalars().first()
    if not promo or not promo.is_active:
        return _invalid_platform_quote("Código promocional no válido o inactivo.", plan=plan)

    now = datetime.now(timezone.utc)
    if promo.expires_at and promo.expires_at < now:
        return _invalid_platform_quote("El código promocional ha expirado.", plan=plan)

    if promo.max_uses is not None and promo.uses_count >= promo.max_uses:
        return _invalid_platform_quote("El código promocional alcanzó su límite de usos.", plan=plan)

    allowed_plan_keys = parse_plan_keys(promo.plan_keys)
    if allowed_plan_keys and plan.key not in allowed_plan_keys:
        return _invalid_platform_quote("Este código no aplica para el plan seleccionado.", plan=plan)

    return build_platform_saas_quote(plan=plan, promo=promo)


async def list_platform_promo_codes(db: AsyncSession) -> list[PlatformPromoCode]:
    result = await db.execute(
        select(PlatformPromoCode).order_by(PlatformPromoCode.created_at.desc())
    )
    return result.scalars().all()


async def create_platform_promo_code(
    db: AsyncSession,
    *,
    code: str,
    name: str,
    description: str | None,
    discount_type: str,
    discount_value: Decimal,
    max_uses: int | None,
    expires_at: datetime | None,
    is_active: bool,
    plan_keys: list[str] | None,
) -> PlatformPromoCode:
    normalized_code = normalize_platform_promo_code(code)
    existing = (
        await db.execute(select(PlatformPromoCode).where(PlatformPromoCode.code == normalized_code))
    ).scalars().first()
    if existing:
        raise ValueError("Ya existe un código promocional SaaS con ese código.")

    promo = PlatformPromoCode(
        code=normalized_code,
        name=name.strip(),
        description=(description or "").strip() or None,
        discount_type=discount_type,
        discount_value=_normalize_discount_value(discount_type, discount_value),
        max_uses=max_uses,
        expires_at=expires_at,
        is_active=is_active,
        plan_keys=serialize_plan_keys(plan_keys),
    )
    db.add(promo)
    await db.flush()
    await db.refresh(promo)
    return promo


async def update_platform_promo_code(
    db: AsyncSession,
    *,
    promo_id: UUID,
    name: str | None = None,
    description: str | None = None,
    description_provided: bool = False,
    discount_type: str | None = None,
    discount_value: Decimal | None = None,
    max_uses: int | None = None,
    max_uses_provided: bool = False,
    expires_at: datetime | None = None,
    expires_at_provided: bool = False,
    is_active: bool | None = None,
    plan_keys: list[str] | None = None,
    plan_keys_provided: bool = False,
) -> PlatformPromoCode:
    promo = await db.get(PlatformPromoCode, promo_id)
    if not promo:
        raise ValueError("Código promocional SaaS no encontrado.")

    if name is not None:
        promo.name = name.strip()
    if description_provided:
        promo.description = (description or "").strip() or None
    if discount_type is not None:
        promo.discount_type = discount_type
    if discount_value is not None:
        promo.discount_value = _normalize_discount_value(promo.discount_type, discount_value)
    if max_uses_provided:
        promo.max_uses = max_uses
    if expires_at_provided:
        promo.expires_at = expires_at
    if is_active is not None:
        promo.is_active = is_active
    if plan_keys_provided:
        promo.plan_keys = serialize_plan_keys(plan_keys)

    promo.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(promo)
    return promo


async def delete_platform_promo_code(db: AsyncSession, *, promo_id: UUID) -> None:
    promo = await db.get(PlatformPromoCode, promo_id)
    if not promo:
        raise ValueError("Código promocional SaaS no encontrado.")
    await db.delete(promo)
    await db.flush()


async def record_platform_billing_payment(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    created_by: UUID | None,
    pricing: PlatformSaaSPricingResult,
    payment_method: PaymentMethod,
    external_reference: str | None,
    starts_at: date,
    expires_at: date | None,
    notes: str | None = None,
    paid_at: datetime | None = None,
    metadata: dict | None = None,
) -> PlatformBillingPayment:
    if pricing.plan is None or pricing.base_price is None or pricing.tax_rate is None or pricing.tax_amount is None or pricing.total_amount is None:
        raise ValueError("No se puede registrar un cobro SaaS sin cotización válida.")

    normalized_reference = (external_reference or "").strip() or None
    if normalized_reference:
        existing = (
            await db.execute(
                select(PlatformBillingPayment).where(
                    PlatformBillingPayment.tenant_id == tenant_id,
                    PlatformBillingPayment.payment_method == payment_method,
                    PlatformBillingPayment.external_reference == normalized_reference,
                )
            )
        ).scalars().first()
        if existing:
            return existing

    payment = PlatformBillingPayment(
        tenant_id=tenant_id,
        user_id=user_id,
        promo_code_id=pricing.promo.id if pricing.promo else None,
        plan_key=pricing.plan.key,
        plan_name=pricing.plan.name,
        base_amount=pricing.base_price,
        promo_discount_amount=pricing.promo_discount_amount or Decimal("0"),
        tax_rate=pricing.tax_rate,
        tax_amount=pricing.tax_amount,
        total_amount=pricing.total_amount,
        currency=pricing.plan.currency,
        payment_method=payment_method,
        external_reference=normalized_reference,
        notes=(notes or "").strip() or None,
        paid_at=paid_at or datetime.now(timezone.utc),
        starts_at=starts_at,
        expires_at=expires_at,
        created_by=created_by,
        metadata_json=json.dumps(metadata or {}),
    )
    db.add(payment)
    await db.flush()

    if pricing.promo is not None:
        pricing.promo.uses_count = int(pricing.promo.uses_count or 0) + 1
        pricing.promo.updated_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(payment)
    return payment
