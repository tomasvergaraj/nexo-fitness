"""allow null cashier on user delete

Revision ID: 20260422_2100
Revises: 20260422_1900
Create Date: 2026-04-22 21:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260422_2100"
down_revision: Union[str, None] = "20260422_1900"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("pos_transactions_cashier_id_fkey", "pos_transactions", type_="foreignkey")
    op.alter_column(
        "pos_transactions",
        "cashier_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.create_foreign_key(
        "pos_transactions_cashier_id_fkey",
        "pos_transactions",
        "users",
        ["cashier_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("pos_transactions_cashier_id_fkey", "pos_transactions", type_="foreignkey")
    op.alter_column(
        "pos_transactions",
        "cashier_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_foreign_key(
        "pos_transactions_cashier_id_fkey",
        "pos_transactions",
        "users",
        ["cashier_id"],
        ["id"],
        ondelete="CASCADE",
    )
