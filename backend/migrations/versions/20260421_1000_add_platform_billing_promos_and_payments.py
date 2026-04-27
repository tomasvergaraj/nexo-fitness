"""add platform billing promo codes and payment tracking

Revision ID: 20260421_1000
Revises: 20260417_1000
Create Date: 2026-04-21 10:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260421_1000"
down_revision: Union[str, None] = "20260417_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


payment_method_enum = postgresql.ENUM(
    "STRIPE",
    "MERCADOPAGO",
    "FINTOC",
    "WEBPAY",
    "CASH",
    "TRANSFER",
    "OTHER",
    name="payment_method_enum",
    create_type=False,
)


def upgrade() -> None:
    op.create_table(
        "platform_promo_codes",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("discount_type", sa.String(length=10), nullable=False),
        sa.Column("discount_value", sa.Numeric(10, 2), nullable=False),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("plan_keys", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("code", name="uq_platform_promo_codes_code"),
    )
    op.create_index("ix_platform_promo_codes_code", "platform_promo_codes", ["code"], unique=True)

    op.create_table(
        "platform_billing_payments",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "promo_code_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("platform_promo_codes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("plan_key", sa.String(length=100), nullable=False),
        sa.Column("plan_name", sa.String(length=200), nullable=False),
        sa.Column("base_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("promo_discount_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("tax_rate", sa.Numeric(5, 2), nullable=False, server_default=sa.text("19")),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'CLP'")),
        sa.Column("payment_method", payment_method_enum, nullable=False),
        sa.Column("external_reference", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("starts_at", sa.Date(), nullable=False),
        sa.Column("expires_at", sa.Date(), nullable=True),
        sa.Column("created_by", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_platform_billing_payments_tenant_id", "platform_billing_payments", ["tenant_id"], unique=False)
    op.create_index("ix_platform_billing_payments_user_id", "platform_billing_payments", ["user_id"], unique=False)
    op.create_index("ix_platform_billing_payments_promo_code_id", "platform_billing_payments", ["promo_code_id"], unique=False)
    op.create_index("ix_platform_billing_payments_plan_key", "platform_billing_payments", ["plan_key"], unique=False)
    op.create_index("ix_platform_billing_payments_created_by", "platform_billing_payments", ["created_by"], unique=False)
    op.create_index(
        "ix_platform_billing_payments_external_reference",
        "platform_billing_payments",
        ["external_reference"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_platform_billing_payments_external_reference", table_name="platform_billing_payments")
    op.drop_index("ix_platform_billing_payments_created_by", table_name="platform_billing_payments")
    op.drop_index("ix_platform_billing_payments_plan_key", table_name="platform_billing_payments")
    op.drop_index("ix_platform_billing_payments_promo_code_id", table_name="platform_billing_payments")
    op.drop_index("ix_platform_billing_payments_user_id", table_name="platform_billing_payments")
    op.drop_index("ix_platform_billing_payments_tenant_id", table_name="platform_billing_payments")
    op.drop_table("platform_billing_payments")

    op.drop_index("ix_platform_promo_codes_code", table_name="platform_promo_codes")
    op.drop_table("platform_promo_codes")
