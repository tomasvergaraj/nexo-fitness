"""add invoice_date to platform_billing_payments

Revision ID: 20260428_1300
Revises: 20260428_1200
Create Date: 2026-04-28 13:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision = "20260428_1300"
down_revision = "20260428_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("platform_billing_payments", sa.Column("invoice_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_billing_payments", "invoice_date")
