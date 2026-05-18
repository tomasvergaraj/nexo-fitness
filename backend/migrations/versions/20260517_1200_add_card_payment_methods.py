"""add debit_card and credit_card to payment_method_enum

Revision ID: 20260517_1200
Revises: 20260506_1400
Create Date: 2026-05-17 12:00:00.000000

"""

from alembic import op


revision = "20260517_1200"
down_revision = "20260506_1400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'DEBIT_CARD'")
    op.execute("ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'CREDIT_CARD'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values directly.
    # A downgrade would require recreating the enum and updating all referencing columns.
    pass
