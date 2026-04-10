"""add discount_pct to plans and saas_plans

Revision ID: 20260408_1900
Revises: 20260408_1830
Create Date: 2026-04-08 19:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260408_1900"
down_revision: Union[str, None] = "20260408_1830"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Planes de gym (owners)
    op.add_column(
        "plans",
        sa.Column(
            "discount_pct",
            sa.Numeric(precision=5, scale=2),
            nullable=True,
            comment="Porcentaje de descuento 0-100. NULL = sin descuento.",
        ),
    )

    # Planes SaaS (super admin)
    op.add_column(
        "saas_plans",
        sa.Column(
            "discount_pct",
            sa.Numeric(precision=5, scale=2),
            nullable=True,
            comment="Porcentaje de descuento 0-100. NULL = sin descuento.",
        ),
    )


def downgrade() -> None:
    op.drop_column("plans", "discount_pct")
    op.drop_column("saas_plans", "discount_pct")
