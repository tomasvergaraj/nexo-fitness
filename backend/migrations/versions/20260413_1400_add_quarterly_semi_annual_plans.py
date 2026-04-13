"""add quarterly and semi_annual license types and saas plans

Revision ID: 20260413_1400
Revises: 20260412_1300
Create Date: 2026-04-13 14:00:00
"""

from decimal import Decimal
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "20260413_1400"
down_revision: Union[str, None] = "20260412_1300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ── Prices ────────────────────────────────────────────────────────────────────
# IVA incluido. Ladder: mensual (0%) → trimestral (~9.5%) → semestral (~11.9%) → anual (~16.7%)
QUARTERLY_PRICE = Decimal("94990")
SEMI_ANNUAL_PRICE = Decimal("184990")

QUARTERLY_FEATURES = (
    '["Hasta 500 miembros activos","Hasta 3 sedes","Clientes, clases y check-in",'
    '"Pagos y cobros internos","Tienda online y cobro p\\u00fablico",'
    '"Reportes y estad\\u00edsticas","~9.5% descuento vs mensual","14 d\\u00edas de prueba gratis"]'
)

SEMI_ANNUAL_FEATURES = (
    '["Hasta 500 miembros activos","Hasta 3 sedes","Clientes, clases y check-in",'
    '"Pagos y cobros internos","Tienda online y cobro p\\u00fablico",'
    '"Reportes y estad\\u00edsticas","~11.9% descuento vs mensual","14 d\\u00edas de prueba gratis"]'
)


def upgrade() -> None:
    # ── 1. Extend both license_type enums ─────────────────────────────────────
    # ALTER TYPE … ADD VALUE IF NOT EXISTS must run outside a transaction.
    # Alembic wraps migrations in a transaction by default; we temporarily commit.
    op.execute(text("COMMIT"))
    # tenants.license_type uses license_type_enum (SQLAlchemy stores enum names = uppercase)
    op.execute(text("ALTER TYPE license_type_enum ADD VALUE IF NOT EXISTS 'QUARTERLY'"))
    op.execute(text("ALTER TYPE license_type_enum ADD VALUE IF NOT EXISTS 'SEMI_ANNUAL'"))
    # saas_plans.license_type uses saas_plan_license_type_enum
    op.execute(text("ALTER TYPE saas_plan_license_type_enum ADD VALUE IF NOT EXISTS 'QUARTERLY'"))
    op.execute(text("ALTER TYPE saas_plan_license_type_enum ADD VALUE IF NOT EXISTS 'SEMI_ANNUAL'"))
    op.execute(text("BEGIN"))

    # ── 2. Insert new SaaS plan rows (skip if already exist) ──────────────────
    conn = op.get_bind()

    quarterly_exists = conn.execute(
        text("SELECT 1 FROM saas_plans WHERE key = 'quarterly' LIMIT 1")
    ).fetchone()

    if not quarterly_exists:
        conn.execute(
            text("""
                INSERT INTO saas_plans (
                    id, key, name, description, license_type,
                    currency, price, billing_interval, trial_days,
                    max_members, max_branches, features,
                    stripe_price_id, highlighted, is_active, is_public,
                    webpay_enabled, fintoc_enabled, sort_order,
                    created_at, updated_at
                ) VALUES (
                    :id, 'quarterly', 'Trimestral',
                    'Paga 3 meses y ahorra casi 10.000 CLP. Sin ataduras de largo plazo.',
                    'QUARTERLY', 'CLP', :price, 'quarter', 14,
                    500, 3, :features,
                    NULL, true, true, true,
                    true, false, 2,
                    NOW(), NOW()
                )
            """),
            {
                "id": str(uuid.uuid4()),
                "price": str(QUARTERLY_PRICE),
                "features": QUARTERLY_FEATURES,
            },
        )

    semi_annual_exists = conn.execute(
        text("SELECT 1 FROM saas_plans WHERE key = 'semi_annual' LIMIT 1")
    ).fetchone()

    if not semi_annual_exists:
        conn.execute(
            text("""
                INSERT INTO saas_plans (
                    id, key, name, description, license_type,
                    currency, price, billing_interval, trial_days,
                    max_members, max_branches, features,
                    stripe_price_id, highlighted, is_active, is_public,
                    webpay_enabled, fintoc_enabled, sort_order,
                    created_at, updated_at
                ) VALUES (
                    :id, 'semi_annual', 'Semestral',
                    '6 meses con casi 25.000 CLP de ahorro. El equilibrio entre flexibilidad y precio.',
                    'SEMI_ANNUAL', 'CLP', :price, 'semi_annual', 14,
                    500, 3, :features,
                    NULL, false, true, true,
                    true, false, 3,
                    NOW(), NOW()
                )
            """),
            {
                "id": str(uuid.uuid4()),
                "price": str(SEMI_ANNUAL_PRICE),
                "features": SEMI_ANNUAL_FEATURES,
            },
        )

    # ── 3. Reorder existing plans: monthly → 1, annual → 4 ───────────────────
    conn.execute(text("UPDATE saas_plans SET sort_order = 1 WHERE key = 'monthly'"))
    conn.execute(text("UPDATE saas_plans SET sort_order = 4, highlighted = false WHERE key = 'annual'"))
    conn.execute(text("UPDATE saas_plans SET highlighted = false WHERE key = 'monthly'"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DELETE FROM saas_plans WHERE key IN ('quarterly', 'semi_annual')"))
    # Note: PostgreSQL does not support removing enum values.
    # The enum values 'quarterly' and 'semi_annual' will remain in license_type_enum.
