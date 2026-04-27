"""add feedback submissions

Revision ID: 20260423_1000
Revises: 20260422_2200
Create Date: 2026-04-23 10:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260423_1000"
down_revision: Union[str, None] = "20260422_2200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


feedback_category_enum = postgresql.ENUM(
    "suggestion",
    "improvement",
    "problem",
    "other",
    name="feedback_category_enum",
)


def upgrade() -> None:
    feedback_category_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "feedback_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "category",
            postgresql.ENUM(
                "suggestion",
                "improvement",
                "problem",
                "other",
                name="feedback_category_enum",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("image_path", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_feedback_submissions_tenant_id", "feedback_submissions", ["tenant_id"], unique=False)
    op.create_index("ix_feedback_submissions_created_by", "feedback_submissions", ["created_by"], unique=False)
    op.create_index("ix_feedback_submissions_created_at", "feedback_submissions", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_feedback_submissions_created_at", table_name="feedback_submissions")
    op.drop_index("ix_feedback_submissions_created_by", table_name="feedback_submissions")
    op.drop_index("ix_feedback_submissions_tenant_id", table_name="feedback_submissions")
    op.drop_table("feedback_submissions")
    feedback_category_enum.drop(op.get_bind(), checkfirst=True)
