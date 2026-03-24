"""add campaign delivery fields

Revision ID: 20260324_0900
Revises: 20260323_1400
Create Date: 2026-03-24 09:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260324_0900"
down_revision: Union[str, None] = "20260323_1400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "campaigns" not in tables:
        return

    columns = {column["name"] for column in inspector.get_columns("campaigns")}

    if "notification_type" not in columns:
        op.add_column(
            "campaigns",
            sa.Column("notification_type", sa.String(length=50), nullable=False, server_default="info"),
        )

    if "action_url" not in columns:
        op.add_column("campaigns", sa.Column("action_url", sa.String(length=500), nullable=True))

    if "send_push" not in columns:
        op.add_column(
            "campaigns",
            sa.Column("send_push", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "campaigns" not in tables:
        return

    columns = {column["name"] for column in inspector.get_columns("campaigns")}

    if "send_push" in columns:
        op.drop_column("campaigns", "send_push")

    if "action_url" in columns:
        op.drop_column("campaigns", "action_url")

    if "notification_type" in columns:
        op.drop_column("campaigns", "notification_type")
