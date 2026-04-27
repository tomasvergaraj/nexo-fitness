"""add checkin investigation cases

Revision ID: 20260422_1000
Revises: 20260421_1000
Create Date: 2026-04-22 00:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260422_1000"
down_revision: Union[str, None] = "20260421_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "checkin_investigation_cases",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "trigger_checkin_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("checkins.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'open'")),
        sa.Column("rule_code", sa.String(length=50), nullable=False, server_default=sa.text("'qr_frequency'")),
        sa.Column("local_day", sa.Date(), nullable=False),
        sa.Column("first_triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("daily_qr_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("window_qr_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "tenant_id",
            "user_id",
            "local_day",
            "rule_code",
            name="uq_checkin_investigation_case_per_rule_day",
        ),
    )
    op.create_index(
        "ix_checkin_investigation_cases_tenant_id",
        "checkin_investigation_cases",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        "ix_checkin_investigation_cases_user_id",
        "checkin_investigation_cases",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_checkin_investigation_cases_trigger_checkin_id",
        "checkin_investigation_cases",
        ["trigger_checkin_id"],
        unique=False,
    )
    op.create_index(
        "ix_checkin_investigation_cases_status",
        "checkin_investigation_cases",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_checkin_investigation_cases_rule_code",
        "checkin_investigation_cases",
        ["rule_code"],
        unique=False,
    )
    op.create_index(
        "ix_checkin_investigation_cases_local_day",
        "checkin_investigation_cases",
        ["local_day"],
        unique=False,
    )
    op.create_index(
        "ix_checkin_investigation_cases_reviewed_by",
        "checkin_investigation_cases",
        ["reviewed_by"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_checkin_investigation_cases_reviewed_by", table_name="checkin_investigation_cases")
    op.drop_index("ix_checkin_investigation_cases_local_day", table_name="checkin_investigation_cases")
    op.drop_index("ix_checkin_investigation_cases_rule_code", table_name="checkin_investigation_cases")
    op.drop_index("ix_checkin_investigation_cases_status", table_name="checkin_investigation_cases")
    op.drop_index("ix_checkin_investigation_cases_trigger_checkin_id", table_name="checkin_investigation_cases")
    op.drop_index("ix_checkin_investigation_cases_user_id", table_name="checkin_investigation_cases")
    op.drop_index("ix_checkin_investigation_cases_tenant_id", table_name="checkin_investigation_cases")
    op.drop_table("checkin_investigation_cases")
