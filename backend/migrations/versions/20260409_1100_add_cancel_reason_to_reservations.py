"""add cancel_reason column to reservations

Revision ID: 20260409_1100
Revises: 20260409_1000
Create Date: 2026-04-09 11:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260409_1100"
down_revision: Union[str, None] = "20260409_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reservations",
        sa.Column(
            "cancel_reason",
            sa.String(500),
            nullable=True,
            comment="Motivo opcional al cancelar la reserva.",
        ),
    )


def downgrade() -> None:
    op.drop_column("reservations", "cancel_reason")
