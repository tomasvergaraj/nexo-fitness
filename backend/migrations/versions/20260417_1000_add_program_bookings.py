"""add program_bookings table

Revision ID: 20260417_1000
Revises: 20260416_2100
Create Date: 2026-04-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260417_1000'
down_revision = '20260416_2100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'program_bookings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('program_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('training_programs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('recurrence_group_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancel_reason', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('user_id', 'recurrence_group_id', name='uq_program_booking_user_group'),
    )
    op.create_index('ix_program_bookings_tenant_id', 'program_bookings', ['tenant_id'])
    op.create_index('ix_program_bookings_user_id', 'program_bookings', ['user_id'])
    op.create_index('ix_program_bookings_program_id', 'program_bookings', ['program_id'])
    op.create_index('ix_program_bookings_recurrence_group_id', 'program_bookings', ['recurrence_group_id'])
    op.create_index('ix_program_bookings_status', 'program_bookings', ['status'])


def downgrade() -> None:
    op.drop_index('ix_program_bookings_status', 'program_bookings')
    op.drop_index('ix_program_bookings_recurrence_group_id', 'program_bookings')
    op.drop_index('ix_program_bookings_program_id', 'program_bookings')
    op.drop_index('ix_program_bookings_user_id', 'program_bookings')
    op.drop_index('ix_program_bookings_tenant_id', 'program_bookings')
    op.drop_table('program_bookings')
