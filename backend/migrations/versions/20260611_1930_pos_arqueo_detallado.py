"""POS arqueo detallado (Etapa 1)

Cierre de caja detallado: enlaza gastos y cobros de membresía en efectivo a la
sesión de caja y guarda un snapshot del arqueo al cierre.

- payments.session_id           → caja a la que se imputó el efectivo de un plan
- expenses.paid_from_cash       → el gasto se pagó con efectivo de la caja
- expenses.session_id           → sesión a la que se imputó el gasto
- cash_register_sessions.*       → snapshot: cash_sales, membership_cash,
                                   cash_refunds, cash_expenses, by_method_json

Todas las columnas son aditivas y nullable (paid_from_cash con default false),
sin backfill ni transformación de datos.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-11 19:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # payments → caja del cobro de membresía en efectivo
    op.add_column('payments', sa.Column('session_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_payments_session', 'payments', 'cash_register_sessions',
        ['session_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_payments_session_id', 'payments', ['session_id'])

    # expenses → gasto pagado de caja
    op.add_column('expenses', sa.Column('paid_from_cash', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('expenses', sa.Column('session_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_expenses_session', 'expenses', 'cash_register_sessions',
        ['session_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_expenses_session_id', 'expenses', ['session_id'])

    # cash_register_sessions → snapshot del arqueo al cierre
    op.add_column('cash_register_sessions', sa.Column('cash_sales', sa.Numeric(12, 2), nullable=True))
    op.add_column('cash_register_sessions', sa.Column('membership_cash', sa.Numeric(12, 2), nullable=True))
    op.add_column('cash_register_sessions', sa.Column('cash_refunds', sa.Numeric(12, 2), nullable=True))
    op.add_column('cash_register_sessions', sa.Column('cash_expenses', sa.Numeric(12, 2), nullable=True))
    op.add_column('cash_register_sessions', sa.Column('by_method_json', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('cash_register_sessions', 'by_method_json')
    op.drop_column('cash_register_sessions', 'cash_expenses')
    op.drop_column('cash_register_sessions', 'cash_refunds')
    op.drop_column('cash_register_sessions', 'membership_cash')
    op.drop_column('cash_register_sessions', 'cash_sales')

    op.drop_index('ix_expenses_session_id', table_name='expenses')
    op.drop_constraint('fk_expenses_session', 'expenses', type_='foreignkey')
    op.drop_column('expenses', 'session_id')
    op.drop_column('expenses', 'paid_from_cash')

    op.drop_index('ix_payments_session_id', table_name='payments')
    op.drop_constraint('fk_payments_session', 'payments', type_='foreignkey')
    op.drop_column('payments', 'session_id')
