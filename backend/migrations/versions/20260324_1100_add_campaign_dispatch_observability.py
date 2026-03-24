"""add campaign dispatch observability

Revision ID: 20260324_1100
Revises: 20260324_0900
Create Date: 2026-03-24 11:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260324_1100"
down_revision: Union[str, None] = "20260324_0900"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "campaigns" not in tables:
        return

    columns = {column["name"] for column in inspector.get_columns("campaigns")}

    if "last_dispatch_trigger" not in columns:
        op.add_column("campaigns", sa.Column("last_dispatch_trigger", sa.String(length=20), nullable=True))

    if "last_dispatch_attempted_at" not in columns:
        op.add_column("campaigns", sa.Column("last_dispatch_attempted_at", sa.DateTime(timezone=True), nullable=True))

    if "last_dispatch_finished_at" not in columns:
        op.add_column("campaigns", sa.Column("last_dispatch_finished_at", sa.DateTime(timezone=True), nullable=True))

    if "last_dispatch_error" not in columns:
        op.add_column("campaigns", sa.Column("last_dispatch_error", sa.Text(), nullable=True))

    if "dispatch_attempts" not in columns:
        op.add_column(
            "campaigns",
            sa.Column("dispatch_attempts", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "campaigns" not in tables:
        return

    columns = {column["name"] for column in inspector.get_columns("campaigns")}

    if "dispatch_attempts" in columns:
        op.drop_column("campaigns", "dispatch_attempts")

    if "last_dispatch_error" in columns:
        op.drop_column("campaigns", "last_dispatch_error")

    if "last_dispatch_finished_at" in columns:
        op.drop_column("campaigns", "last_dispatch_finished_at")

    if "last_dispatch_attempted_at" in columns:
        op.drop_column("campaigns", "last_dispatch_attempted_at")

    if "last_dispatch_trigger" in columns:
        op.drop_column("campaigns", "last_dispatch_trigger")
