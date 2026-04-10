"""add body_measurements table

Revision ID: 20260410_1100
Revises: 20260410_1000
Create Date: 2026-04-10 11:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260410_1100"
down_revision: Union[str, None] = "20260410_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "body_measurements",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        # Body composition
        sa.Column("weight_kg", sa.Numeric(6, 2), nullable=True),
        sa.Column("body_fat_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("muscle_mass_kg", sa.Numeric(6, 2), nullable=True),
        # Circumferences (cm)
        sa.Column("chest_cm", sa.Numeric(6, 2), nullable=True),
        sa.Column("waist_cm", sa.Numeric(6, 2), nullable=True),
        sa.Column("hip_cm", sa.Numeric(6, 2), nullable=True),
        sa.Column("arm_cm", sa.Numeric(6, 2), nullable=True),
        sa.Column("thigh_cm", sa.Numeric(6, 2), nullable=True),
        # Notes
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("body_measurements")
