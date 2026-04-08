"""create saas plans table

Revision ID: 20260323_1000
Revises:
Create Date: 2026-03-23 10:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260323_1000"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


saas_plan_license_type_enum = postgresql.ENUM(
    "MONTHLY",
    "ANNUAL",
    "PERPETUAL",
    name="saas_plan_license_type_enum",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    saas_plan_license_type_enum.create(bind, checkfirst=True)

    if "saas_plans" not in inspector.get_table_names():
        op.create_table(
            "saas_plans",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("key", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("license_type", saas_plan_license_type_enum, nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("price", sa.Numeric(12, 2), nullable=False),
            sa.Column("billing_interval", sa.String(length=20), nullable=False),
            sa.Column("trial_days", sa.Integer(), nullable=False),
            sa.Column("max_members", sa.Integer(), nullable=False),
            sa.Column("max_branches", sa.Integer(), nullable=False),
            sa.Column("features", sa.Text(), nullable=True),
            sa.Column("stripe_price_id", sa.String(length=255), nullable=True),
            sa.Column("highlighted", sa.Boolean(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("is_public", sa.Boolean(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = {index["name"] for index in inspector.get_indexes("saas_plans")}
    index_name = op.f("ix_saas_plans_key")
    if index_name not in indexes:
        op.create_index(index_name, "saas_plans", ["key"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_saas_plans_key"), table_name="saas_plans")
    op.drop_table("saas_plans")

    bind = op.get_bind()
    saas_plan_license_type_enum.drop(bind, checkfirst=True)
