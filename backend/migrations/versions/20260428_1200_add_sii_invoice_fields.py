"""add sii invoice fields

Revision ID: 20260428_1200
Revises: 20260427_1000_cancellation_deadline_1h
Create Date: 2026-04-28 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision = "20260428_1200"
down_revision = "20260427_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Billing/SII fields on tenants
    op.add_column("tenants", sa.Column("tax_id", sa.String(20), nullable=True))
    op.add_column("tenants", sa.Column("legal_name", sa.String(200), nullable=True))
    op.add_column("tenants", sa.Column("business_activity", sa.String(500), nullable=True))
    op.add_column("tenants", sa.Column("billing_address", sa.String(500), nullable=True))
    op.add_column("tenants", sa.Column("billing_commune", sa.String(100), nullable=True))
    op.add_column("tenants", sa.Column("billing_city", sa.String(100), nullable=True))

    # SII DTE fields on platform_billing_payments
    op.add_column("platform_billing_payments", sa.Column("folio_number", sa.Integer(), nullable=True))
    op.add_column("platform_billing_payments", sa.Column("sii_track_id", sa.String(100), nullable=True))
    op.add_column("platform_billing_payments", sa.Column("invoice_status", sa.String(30), nullable=True))
    op.add_column("platform_billing_payments", sa.Column("invoice_xml", sa.Text(), nullable=True))
    op.add_column("platform_billing_payments", sa.Column("invoice_pdf_path", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_billing_payments", "invoice_pdf_path")
    op.drop_column("platform_billing_payments", "invoice_xml")
    op.drop_column("platform_billing_payments", "invoice_status")
    op.drop_column("platform_billing_payments", "sii_track_id")
    op.drop_column("platform_billing_payments", "folio_number")

    op.drop_column("tenants", "billing_city")
    op.drop_column("tenants", "billing_commune")
    op.drop_column("tenants", "billing_address")
    op.drop_column("tenants", "business_activity")
    op.drop_column("tenants", "legal_name")
    op.drop_column("tenants", "tax_id")
