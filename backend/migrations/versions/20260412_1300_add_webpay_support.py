"""add webpay support

Revision ID: 20260412_1300
Revises: 20260412_1100
Create Date: 2026-04-12 13:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260412_1300"
down_revision: Union[str, None] = "20260412_1100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'WEBPAY'")

    op.add_column(
        "saas_plans",
        sa.Column("webpay_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.alter_column("saas_plans", "webpay_enabled", server_default=None)

    op.create_table(
        "webpay_transactions",
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
        sa.Column("flow_reference", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default=sa.text("'created'")),
        sa.Column("buy_order", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("token", sa.String(length=128), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'CLP'")),
        sa.Column("commerce_code", sa.String(length=30), nullable=False),
        sa.Column("environment", sa.String(length=20), nullable=False, server_default=sa.text("'integration'")),
        sa.Column("provider_url", sa.String(length=500), nullable=True),
        sa.Column("checkout_url", sa.String(length=500), nullable=True),
        sa.Column("success_url", sa.String(length=500), nullable=True),
        sa.Column("cancel_url", sa.String(length=500), nullable=True),
        sa.Column("return_url", sa.String(length=500), nullable=True),
        sa.Column("authorization_code", sa.String(length=20), nullable=True),
        sa.Column("response_code", sa.Integer(), nullable=True),
        sa.Column("transaction_status", sa.String(length=40), nullable=True),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("provider_response_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("buy_order", name="uq_webpay_transactions_buy_order"),
        sa.UniqueConstraint("session_id", name="uq_webpay_transactions_session_id"),
        sa.UniqueConstraint("token", name="uq_webpay_transactions_token"),
    )
    op.create_index("ix_webpay_transactions_tenant_id", "webpay_transactions", ["tenant_id"], unique=False)
    op.create_index("ix_webpay_transactions_user_id", "webpay_transactions", ["user_id"], unique=False)
    op.create_index("ix_webpay_transactions_payment_account_id", "webpay_transactions", ["payment_account_id"], unique=False)
    op.create_index("ix_webpay_transactions_flow_type", "webpay_transactions", ["flow_type"], unique=False)
    op.create_index("ix_webpay_transactions_status", "webpay_transactions", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_webpay_transactions_status", table_name="webpay_transactions")
    op.drop_index("ix_webpay_transactions_flow_type", table_name="webpay_transactions")
    op.drop_index("ix_webpay_transactions_payment_account_id", table_name="webpay_transactions")
    op.drop_index("ix_webpay_transactions_user_id", table_name="webpay_transactions")
    op.drop_index("ix_webpay_transactions_tenant_id", table_name="webpay_transactions")
    op.drop_table("webpay_transactions")
    op.drop_column("saas_plans", "webpay_enabled")
