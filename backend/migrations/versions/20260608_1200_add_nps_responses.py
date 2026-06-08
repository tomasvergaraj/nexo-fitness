"""add nps_responses table

Encuesta NPS post-clase: tras asistir a una clase, la tarea Celery envía
un push ~24h después y el miembro responde 0-10 con comentario opcional.
Un check-in genera a lo sumo una respuesta (constraint único).

Revision ID: e9f0a1b2c3d4
Revises: d7e8f9a0b1c2
Create Date: 2026-06-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'e9f0a1b2c3d4'
down_revision: Union[str, None] = 'd7e8f9a0b1c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'nps_responses',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('checkin_id', UUID(as_uuid=True), sa.ForeignKey('checkins.id', ondelete='SET NULL'), nullable=True),
        sa.Column('gym_class_id', UUID(as_uuid=True), sa.ForeignKey('gym_classes.id', ondelete='SET NULL'), nullable=True),
        sa.Column('score', sa.Integer(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('tenant_id', 'checkin_id', name='uq_nps_response_per_checkin'),
    )
    op.create_index('ix_nps_responses_tenant_id', 'nps_responses', ['tenant_id'])
    op.create_index('ix_nps_responses_user_id', 'nps_responses', ['user_id'])
    op.create_index('ix_nps_responses_checkin_id', 'nps_responses', ['checkin_id'])
    op.create_index('ix_nps_responses_created_at', 'nps_responses', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_nps_responses_created_at', table_name='nps_responses')
    op.drop_index('ix_nps_responses_checkin_id', table_name='nps_responses')
    op.drop_index('ix_nps_responses_user_id', table_name='nps_responses')
    op.drop_index('ix_nps_responses_tenant_id', table_name='nps_responses')
    op.drop_table('nps_responses')
