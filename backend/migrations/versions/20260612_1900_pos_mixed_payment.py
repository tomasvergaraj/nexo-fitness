"""POS pago mixto (Etapa 3b)

Una venta puede pagarse con varios métodos (ej. parte efectivo, parte tarjeta).
La transacción queda con payment_method='mixed' y el desglose vive en
pos_transaction_payments. Las ventas de un solo método NO generan filas aquí
(siguen representadas por payment_method + total en la propia transacción).

Sin backfill: las ventas existentes son de un método y se agregan por
pos_transactions.payment_method como hasta ahora.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-12 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'pos_transaction_payments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('transaction_id', UUID(as_uuid=True), nullable=False),
        sa.Column('method', sa.String(20), nullable=False),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(['transaction_id'], ['pos_transactions.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_pos_transaction_payments_transaction_id', 'pos_transaction_payments', ['transaction_id'])


def downgrade() -> None:
    op.drop_index('ix_pos_transaction_payments_transaction_id', table_name='pos_transaction_payments')
    op.drop_table('pos_transaction_payments')
