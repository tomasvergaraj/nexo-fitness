"""add TUU payment support

Revision ID: 20260422_1900
Revises: 20260422_1100
Create Date: 2026-04-22 19:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260422_1900"
down_revision: Union[str, None] = "20260422_1100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'TUU'")

    op.create_table(
        "tuu_transactions",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "payment_account_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("tenant_payment_provider_accounts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("flow_type", sa.String(length=40), nullable=False),
        sa.Column("flow_reference", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default=sa.text("'created'")),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'CLP'")),
        sa.Column("account_id", sa.String(length=30), nullable=False),
        sa.Column("environment", sa.String(length=20), nullable=False, server_default=sa.text("'integration'")),
        sa.Column("provider_url", sa.String(length=500), nullable=True),
        sa.Column("checkout_url", sa.String(length=500), nullable=True),
        sa.Column("success_url", sa.String(length=500), nullable=True),
        sa.Column("cancel_url", sa.String(length=500), nullable=True),
        sa.Column("callback_url", sa.String(length=500), nullable=True),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("provider_response_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("flow_reference", name="uq_tuu_transactions_flow_reference"),
    )
    op.create_index("ix_tuu_transactions_tenant_id", "tuu_transactions", ["tenant_id"], unique=False)
    op.create_index("ix_tuu_transactions_user_id", "tuu_transactions", ["user_id"], unique=False)
    op.create_index("ix_tuu_transactions_payment_account_id", "tuu_transactions", ["payment_account_id"], unique=False)
    op.create_index("ix_tuu_transactions_flow_type", "tuu_transactions", ["flow_type"], unique=False)
    op.create_index("ix_tuu_transactions_status", "tuu_transactions", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_tuu_transactions_status", table_name="tuu_transactions")
    op.drop_index("ix_tuu_transactions_flow_type", table_name="tuu_transactions")
    op.drop_index("ix_tuu_transactions_payment_account_id", table_name="tuu_transactions")
    op.drop_index("ix_tuu_transactions_user_id", table_name="tuu_transactions")
    op.drop_index("ix_tuu_transactions_tenant_id", table_name="tuu_transactions")
    op.drop_table("tuu_transactions")
