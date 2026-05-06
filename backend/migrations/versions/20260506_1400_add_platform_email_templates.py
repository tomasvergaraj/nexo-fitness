"""add platform_email_templates table

Revision ID: 20260506_1400
Revises: 20260506_1300
Create Date: 2026-05-06 14:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260506_1400"
down_revision = "20260506_1300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_email_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=100), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("subject", sa.String(length=300), nullable=False),
        sa.Column("body_html", sa.Text, nullable=False),
        sa.Column("body_text", sa.Text, nullable=True),
        sa.Column("variables", postgresql.JSONB, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "updated_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


def downgrade() -> None:
    op.drop_table("platform_email_templates")
