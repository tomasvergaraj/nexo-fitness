"""user_referral_code_and_referrer

Agrega soporte para programa de referidos (Fase 6.4):

- users.referral_code: código único globalmente generado al primer pago
  del cliente. Formato típico: NOMBRE-XXXXX (ej "CARLOS-3A7B9").
- users.referrer_user_id: FK al user que refirió a este nuevo cliente.
  Se setea cuando alguien se inscribe desde un link con ?ref=CODE.

Revision ID: 7a853c58e1af
Revises: 53f3c39f2c68
Create Date: 2026-05-20 20:17:03.462159

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7a853c58e1af'
down_revision: Union[str, None] = '53f3c39f2c68'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('referral_code', sa.String(length=20), nullable=True),
    )
    op.create_unique_constraint('uq_users_referral_code', 'users', ['referral_code'])
    op.create_index('ix_users_referral_code', 'users', ['referral_code'], unique=False)

    op.add_column(
        'users',
        sa.Column(
            'referrer_user_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        'fk_users_referrer_user_id_users',
        'users', 'users',
        ['referrer_user_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_users_referrer_user_id', 'users', ['referrer_user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_users_referrer_user_id', table_name='users')
    op.drop_constraint('fk_users_referrer_user_id_users', 'users', type_='foreignkey')
    op.drop_column('users', 'referrer_user_id')

    op.drop_index('ix_users_referral_code', table_name='users')
    op.drop_constraint('uq_users_referral_code', 'users', type_='unique')
    op.drop_column('users', 'referral_code')
