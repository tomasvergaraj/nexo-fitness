"""add secondary color to tenants

Revision ID: 20260408_1830
Revises: 20260408_1700
Create Date: 2026-04-08 18:30:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260408_1830"
down_revision: Union[str, None] = "20260408_1700"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("secondary_color", sa.String(length=7), nullable=True, server_default="#0f766e"),
    )
    op.execute(
        """
        UPDATE tenants
        SET secondary_color = '#0f766e'
        WHERE secondary_color IS NULL OR secondary_color = ''
        """
    )
    op.alter_column("tenants", "secondary_color", server_default=None)


def downgrade() -> None:
    op.drop_column("tenants", "secondary_color")
