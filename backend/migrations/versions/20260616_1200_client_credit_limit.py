"""Límite de crédito por socio (fiados)

Agrega users.credit_limit: tope de deuda opcional por socio. NULL = sin límite.
El modo de aplicación (off/warn/block) vive en tenant.features (JSON), no en DB.

Aditiva y nullable; sin backfill.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('credit_limit', sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'credit_limit')
