"""POS fiados — cuenta corriente de socios (Etapa 2)

Libro de cuenta corriente por socio: cargos (ventas a crédito) y abonos
(pagos de deuda). El saldo se computa sumando cargos − abonos; NO se guarda
un balance en User.

- pos_transactions.client_id          → socio al que se fió la venta
- client_account_entries              → libro mayor de la cuenta (charge/payment)
- cash_register_sessions.cash_credit_payments → snapshot: abonos en efectivo del turno

Una venta a crédito genera un entry 'charge'; un abono en efectivo enlaza la
sesión de caja (session_id) para entrar al arqueo. Todas las columnas son
aditivas y nullable; sin backfill.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pos_transactions → socio de la venta a crédito
    op.add_column('pos_transactions', sa.Column('client_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_pos_transactions_client', 'pos_transactions', 'users',
        ['client_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_pos_transactions_client_id', 'pos_transactions', ['client_id'])

    # client_account_entries → libro de cuenta corriente
    op.create_table(
        'client_account_entries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False),
        sa.Column('branch_id', UUID(as_uuid=True), nullable=True),
        sa.Column('client_id', UUID(as_uuid=True), nullable=False),
        sa.Column('kind', sa.String(10), nullable=False),                 # 'charge' | 'payment'
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),           # siempre positivo
        sa.Column('payment_method', sa.String(20), nullable=True),        # solo abonos
        sa.Column('pos_transaction_id', UUID(as_uuid=True), nullable=True),
        sa.Column('session_id', UUID(as_uuid=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['client_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pos_transaction_id'], ['pos_transactions.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['session_id'], ['cash_register_sessions.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_client_account_entries_tenant_id', 'client_account_entries', ['tenant_id'])
    op.create_index('ix_client_account_entries_client_id', 'client_account_entries', ['client_id'])
    op.create_index('ix_client_account_entries_session_id', 'client_account_entries', ['session_id'])

    # cash_register_sessions → snapshot de abonos en efectivo del turno
    op.add_column('cash_register_sessions', sa.Column('cash_credit_payments', sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('cash_register_sessions', 'cash_credit_payments')

    op.drop_index('ix_client_account_entries_session_id', table_name='client_account_entries')
    op.drop_index('ix_client_account_entries_client_id', table_name='client_account_entries')
    op.drop_index('ix_client_account_entries_tenant_id', table_name='client_account_entries')
    op.drop_table('client_account_entries')

    op.drop_index('ix_pos_transactions_client_id', table_name='pos_transactions')
    op.drop_constraint('fk_pos_transactions_client', 'pos_transactions', type_='foreignkey')
    op.drop_column('pos_transactions', 'client_id')
