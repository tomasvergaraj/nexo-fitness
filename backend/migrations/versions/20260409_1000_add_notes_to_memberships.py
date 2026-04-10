"""add notes column to memberships

Revision ID: 20260409_1000
Revises: 20260408_1900
Create Date: 2026-04-09 10:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260409_1000"
down_revision: Union[str, None] = "20260408_1900"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column(
            "notes",
            sa.Text(),
            nullable=True,
            comment="Notas internas del owner sobre esta membresía.",
        ),
    )


def downgrade() -> None:
    op.drop_column("memberships", "notes")
