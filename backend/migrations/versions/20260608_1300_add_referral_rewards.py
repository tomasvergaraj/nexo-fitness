"""add referral_rewards table

Fase 6.4b: recompensa automática al referrer cuando su referido completa el
primer pago. Una recompensa por referido (constraint único). Se aplica como
días gratis sobre la membresía vigente del referrer.

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-06-08 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'referral_rewards',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('referrer_user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('referred_user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('payment_id', UUID(as_uuid=True), sa.ForeignKey('payments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('applied_membership_id', UUID(as_uuid=True), sa.ForeignKey('memberships.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reward_days', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('tenant_id', 'referred_user_id', name='uq_referral_reward_per_referred'),
    )
    op.create_index('ix_referral_rewards_tenant_id', 'referral_rewards', ['tenant_id'])
    op.create_index('ix_referral_rewards_referrer_user_id', 'referral_rewards', ['referrer_user_id'])
    op.create_index('ix_referral_rewards_referred_user_id', 'referral_rewards', ['referred_user_id'])
    op.create_index('ix_referral_rewards_created_at', 'referral_rewards', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_referral_rewards_created_at', table_name='referral_rewards')
    op.drop_index('ix_referral_rewards_referred_user_id', table_name='referral_rewards')
    op.drop_index('ix_referral_rewards_referrer_user_id', table_name='referral_rewards')
    op.drop_index('ix_referral_rewards_tenant_id', table_name='referral_rewards')
    op.drop_table('referral_rewards')
