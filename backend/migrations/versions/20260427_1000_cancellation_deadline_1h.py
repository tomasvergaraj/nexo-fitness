"""change cancellation_deadline_hours default to 1

Revision ID: 20260427_1000
Revises: a3e98d968907
Create Date: 2026-04-27 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = '20260427_1000'
down_revision = 'a3e98d968907'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        'gym_classes',
        'cancellation_deadline_hours',
        existing_type=sa.Integer(),
        server_default='1',
        existing_nullable=False,
    )
    op.execute(
        "UPDATE gym_classes SET cancellation_deadline_hours = 1 WHERE cancellation_deadline_hours = 2"
    )


def downgrade() -> None:
    op.alter_column(
        'gym_classes',
        'cancellation_deadline_hours',
        existing_type=sa.Integer(),
        server_default='2',
        existing_nullable=False,
    )
    op.execute(
        "UPDATE gym_classes SET cancellation_deadline_hours = 2 WHERE cancellation_deadline_hours = 1"
    )
