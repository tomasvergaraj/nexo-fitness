"""add restricted_plan_id to gym_classes

Revision ID: 20260416_2100
Revises: 20260415_1000_pos_system
Create Date: 2026-04-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260416_2100'
down_revision = '20260415_1000'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'gym_classes',
        sa.Column(
            'restricted_plan_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('plans.id', ondelete='SET NULL'),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column('gym_classes', 'restricted_plan_id')
