"""Catalog service for platform-level SaaS plans."""

import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.payments.stripe_service import stripe_service
from app.models.platform import SaaSPlan
from app.models.tenant import LicenseType
from app.schemas.billing import (
    AdminSaaSPlanCreateRequest,
    AdminSaaSPlanResponse,
    AdminSaaSPlanUpdateRequest,
    SaaSPlanResponse,
)

settings = get_settings()


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
    highlighted: bool = False
    is_active: bool = True
    is_public: bool = True
    sort_order: int = 0
    id: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @property
    def checkout_enabled(self) -> bool:
        return bool(self.stripe_price_id and stripe_service.is_configured())

    def to_schema(self) -> SaaSPlanResponse:
        return SaaSPlanResponse(
            key=self.key,
            name=self.name,
            description=self.description,
            license_type=self.license_type.value,
            currency=self.currency,
            price=self.price,
            billing_interval=self.billing_interval,
            trial_days=self.trial_days,
            max_members=self.max_members,
            max_branches=self.max_branches,
            features=list(self.features),
            highlighted=self.highlighted,
            checkout_enabled=self.checkout_enabled,
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
            billing_interval=self.billing_interval,
            trial_days=self.trial_days,
            max_members=self.max_members,
            max_branches=self.max_branches,
            features=list(self.features),
            highlighted=self.highlighted,
            checkout_enabled=self.checkout_enabled,
            stripe_price_id=self.stripe_price_id or None,
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
            description="Ideal para gimnasios que quieren arrancar con trial y activar pago online en el mismo flujo.",
            license_type=LicenseType.MONTHLY,
            price=Decimal(settings.SAAS_MONTHLY_PRICE),
            currency=settings.SAAS_CURRENCY,
            billing_interval="month",
            trial_days=settings.SAAS_TRIAL_DAYS,
            max_members=500,
            max_branches=3,
            features=(
                "Dashboard operativo multitenant",
                "Clientes, clases y check-in",
                "Pagos internos y reportes",
                "Trial automatico y checkout Stripe",
            ),
            stripe_price_id=settings.STRIPE_SAAS_MONTHLY_PRICE_ID,
            highlighted=True,
            sort_order=1,
        ),
        SaaSPlanDefinition(
            key="annual",
            name="Anual",
            description="Mejor precio para operaciones estables que quieren crecer con mas capacidad y menor churn.",
            license_type=LicenseType.ANNUAL,
            price=Decimal(settings.SAAS_ANNUAL_PRICE),
            currency=settings.SAAS_CURRENCY,
            billing_interval="year",
            trial_days=settings.SAAS_TRIAL_DAYS,
            max_members=1500,
            max_branches=10,
            features=(
                "Todo el plan mensual",
                "Mayor capacidad de sedes y miembros",
                "Prioridad para expansion comercial",
                "Costo anual con descuento",
            ),
            stripe_price_id=settings.STRIPE_SAAS_ANNUAL_PRICE_ID,
            sort_order=2,
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
    }


def _coerce_decimal(value: object, default: str = "0") -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def definition_from_record(record: SaaSPlan) -> SaaSPlanDefinition:
    return SaaSPlanDefinition(
        id=record.id,
        key=record.key,
        name=record.name,
        description=record.description or "",
        license_type=record.license_type,
        price=_coerce_decimal(record.price),
        currency=record.currency,
        billing_interval=record.billing_interval,
        trial_days=record.trial_days,
        max_members=record.max_members,
        max_branches=record.max_branches,
        features=tuple(parse_plan_features(record.features)),
        stripe_price_id=record.stripe_price_id or "",
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
        raise ValueError("SaaS plan was not found")

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
        if key in {"name", "description"} and value is not None:
            setattr(record, key, str(value).strip())
            continue
        setattr(record, key, value)

    await db.flush()
    await db.refresh(record)
    return definition_from_record(record)
