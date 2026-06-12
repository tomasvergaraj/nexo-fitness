"""POS devolución parcial (Etapa 3)

Permite devolver ítems/cantidades sueltas de una venta. La venta queda
'completed' con refunded_amount parcial y pasa a 'refunded' solo cuando se
devuelve todo.

- pos_transactions.refunded_amount        → monto devuelto acumulado (prorratea descuento/gift card)
- pos_transaction_items.refunded_quantity → cantidad ya devuelta por ítem

Backfill: las devoluciones totales existentes (status='refunded') quedan con
refunded_amount = total y sus ítems con refunded_quantity = quantity, para que
el arqueo y la reportería sigan cuadrando con la nueva lógica basada en
refunded_amount.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-12 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('pos_transactions', sa.Column(
        'refunded_amount', sa.Numeric(12, 2), nullable=False, server_default='0'))
    op.add_column('pos_transaction_items', sa.Column(
        'refunded_quantity', sa.Integer(), nullable=False, server_default='0'))

    # Backfill devoluciones totales preexistentes.
    op.execute("UPDATE pos_transactions SET refunded_amount = total WHERE status = 'refunded'")
    op.execute(
        "UPDATE pos_transaction_items i SET refunded_quantity = i.quantity "
        "FROM pos_transactions t WHERE i.transaction_id = t.id AND t.status = 'refunded'"
    )


def downgrade() -> None:
    op.drop_column('pos_transaction_items', 'refunded_quantity')
    op.drop_column('pos_transactions', 'refunded_amount')
