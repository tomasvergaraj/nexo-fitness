"""add reservation_closes_minutes_before to gym_classes

Revision ID: 20260505_1000
Revises: 20260504_1200
Create Date: 2026-05-05 10:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision = "20260505_1000"
down_revision = "20260504_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "gym_classes",
        sa.Column(
            "reservation_closes_minutes_before",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("gym_classes", "reservation_closes_minutes_before")
