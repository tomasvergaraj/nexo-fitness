"""Catalog service for platform-level SaaS plans."""

import json
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.payments.stripe_service import stripe_service
from app.integrations.payments.fintoc_service import fintoc_service
from app.integrations.payments.webpay_service import webpay_service
from app.models.platform import SaaSPlan
from app.models.tenant import LicenseType
from app.schemas.billing import (
    AdminSaaSPlanCreateRequest,
    AdminSaaSPlanResponse,
    AdminSaaSPlanUpdateRequest,
    SaaSPlanResponse,
)

settings = get_settings()
SAAS_TAX_RATE_PERCENT = Decimal(str(settings.SAAS_TAX_RATE_PERCENT))
CLP_QUANTUM = Decimal("1")
DEFAULT_QUANTUM = Decimal("0.01")


def _currency_quantum(currency: str | None) -> Decimal:
    return CLP_QUANTUM if str(currency or "").upper() == "CLP" else DEFAULT_QUANTUM


def round_currency_amount(value: Decimal | int | float | str, currency: str | None) -> Decimal:
    return Decimal(str(value)).quantize(_currency_quantum(currency), rounding=ROUND_HALF_UP)


def calculate_tax_breakdown(amount: Decimal | int | float | str, currency: str | None) -> tuple[Decimal, Decimal, Decimal]:
    taxable_subtotal = round_currency_amount(amount, currency)
    tax_amount = round_currency_amount(
        taxable_subtotal * SAAS_TAX_RATE_PERCENT / Decimal("100"),
        currency,
    )
    total_amount = round_currency_amount(taxable_subtotal + tax_amount, currency)
    return taxable_subtotal, tax_amount, total_amount


@dataclass(frozen=True)
class SaaSPlanDefinition:
    key: str
    name: str
    description: str
    license_type: LicenseType
    price: Decimal
    currency: str
    billing_interval: str
    trial_days: int
    max_members: int
    max_branches: int
    features: tuple[str, ...]
    stripe_price_id: str
    discount_pct: Optional[Decimal] = None
    fintoc_enabled: bool = False
    webpay_enabled: bool = False
    highlighted: bool = False
    is_active: bool = True
    is_public: bool = True
    sort_order: int = 0
    id: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @property
    def discounted_price(self) -> Decimal:
        """Precio final tras aplicar discount_pct. Igual al precio base si no hay descuento."""
        if not self.discount_pct:
            return self.price
        factor = (Decimal("100") - self.discount_pct) / Decimal("100")
        return (self.price * factor).quantize(Decimal("0.01"))

    @property
    def tax_rate(self) -> Decimal:
        return SAAS_TAX_RATE_PERCENT

    @property
    def tax_amount(self) -> Decimal:
        _, tax_amount, _ = calculate_tax_breakdown(self.price, self.currency)
        return tax_amount

    @property
    def total_price(self) -> Decimal:
        _, _, total_amount = calculate_tax_breakdown(self.price, self.currency)
        return total_amount

    @property
    def checkout_enabled(self) -> bool:
        stripe_ok = bool(self.stripe_price_id and stripe_service.is_configured())
        fintoc_ok = bool(self.fintoc_enabled and fintoc_service.is_configured())
        webpay_ok = bool(self.webpay_enabled and webpay_service.is_configured())
        return stripe_ok or fintoc_ok or webpay_ok

    @property
    def checkout_provider(self) -> Optional[str]:
        """Returns the active checkout provider for this plan."""
        if self.webpay_enabled and webpay_service.is_configured():
            return "webpay"
        if self.fintoc_enabled and fintoc_service.is_configured():
            return "fintoc"
        if self.stripe_price_id and stripe_service.is_configured():
            return "stripe"
        return None

    def to_schema(self) -> SaaSPlanResponse:
        return SaaSPlanResponse(
            key=self.key,
            name=self.name,
            description=self.description,
            license_type=self.license_type.value,
            currency=self.currency,
            price=self.price,
            discount_pct=self.discount_pct,
            tax_rate=self.tax_rate,
            tax_amount=self.tax_amount,
            total_price=self.total_price,
            billing_interval=self.billing_interval,
            trial_days=self.trial_days,
            max_members=self.max_members,
            max_branches=self.max_branches,
            features=list(self.features),
            highlighted=self.highlighted,
            checkout_enabled=self.checkout_enabled,
            checkout_provider=self.checkout_provider,
        )

    def to_admin_schema(self) -> AdminSaaSPlanResponse:
        return AdminSaaSPlanResponse(
            id=self.id,
            key=self.key,
            name=self.name,
            description=self.description,
            license_type=self.license_type.value,
            currency=self.currency,
            price=self.price,
            discount_pct=self.discount_pct,
            tax_rate=self.tax_rate,
            tax_amount=self.tax_amount,
            total_price=self.total_price,
            billing_interval=self.billing_interval,
            trial_days=self.trial_days,
            max_members=self.max_members,
            max_branches=self.max_branches,
            features=list(self.features),
            highlighted=self.highlighted,
            checkout_enabled=self.checkout_enabled,
            checkout_provider=self.checkout_provider,
            stripe_price_id=self.stripe_price_id or None,
            fintoc_enabled=self.fintoc_enabled,
            webpay_enabled=self.webpay_enabled,
            is_active=self.is_active,
            is_public=self.is_public,
            sort_order=self.sort_order,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


def normalize_plan_key(value: str) -> str:
    return value.strip().lower()


def normalize_plan_features(values: list[str] | tuple[str, ...]) -> list[str]:
    normalized: list[str] = []
    for value in values:
        cleaned = str(value).strip()
        if cleaned and cleaned not in normalized:
            normalized.append(cleaned)
    return normalized


def serialize_plan_features(values: list[str] | tuple[str, ...]) -> str:
    return json.dumps(normalize_plan_features(values))


def parse_plan_features(raw_value: Optional[str]) -> list[str]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return normalize_plan_features([str(item) for item in parsed])


def default_saas_plan_definitions() -> list[SaaSPlanDefinition]:
    return [
        SaaSPlanDefinition(
            key="monthly",
            name="Mensual",
            description="Ideal para empezar. Acceso completo a todas las funciones con 14 días gratis.",
            license_type=LicenseType.MONTHLY,
            price=Decimal(settings.SAAS_MONTHLY_PRICE),
            currency=settings.SAAS_CURRENCY,
            billing_interval="month",
            trial_days=settings.SAAS_TRIAL_DAYS,
            max_members=500,
            max_branches=3,
            features=(
                "Hasta 500 miembros activos",
                "Hasta 3 sedes",
                "Clientes, clases y check-in",
                "Pagos y cobros internos",
                "Tienda online y cobro público",
                "Reportes y estadísticas",
                f"{settings.SAAS_TRIAL_DAYS} días de prueba gratis",
            ),
            stripe_price_id=settings.STRIPE_SAAS_MONTHLY_PRICE_ID,
            webpay_enabled=True,
            highlighted=False,
            sort_order=1,
        ),
        SaaSPlanDefinition(
            key="quarterly",
            name="Trimestral",
            description="Paga 3 meses y ahorra casi 10.000 CLP. Sin ataduras de largo plazo.",
            license_type=LicenseType.QUARTERLY,
            price=Decimal(settings.SAAS_QUARTERLY_PRICE),
            currency=settings.SAAS_CURRENCY,
            billing_interval="quarter",
            trial_days=settings.SAAS_TRIAL_DAYS,
            max_members=500,
            max_branches=3,
            features=(
                "Hasta 500 miembros activos",
                "Hasta 3 sedes",
                "Clientes, clases y check-in",
                "Pagos y cobros internos",
                "Tienda online y cobro público",
                "Reportes y estadísticas",
                "~9.5% descuento vs mensual",
                f"{settings.SAAS_TRIAL_DAYS} días de prueba gratis",
            ),
            stripe_price_id=settings.STRIPE_SAAS_QUARTERLY_PRICE_ID,
            webpay_enabled=True,
            highlighted=True,
            sort_order=2,
        ),
        SaaSPlanDefinition(
            key="semi_annual",
            name="Semestral",
            description="6 meses con casi 25.000 CLP de ahorro. El equilibrio entre flexibilidad y precio.",
            license_type=LicenseType.SEMI_ANNUAL,
            price=Decimal(settings.SAAS_SEMI_ANNUAL_PRICE),
            currency=settings.SAAS_CURRENCY,
            billing_interval="semi_annual",
            trial_days=settings.SAAS_TRIAL_DAYS,
            max_members=500,
            max_branches=3,
            features=(
                "Hasta 500 miembros activos",
                "Hasta 3 sedes",
                "Clientes, clases y check-in",
                "Pagos y cobros internos",
                "Tienda online y cobro público",
                "Reportes y estadísticas",
                "~11.9% descuento vs mensual",
                f"{settings.SAAS_TRIAL_DAYS} días de prueba gratis",
            ),
            stripe_price_id=settings.STRIPE_SAAS_SEMI_ANNUAL_PRICE_ID,
            webpay_enabled=True,
            highlighted=False,
            sort_order=3,
        ),
        SaaSPlanDefinition(
            key="annual",
            name="Anual",
            description="2 meses gratis al pagar el año. Más capacidad para gimnasios en crecimiento.",
            license_type=LicenseType.ANNUAL,
            price=Decimal(settings.SAAS_ANNUAL_PRICE),
            currency=settings.SAAS_CURRENCY,
            billing_interval="year",
            trial_days=settings.SAAS_TRIAL_DAYS,
            max_members=1500,
            max_branches=10,
            features=(
                "Hasta 1500 miembros activos",
                "Hasta 10 sedes",
                "Todo lo del plan mensual",
                "2 meses gratis vs pago mensual",
                f"{settings.SAAS_TRIAL_DAYS} días de prueba gratis",
            ),
            stripe_price_id=settings.STRIPE_SAAS_ANNUAL_PRICE_ID,
            webpay_enabled=True,
            sort_order=4,
        ),
    ]


def get_public_saas_plans() -> list[SaaSPlanDefinition]:
    return default_saas_plan_definitions()


def plan_to_feature_flags(plan: SaaSPlanDefinition) -> dict[str, object]:
    return {
        "saas_plan_key": plan.key,
        "saas_plan_name": plan.name,
        "saas_plan_description": plan.description,
        "saas_plan_price": str(plan.price),
        "saas_currency": plan.currency,
        "billing_interval": plan.billing_interval,
        "saas_features": list(plan.features),
        "trial_days": plan.trial_days,
        "max_members": plan.max_members,
        "max_branches": plan.max_branches,
        "checkout_enabled": plan.checkout_enabled,
        "fintoc_enabled": plan.fintoc_enabled,
        "webpay_enabled": plan.webpay_enabled,
    }


def _coerce_decimal(value: object, default: str = "0") -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def definition_from_record(record: SaaSPlan) -> SaaSPlanDefinition:
    fallback_plan = next((plan for plan in default_saas_plan_definitions() if plan.key == record.key), None)
    return SaaSPlanDefinition(
        id=record.id,
        key=record.key,
        name=record.name,
        description=record.description or "",
        license_type=record.license_type,
        price=_coerce_decimal(record.price),
        discount_pct=_coerce_decimal(record.discount_pct, "0") if record.discount_pct is not None else None,
        currency=record.currency,
        billing_interval=record.billing_interval,
        trial_days=record.trial_days,
        max_members=record.max_members,
        max_branches=record.max_branches,
        features=tuple(parse_plan_features(record.features)),
        stripe_price_id=record.stripe_price_id or (fallback_plan.stripe_price_id if fallback_plan else ""),
        fintoc_enabled=bool(getattr(record, "fintoc_enabled", False)),
        webpay_enabled=bool(getattr(record, "webpay_enabled", False)),
        highlighted=record.highlighted,
        is_active=record.is_active,
        is_public=record.is_public,
        sort_order=record.sort_order,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def ensure_saas_plan_table(db: AsyncSession) -> None:
    await db.run_sync(lambda sync_session: SaaSPlan.__table__.create(sync_session.connection(), checkfirst=True))


async def ensure_default_saas_plans(db: AsyncSession) -> None:
    await ensure_saas_plan_table(db)

    default_plans = default_saas_plan_definitions()
    keys = [plan.key for plan in default_plans]
    result = await db.execute(select(SaaSPlan).where(SaaSPlan.key.in_(keys)))
    existing_keys = {plan.key for plan in result.scalars().all()}

    for plan in default_plans:
        if plan.key in existing_keys:
            continue
        db.add(
            SaaSPlan(
                key=plan.key,
                name=plan.name,
                description=plan.description,
                license_type=plan.license_type,
                currency=plan.currency,
                price=plan.price,
                billing_interval=plan.billing_interval,
                trial_days=plan.trial_days,
                max_members=plan.max_members,
                max_branches=plan.max_branches,
                features=serialize_plan_features(plan.features),
                stripe_price_id=plan.stripe_price_id or None,
                highlighted=plan.highlighted,
                is_active=plan.is_active,
                is_public=plan.is_public,
                sort_order=plan.sort_order,
                webpay_enabled=plan.webpay_enabled,
            )
        )

    await db.flush()


async def _unset_other_highlighted_plans(db: AsyncSession, *, exclude_plan_id: Optional[UUID] = None) -> None:
    query = update(SaaSPlan).where(SaaSPlan.highlighted.is_(True))
    if exclude_plan_id:
        query = query.where(SaaSPlan.id != exclude_plan_id)
    await db.execute(query.values(highlighted=False))


async def list_public_saas_plan_definitions(db: AsyncSession) -> list[SaaSPlanDefinition]:
    await ensure_default_saas_plans(db)
    result = await db.execute(
        select(SaaSPlan)
        .where(SaaSPlan.is_active.is_(True), SaaSPlan.is_public.is_(True))
        .order_by(SaaSPlan.sort_order.asc(), SaaSPlan.created_at.asc())
    )
    return [definition_from_record(plan) for plan in result.scalars().all()]


async def get_public_saas_plan_definition(db: AsyncSession, plan_key: str) -> SaaSPlanDefinition:
    await ensure_default_saas_plans(db)
    result = await db.execute(
        select(SaaSPlan).where(
            SaaSPlan.key == normalize_plan_key(plan_key),
            SaaSPlan.is_active.is_(True),
            SaaSPlan.is_public.is_(True),
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise ValueError(f"Plan '{plan_key}' is not available")
    return definition_from_record(record)


async def list_admin_saas_plan_definitions(db: AsyncSession) -> list[SaaSPlanDefinition]:
    await ensure_default_saas_plans(db)
    result = await db.execute(select(SaaSPlan).order_by(SaaSPlan.sort_order.asc(), SaaSPlan.created_at.asc()))
    return [definition_from_record(plan) for plan in result.scalars().all()]


async def create_admin_saas_plan(db: AsyncSession, data: AdminSaaSPlanCreateRequest) -> SaaSPlanDefinition:
    await ensure_default_saas_plans(db)
    key = normalize_plan_key(data.key)

    result = await db.execute(select(SaaSPlan).where(SaaSPlan.key == key))
    if result.scalar_one_or_none():
        raise ValueError(f"Plan key '{key}' is already registered")

    if data.highlighted:
        await _unset_other_highlighted_plans(db)

    record = SaaSPlan(
        key=key,
        name=data.name.strip(),
        description=data.description.strip(),
        license_type=LicenseType(data.license_type),
        currency=data.currency.upper(),
        price=data.price,
        billing_interval=data.billing_interval,
        trial_days=data.trial_days,
        max_members=data.max_members,
        max_branches=data.max_branches,
        features=serialize_plan_features(data.features),
        stripe_price_id=(data.stripe_price_id or "").strip() or None,
        fintoc_enabled=data.fintoc_enabled,
        webpay_enabled=data.webpay_enabled,
        highlighted=data.highlighted,
        is_active=data.is_active,
        is_public=data.is_public,
        sort_order=data.sort_order,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return definition_from_record(record)


async def update_admin_saas_plan(
    db: AsyncSession,
    plan_id: UUID,
    data: AdminSaaSPlanUpdateRequest,
) -> SaaSPlanDefinition:
    await ensure_default_saas_plans(db)
    record = await db.get(SaaSPlan, plan_id)
    if not record:
        raise ValueError("No se encontró el plan SaaS")

    payload = data.model_dump(exclude_unset=True)
    if payload.get("highlighted") is True:
        await _unset_other_highlighted_plans(db, exclude_plan_id=record.id)

    for key, value in payload.items():
        if key == "license_type" and value is not None:
            setattr(record, key, LicenseType(value))
            continue
        if key == "currency" and value is not None:
            setattr(record, key, str(value).upper())
            continue
        if key == "features" and value is not None:
            setattr(record, key, serialize_plan_features(value))
            continue
        if key == "stripe_price_id":
            cleaned = str(value).strip() if value is not None else ""
            setattr(record, key, cleaned or None)
            continue
        if key == "fintoc_enabled":
            setattr(record, key, bool(value))
            continue
        if key == "webpay_enabled":
            setattr(record, key, bool(value))
            continue
        if key in {"name", "description"} and value is not None:
            setattr(record, key, str(value).strip())
            continue
        setattr(record, key, value)

    await db.flush()
    await db.refresh(record)
    return definition_from_record(record)
