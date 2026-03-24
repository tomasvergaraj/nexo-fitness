"""create push deliveries

Revision ID: 20260324_1300
Revises: 20260324_1100
Create Date: 2026-03-24 13:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260324_1300"
down_revision: Union[str, None] = "20260324_1100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "push_deliveries" not in tables:
        op.create_table(
            "push_deliveries",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("notification_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("subscription_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("expo_push_token", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("ticket_id", sa.String(length=255), nullable=True),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("error", sa.String(length=100), nullable=True),
            sa.Column("receipt_status", sa.String(length=30), nullable=True),
            sa.Column("receipt_message", sa.Text(), nullable=True),
            sa.Column("receipt_error", sa.String(length=100), nullable=True),
            sa.Column("receipt_checked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["notification_id"], ["notifications.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["subscription_id"], ["push_subscriptions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_push_deliveries_tenant_id"), "push_deliveries", ["tenant_id"], unique=False)
        op.create_index(op.f("ix_push_deliveries_user_id"), "push_deliveries", ["user_id"], unique=False)
        op.create_index(op.f("ix_push_deliveries_notification_id"), "push_deliveries", ["notification_id"], unique=False)
        op.create_index(op.f("ix_push_deliveries_subscription_id"), "push_deliveries", ["subscription_id"], unique=False)
        op.create_index(op.f("ix_push_deliveries_ticket_id"), "push_deliveries", ["ticket_id"], unique=False)
        op.create_index(op.f("ix_push_deliveries_receipt_status"), "push_deliveries", ["receipt_status"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "push_deliveries" not in tables:
        return

    op.drop_index(op.f("ix_push_deliveries_receipt_status"), table_name="push_deliveries")
    op.drop_index(op.f("ix_push_deliveries_ticket_id"), table_name="push_deliveries")
    op.drop_index(op.f("ix_push_deliveries_subscription_id"), table_name="push_deliveries")
    op.drop_index(op.f("ix_push_deliveries_notification_id"), table_name="push_deliveries")
    op.drop_index(op.f("ix_push_deliveries_user_id"), table_name="push_deliveries")
    op.drop_index(op.f("ix_push_deliveries_tenant_id"), table_name="push_deliveries")
    op.drop_table("push_deliveries")
