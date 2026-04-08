"""add fintoc_enabled column to saas_plans

Revision ID: 20260407_1600
Revises: 20260407_1510
Create Date: 2026-04-07 16:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260407_1600"
down_revision: Union[str, None] = "20260407_1510"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saas_plans",
        sa.Column("fintoc_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("saas_plans", "fintoc_enabled")
