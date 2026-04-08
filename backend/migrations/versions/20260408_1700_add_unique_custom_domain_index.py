"""add unique custom domain index

Revision ID: 20260408_1700
Revises: 20260407_1600
Create Date: 2026-04-08 17:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260408_1700"
down_revision: Union[str, None] = "20260407_1600"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_custom_domain_lower
        ON tenants (lower(custom_domain))
        WHERE custom_domain IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_tenants_custom_domain_lower")
