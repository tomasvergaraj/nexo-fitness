"""add platform leads payment accounts and push subscriptions

Revision ID: 20260323_1400
Revises: 20260323_1000
Create Date: 2026-03-23 14:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260323_1400"
down_revision: Union[str, None] = "20260323_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "platform_leads" not in tables:
        op.create_table(
            "platform_leads",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("owner_name", sa.String(length=200), nullable=False),
            sa.Column("gym_name", sa.String(length=200), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("phone", sa.String(length=50), nullable=True),
            sa.Column("request_type", sa.String(length=30), nullable=False),
            sa.Column("source", sa.String(length=50), nullable=False),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("desired_plan_key", sa.String(length=100), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_platform_leads_email"), "platform_leads", ["email"], unique=False)

    if "tenant_payment_provider_accounts" not in tables:
        op.create_table(
            "tenant_payment_provider_accounts",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("provider", sa.String(length=30), nullable=False),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("account_label", sa.String(length=200), nullable=True),
            sa.Column("public_identifier", sa.String(length=255), nullable=True),
            sa.Column("checkout_base_url", sa.String(length=500), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_tenant_payment_provider_accounts_tenant_id"),
            "tenant_payment_provider_accounts",
            ["tenant_id"],
            unique=False,
        )

    if "push_subscriptions" not in tables:
        op.create_table(
            "push_subscriptions",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("device_type", sa.String(length=30), nullable=False),
            sa.Column("device_name", sa.String(length=200), nullable=True),
            sa.Column("expo_push_token", sa.String(length=255), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_push_subscriptions_tenant_id"), "push_subscriptions", ["tenant_id"], unique=False)
        op.create_index(op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"], unique=False)
        op.create_index(
            op.f("ix_push_subscriptions_expo_push_token"),
            "push_subscriptions",
            ["expo_push_token"],
            unique=False,
        )


def downgrade() -> None:
    if op.get_bind() is not None:
        op.drop_index(op.f("ix_push_subscriptions_expo_push_token"), table_name="push_subscriptions")
        op.drop_index(op.f("ix_push_subscriptions_user_id"), table_name="push_subscriptions")
        op.drop_index(op.f("ix_push_subscriptions_tenant_id"), table_name="push_subscriptions")
        op.drop_table("push_subscriptions")

        op.drop_index(
            op.f("ix_tenant_payment_provider_accounts_tenant_id"),
            table_name="tenant_payment_provider_accounts",
        )
        op.drop_table("tenant_payment_provider_accounts")

        op.drop_index(op.f("ix_platform_leads_email"), table_name="platform_leads")
        op.drop_table("platform_leads")
