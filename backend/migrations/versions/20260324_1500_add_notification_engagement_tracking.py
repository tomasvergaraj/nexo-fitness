"""add notification engagement tracking

Revision ID: 20260324_1500
Revises: 20260324_1300
Create Date: 2026-03-24 15:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260324_1500"
down_revision: Union[str, None] = "20260324_1300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FOREIGN_KEY_NAME = "fk_notifications_campaign_id_campaigns"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "notifications" not in tables:
        return

    columns = {column["name"] for column in inspector.get_columns("notifications")}
    indexes = {index["name"] for index in inspector.get_indexes("notifications")}
    foreign_keys = {foreign_key["name"] for foreign_key in inspector.get_foreign_keys("notifications")}

    with op.batch_alter_table("notifications") as batch_op:
        if "campaign_id" not in columns:
            batch_op.add_column(sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=True))
        if "opened_at" not in columns:
            batch_op.add_column(sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True))
        if "clicked_at" not in columns:
            batch_op.add_column(sa.Column("clicked_at", sa.DateTime(timezone=True), nullable=True))
        if FOREIGN_KEY_NAME not in foreign_keys:
            batch_op.create_foreign_key(
                FOREIGN_KEY_NAME,
                "campaigns",
                ["campaign_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if "ix_notifications_campaign_id" not in indexes:
        op.create_index(op.f("ix_notifications_campaign_id"), "notifications", ["campaign_id"], unique=False)
    if "ix_notifications_opened_at" not in indexes:
        op.create_index(op.f("ix_notifications_opened_at"), "notifications", ["opened_at"], unique=False)
    if "ix_notifications_clicked_at" not in indexes:
        op.create_index(op.f("ix_notifications_clicked_at"), "notifications", ["clicked_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "notifications" not in tables:
        return

    indexes = {index["name"] for index in inspector.get_indexes("notifications")}
    foreign_keys = {foreign_key["name"] for foreign_key in inspector.get_foreign_keys("notifications")}
    columns = {column["name"] for column in inspector.get_columns("notifications")}

    if "ix_notifications_clicked_at" in indexes:
        op.drop_index(op.f("ix_notifications_clicked_at"), table_name="notifications")
    if "ix_notifications_opened_at" in indexes:
        op.drop_index(op.f("ix_notifications_opened_at"), table_name="notifications")
    if "ix_notifications_campaign_id" in indexes:
        op.drop_index(op.f("ix_notifications_campaign_id"), table_name="notifications")

    with op.batch_alter_table("notifications") as batch_op:
        if FOREIGN_KEY_NAME in foreign_keys:
            batch_op.drop_constraint(FOREIGN_KEY_NAME, type_="foreignkey")
        if "clicked_at" in columns:
            batch_op.drop_column("clicked_at")
        if "opened_at" in columns:
            batch_op.drop_column("opened_at")
        if "campaign_id" in columns:
            batch_op.drop_column("campaign_id")
