"""add gift cards (Fase 6.6)

Tarjetas de regalo con saldo, emitidas manualmente por el staff y redimibles
parcialmente en POS o en venta de plan. Agrega gift_cards, gift_card_redemptions
y la columna gift_card_amount en pos_transactions.

Revision ID: a1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-06-08 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'gift_cards',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code', sa.String(length=24), nullable=False),
        sa.Column('initial_amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('balance', sa.Numeric(12, 2), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False, server_default='CLP'),
        sa.Column('recipient_email', sa.String(length=255), nullable=True),
        sa.Column('recipient_name', sa.String(length=255), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('issued_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('code', name='uq_gift_card_code'),
    )
    op.create_index('ix_gift_cards_tenant_id', 'gift_cards', ['tenant_id'])
    op.create_index('ix_gift_cards_code', 'gift_cards', ['code'])
    op.create_index('ix_gift_cards_status', 'gift_cards', ['status'])
    op.create_index('ix_gift_cards_created_at', 'gift_cards', ['created_at'])

    op.create_table(
        'gift_card_redemptions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('gift_card_id', UUID(as_uuid=True), sa.ForeignKey('gift_cards.id', ondelete='CASCADE'), nullable=False),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('context', sa.String(length=20), nullable=False),
        sa.Column('payment_id', UUID(as_uuid=True), sa.ForeignKey('payments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('pos_transaction_id', UUID(as_uuid=True), sa.ForeignKey('pos_transactions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('redeemed_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_gift_card_redemptions_tenant_id', 'gift_card_redemptions', ['tenant_id'])
    op.create_index('ix_gift_card_redemptions_gift_card_id', 'gift_card_redemptions', ['gift_card_id'])
    op.create_index('ix_gift_card_redemptions_created_at', 'gift_card_redemptions', ['created_at'])

    op.add_column(
        'pos_transactions',
        sa.Column('gift_card_amount', sa.Numeric(12, 2), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('pos_transactions', 'gift_card_amount')
    op.drop_index('ix_gift_card_redemptions_created_at', table_name='gift_card_redemptions')
    op.drop_index('ix_gift_card_redemptions_gift_card_id', table_name='gift_card_redemptions')
    op.drop_index('ix_gift_card_redemptions_tenant_id', table_name='gift_card_redemptions')
    op.drop_table('gift_card_redemptions')
    op.drop_index('ix_gift_cards_created_at', table_name='gift_cards')
    op.drop_index('ix_gift_cards_status', table_name='gift_cards')
    op.drop_index('ix_gift_cards_code', table_name='gift_cards')
    op.drop_index('ix_gift_cards_tenant_id', table_name='gift_cards')
    op.drop_table('gift_cards')
