"""add refund tracking fields to platform_billing_payments

Revision ID: 20260506_1300
Revises: 20260506_1200
Create Date: 2026-05-06 13:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "20260506_1300"
down_revision = "20260506_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_billing_payments",
        sa.Column("refunded_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "platform_billing_payments",
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "platform_billing_payments",
        sa.Column("refund_reason", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "platform_billing_payments",
        sa.Column("refund_external_reference", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "platform_billing_payments",
        sa.Column("refund_status", sa.String(length=30), nullable=True, index=True),
    )


def downgrade() -> None:
    op.drop_column("platform_billing_payments", "refund_status")
    op.drop_column("platform_billing_payments", "refund_external_reference")
    op.drop_column("platform_billing_payments", "refund_reason")
    op.drop_column("platform_billing_payments", "refunded_at")
    op.drop_column("platform_billing_payments", "refunded_amount")
