"""add membership period history and payment snapshots

Revision ID: 20260422_2200
Revises: 20260422_2100
Create Date: 2026-04-22 22:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260422_2200"
down_revision: Union[str, None] = "20260422_2100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("previous_membership_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "memberships",
        sa.Column("sale_source", sa.String(length=30), nullable=True),
    )
    op.create_index(
        "ix_memberships_previous_membership_id",
        "memberships",
        ["previous_membership_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_memberships_previous_membership_id",
        "memberships",
        "memberships",
        ["previous_membership_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "payments",
        sa.Column("plan_id_snapshot", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("plan_name_snapshot", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("membership_starts_at_snapshot", sa.Date(), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("membership_expires_at_snapshot", sa.Date(), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("membership_status_snapshot", sa.String(length=20), nullable=True),
    )
    op.create_index(
        "ix_payments_plan_id_snapshot",
        "payments",
        ["plan_id_snapshot"],
        unique=False,
    )

    op.execute(
        """
        UPDATE payments AS p
        SET
            plan_id_snapshot = m.plan_id,
            plan_name_snapshot = pl.name,
            membership_starts_at_snapshot = m.starts_at,
            membership_expires_at_snapshot = m.expires_at,
            membership_status_snapshot = CAST(m.status AS TEXT)
        FROM memberships AS m
        LEFT JOIN plans AS pl ON pl.id = m.plan_id
        WHERE p.membership_id = m.id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_payments_plan_id_snapshot", table_name="payments")
    op.drop_column("payments", "membership_status_snapshot")
    op.drop_column("payments", "membership_expires_at_snapshot")
    op.drop_column("payments", "membership_starts_at_snapshot")
    op.drop_column("payments", "plan_name_snapshot")
    op.drop_column("payments", "plan_id_snapshot")

    op.drop_constraint("fk_memberships_previous_membership_id", "memberships", type_="foreignkey")
    op.drop_index("ix_memberships_previous_membership_id", table_name="memberships")
    op.drop_column("memberships", "sale_source")
    op.drop_column("memberships", "previous_membership_id")
