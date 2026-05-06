"""add platform_audit_logs table

Revision ID: 20260506_1200
Revises: 20260505_1700
Create Date: 2026-05-06 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260506_1200"
down_revision = "20260505_1700"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("actor_email", sa.String(length=255), nullable=True, index=True),
        sa.Column("action", sa.String(length=80), nullable=False, index=True),
        sa.Column("target_type", sa.String(length=60), nullable=True, index=True),
        sa.Column("target_id", sa.String(length=80), nullable=True, index=True),
        sa.Column("target_label", sa.String(length=255), nullable=True),
        sa.Column("payload", postgresql.JSONB, nullable=True),
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="info", index=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
            index=True,
        ),
    )
    op.create_index(
        "ix_platform_audit_logs_target",
        "platform_audit_logs",
        ["target_type", "target_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_platform_audit_logs_target", table_name="platform_audit_logs")
    op.drop_table("platform_audit_logs")
