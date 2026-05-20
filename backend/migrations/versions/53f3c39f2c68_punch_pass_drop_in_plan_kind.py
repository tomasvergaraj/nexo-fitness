"""punch_pass_drop_in_plan_kind

Agrega soporte para Plan.plan_kind (SUBSCRIPTION | PUNCH_PASS | DROP_IN),
Plan.total_uses (cantidad de usos para punch_pass) y Membership.uses_remaining
(decrementa en cada check-in para planes basados en usos).

Revision ID: 53f3c39f2c68
Revises: 20260517_1200
Create Date: 2026-05-20 19:46:06.804113

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '53f3c39f2c68'
down_revision: Union[str, None] = '20260517_1200'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    plan_kind_enum = sa.Enum(
        'SUBSCRIPTION', 'PUNCH_PASS', 'DROP_IN',
        name='plan_kind_enum',
    )
    plan_kind_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        'plans',
        sa.Column(
            'plan_kind',
            sa.Enum('SUBSCRIPTION', 'PUNCH_PASS', 'DROP_IN', name='plan_kind_enum', create_type=False),
            server_default='SUBSCRIPTION',
            nullable=False,
        ),
    )
    op.add_column('plans', sa.Column('total_uses', sa.Integer(), nullable=True))
    op.add_column('memberships', sa.Column('uses_remaining', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('memberships', 'uses_remaining')
    op.drop_column('plans', 'total_uses')
    op.drop_column('plans', 'plan_kind')
    sa.Enum(name='plan_kind_enum').drop(op.get_bind(), checkfirst=True)
