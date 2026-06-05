"""add prefers_qr_card to users

Agrega flag para marcar manualmente a clientes que no usan la app móvil y
prefieren tarjeta QR. Combinado con detección automática (PushSubscription
activa), permite al owner segmentar a quienes solo usan QR.

Revision ID: d7e8f9a0b1c2
Revises: c1f2a3b4d5e6
Create Date: 2026-05-28 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7e8f9a0b1c2'
down_revision: Union[str, None] = 'c1f2a3b4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'prefers_qr_card',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'prefers_qr_card')
