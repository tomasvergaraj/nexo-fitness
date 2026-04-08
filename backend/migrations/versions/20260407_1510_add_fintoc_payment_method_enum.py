"""add fintoc payment method enum value

Revision ID: 20260407_1510
Revises: 20260324_1700
Create Date: 2026-04-07 15:10:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260407_1510"
down_revision: Union[str, None] = "20260324_1700"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'FINTOC'")


def downgrade() -> None:
    # PostgreSQL enums cannot drop individual values safely in a simple downgrade.
    pass
