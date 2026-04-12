"""add recurrence and program_id to gym_classes, default duration_weeks=0 in training_programs

Revision ID: 20260412_1100
Revises: 20260412_1000
Create Date: 2026-04-12 11:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260412_1100"
down_revision: Union[str, None] = "20260412_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add program_id FK to gym_classes (nullable)
    op.add_column(
        "gym_classes",
        sa.Column("program_id", sa.UUID(as_uuid=True), sa.ForeignKey("training_programs.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_gym_classes_program_id", "gym_classes", ["program_id"], unique=False)

    # Add recurrence fields
    op.add_column(
        "gym_classes",
        sa.Column("repeat_type", sa.String(20), nullable=False, server_default="none"),
    )
    op.add_column(
        "gym_classes",
        sa.Column("repeat_until", sa.Date(), nullable=True),
    )
    op.add_column(
        "gym_classes",
        sa.Column("recurrence_group_id", sa.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_gym_classes_recurrence_group_id", "gym_classes", ["recurrence_group_id"], unique=False)

    # Set duration_weeks default to 0 in training_programs
    op.alter_column(
        "training_programs",
        "duration_weeks",
        existing_type=sa.Integer(),
        nullable=False,
        server_default="0",
    )
    # Back-fill existing NULLs
    op.execute("UPDATE training_programs SET duration_weeks = 0 WHERE duration_weeks IS NULL")


def downgrade() -> None:
    op.alter_column(
        "training_programs",
        "duration_weeks",
        existing_type=sa.Integer(),
        nullable=True,
        server_default=None,
    )
    op.drop_index("ix_gym_classes_recurrence_group_id", table_name="gym_classes")
    op.drop_column("gym_classes", "recurrence_group_id")
    op.drop_column("gym_classes", "repeat_until")
    op.drop_column("gym_classes", "repeat_type")
    op.drop_index("ix_gym_classes_program_id", table_name="gym_classes")
    op.drop_column("gym_classes", "program_id")
