"""add next plan fields to tenant

Revision ID: a3e98d968907
Revises: 20260423_1000
Create Date: 2026-04-24 18:53:01.565777

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3e98d968907'
down_revision: Union[str, None] = '20260423_1000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tenants', sa.Column('next_plan_key', sa.String(length=100), nullable=True))
    op.add_column('tenants', sa.Column('next_plan_name', sa.String(length=200), nullable=True))
    op.add_column('tenants', sa.Column('next_plan_starts_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('tenants', 'next_plan_starts_at')
    op.drop_column('tenants', 'next_plan_name')
    op.drop_column('tenants', 'next_plan_key')
