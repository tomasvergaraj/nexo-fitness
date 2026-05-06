"""add is_trial to plans

Revision ID: 20260504_1200
Revises: 20260428_1300
Create Date: 2026-05-04 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision = "20260504_1200"
down_revision = "20260428_1300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plans",
        sa.Column("is_trial", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("plans", "is_trial")
