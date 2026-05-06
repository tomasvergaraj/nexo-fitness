"""add 2FA fields to users

Revision ID: 20260505_1500
Revises: 20260505_1000
Create Date: 2026-05-05 15:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision = "20260505_1500"
down_revision = "20260505_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "two_factor_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column("users", sa.Column("two_factor_secret", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("two_factor_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("backup_codes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "backup_codes")
    op.drop_column("users", "two_factor_verified_at")
    op.drop_column("users", "two_factor_secret")
    op.drop_column("users", "two_factor_enabled")
