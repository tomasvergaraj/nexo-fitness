"""add reservation_id to checkins

Revision ID: 20260422_1100
Revises: 20260422_1000
Create Date: 2026-04-22 11:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260422_1100"
down_revision: Union[str, None] = "20260422_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "checkins",
        sa.Column(
            "reservation_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("reservations.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_checkins_reservation_id", "checkins", ["reservation_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_checkins_reservation_id", table_name="checkins")
    op.drop_column("checkins", "reservation_id")
