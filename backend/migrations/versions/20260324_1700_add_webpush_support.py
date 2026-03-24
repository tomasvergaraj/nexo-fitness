"""add webpush support to push subscriptions and deliveries

Revision ID: 20260324_1700
Revises: 20260324_1500
Create Date: 2026-03-24 17:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260324_1700"
down_revision: Union[str, None] = "20260324_1500"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "push_subscriptions" in tables:
        columns = {column["name"] for column in inspector.get_columns("push_subscriptions")}
        indexes = {index["name"] for index in inspector.get_indexes("push_subscriptions")}

        if "provider" not in columns:
            op.add_column("push_subscriptions", sa.Column("provider", sa.String(length=20), nullable=False, server_default="expo"))
        if "web_endpoint" not in columns:
            op.add_column("push_subscriptions", sa.Column("web_endpoint", sa.String(length=1000), nullable=True))
        if "web_p256dh_key" not in columns:
            op.add_column("push_subscriptions", sa.Column("web_p256dh_key", sa.String(length=255), nullable=True))
        if "web_auth_key" not in columns:
            op.add_column("push_subscriptions", sa.Column("web_auth_key", sa.String(length=255), nullable=True))
        if "user_agent" not in columns:
            op.add_column("push_subscriptions", sa.Column("user_agent", sa.String(length=500), nullable=True))

        op.alter_column(
            "push_subscriptions",
            "expo_push_token",
            existing_type=sa.String(length=255),
            nullable=True,
        )

        if "ix_push_subscriptions_provider" not in indexes:
            op.create_index("ix_push_subscriptions_provider", "push_subscriptions", ["provider"], unique=False)
        if "ix_push_subscriptions_web_endpoint" not in indexes:
            op.create_index("ix_push_subscriptions_web_endpoint", "push_subscriptions", ["web_endpoint"], unique=False)

    if "push_deliveries" in tables:
        columns = {column["name"] for column in inspector.get_columns("push_deliveries")}
        indexes = {index["name"] for index in inspector.get_indexes("push_deliveries")}

        if "provider" not in columns:
            op.add_column("push_deliveries", sa.Column("provider", sa.String(length=20), nullable=False, server_default="expo"))
        if "delivery_target" not in columns:
            op.add_column("push_deliveries", sa.Column("delivery_target", sa.String(length=1000), nullable=True))

        op.execute("UPDATE push_deliveries SET delivery_target = expo_push_token WHERE delivery_target IS NULL")

        op.alter_column(
            "push_deliveries",
            "delivery_target",
            existing_type=sa.String(length=1000),
            nullable=False,
        )
        op.alter_column(
            "push_deliveries",
            "expo_push_token",
            existing_type=sa.String(length=255),
            nullable=True,
        )

        if "ix_push_deliveries_provider" not in indexes:
            op.create_index("ix_push_deliveries_provider", "push_deliveries", ["provider"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "push_deliveries" in tables:
        indexes = {index["name"] for index in inspector.get_indexes("push_deliveries")}
        columns = {column["name"] for column in inspector.get_columns("push_deliveries")}

        if "expo_push_token" in columns:
            op.execute("UPDATE push_deliveries SET expo_push_token = delivery_target WHERE expo_push_token IS NULL")
            op.alter_column(
                "push_deliveries",
                "expo_push_token",
                existing_type=sa.String(length=255),
                nullable=False,
            )

        if "ix_push_deliveries_provider" in indexes:
            op.drop_index("ix_push_deliveries_provider", table_name="push_deliveries")
        if "delivery_target" in columns:
            op.drop_column("push_deliveries", "delivery_target")
        if "provider" in columns:
            op.drop_column("push_deliveries", "provider")

    if "push_subscriptions" in tables:
        indexes = {index["name"] for index in inspector.get_indexes("push_subscriptions")}
        columns = {column["name"] for column in inspector.get_columns("push_subscriptions")}

        if "expo_push_token" in columns:
            op.execute("UPDATE push_subscriptions SET expo_push_token = web_endpoint WHERE expo_push_token IS NULL")
            op.alter_column(
                "push_subscriptions",
                "expo_push_token",
                existing_type=sa.String(length=255),
                nullable=False,
            )

        if "ix_push_subscriptions_web_endpoint" in indexes:
            op.drop_index("ix_push_subscriptions_web_endpoint", table_name="push_subscriptions")
        if "ix_push_subscriptions_provider" in indexes:
            op.drop_index("ix_push_subscriptions_provider", table_name="push_subscriptions")

        for column_name in ["user_agent", "web_auth_key", "web_p256dh_key", "web_endpoint", "provider"]:
            if column_name in columns:
                op.drop_column("push_subscriptions", column_name)
