"""add training program enrollments table

Revision ID: 20260412_1000
Revises: 20260410_1300
Create Date: 2026-04-12 10:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260412_1000"
down_revision: Union[str, None] = "20260410_1300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "training_program_enrollments",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("program_id", sa.UUID(as_uuid=True), sa.ForeignKey("training_programs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("program_id", "user_id", name="uq_training_program_enrollment"),
    )
    op.create_index("ix_training_program_enrollments_tenant_id", "training_program_enrollments", ["tenant_id"], unique=False)
    op.create_index("ix_training_program_enrollments_program_id", "training_program_enrollments", ["program_id"], unique=False)
    op.create_index("ix_training_program_enrollments_user_id", "training_program_enrollments", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_training_program_enrollments_user_id", table_name="training_program_enrollments")
    op.drop_index("ix_training_program_enrollments_program_id", table_name="training_program_enrollments")
    op.drop_index("ix_training_program_enrollments_tenant_id", table_name="training_program_enrollments")
    op.drop_table("training_program_enrollments")
