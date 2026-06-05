"""add_cash_register_sessions

Turnos de caja POS (apertura/cierre con fondo inicial y arqueo):

- cash_register_sessions: una sesión por turno, con opened_by/closed_by,
  opening_amount (fondo inicial), closing_amount (efectivo contado),
  expected_cash (calculado) y difference (descuadre). Una sola abierta por
  sucursal a la vez (validado en el servicio).
- pos_transactions.session_id: FK al turno en que se registró la venta.

Revision ID: c1f2a3b4d5e6
Revises: 7a853c58e1af
Create Date: 2026-05-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c1f2a3b4d5e6'
down_revision: Union[str, None] = '7a853c58e1af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    cash_session_status = postgresql.ENUM(
        'open', 'closed', name='cash_session_status_enum',
    )
    cash_session_status.create(op.get_bind(), checkfirst=True)
    # ya creado arriba: evitar que create_table lo recree (DuplicateObject)
    status_col = postgresql.ENUM(
        'open', 'closed', name='cash_session_status_enum', create_type=False,
    )

    op.create_table(
        'cash_register_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('branch_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('status', status_col, nullable=False, server_default='open'),
        sa.Column('opened_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('opened_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('opening_amount', sa.Numeric(12, 2), nullable=True),
        sa.Column('closed_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closing_amount', sa.Numeric(12, 2), nullable=True),
        sa.Column('expected_cash', sa.Numeric(12, 2), nullable=True),
        sa.Column('difference', sa.Numeric(12, 2), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['opened_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['closed_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_cash_register_sessions_tenant_id', 'cash_register_sessions', ['tenant_id'])
    op.create_index('ix_cash_register_sessions_branch_id', 'cash_register_sessions', ['branch_id'])
    op.create_index('ix_cash_register_sessions_status', 'cash_register_sessions', ['status'])
    op.create_index('ix_cash_register_sessions_opened_by', 'cash_register_sessions', ['opened_by'])
    op.create_index('ix_cash_register_sessions_opened_at', 'cash_register_sessions', ['opened_at'])

    op.add_column(
        'pos_transactions',
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_pos_transactions_session_id_cash_register_sessions',
        'pos_transactions', 'cash_register_sessions',
        ['session_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_pos_transactions_session_id', 'pos_transactions', ['session_id'])


def downgrade() -> None:
    op.drop_index('ix_pos_transactions_session_id', table_name='pos_transactions')
    op.drop_constraint(
        'fk_pos_transactions_session_id_cash_register_sessions',
        'pos_transactions', type_='foreignkey',
    )
    op.drop_column('pos_transactions', 'session_id')

    op.drop_index('ix_cash_register_sessions_opened_at', table_name='cash_register_sessions')
    op.drop_index('ix_cash_register_sessions_opened_by', table_name='cash_register_sessions')
    op.drop_index('ix_cash_register_sessions_status', table_name='cash_register_sessions')
    op.drop_index('ix_cash_register_sessions_branch_id', table_name='cash_register_sessions')
    op.drop_index('ix_cash_register_sessions_tenant_id', table_name='cash_register_sessions')
    op.drop_table('cash_register_sessions')

    postgresql.ENUM(name='cash_session_status_enum').drop(op.get_bind(), checkfirst=True)
