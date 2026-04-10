"""create core multitenant schema

Revision ID: 20260322_1200
Revises:
Create Date: 2026-03-22 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260322_1200"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


license_type_enum = postgresql.ENUM(
    "MONTHLY",
    "ANNUAL",
    "PERPETUAL",
    name="license_type_enum",
    create_type=False,
)
tenant_status_enum = postgresql.ENUM(
    "ACTIVE",
    "SUSPENDED",
    "TRIAL",
    "EXPIRED",
    "CANCELLED",
    name="tenant_status_enum",
    create_type=False,
)
user_role_enum = postgresql.ENUM(
    "SUPERADMIN",
    "OWNER",
    "ADMIN",
    "RECEPTION",
    "TRAINER",
    "MARKETING",
    "CLIENT",
    name="user_role_enum",
    create_type=False,
)
plan_duration_enum = postgresql.ENUM(
    "MONTHLY",
    "ANNUAL",
    "PERPETUAL",
    "CUSTOM",
    name="plan_duration_enum",
    create_type=False,
)
membership_status_enum = postgresql.ENUM(
    "ACTIVE",
    "EXPIRED",
    "CANCELLED",
    "FROZEN",
    "PENDING",
    name="membership_status_enum",
    create_type=False,
)
class_modality_enum = postgresql.ENUM(
    "IN_PERSON",
    "ONLINE",
    "HYBRID",
    name="class_modality_enum",
    create_type=False,
)
class_status_enum = postgresql.ENUM(
    "SCHEDULED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
    name="class_status_enum",
    create_type=False,
)
reservation_status_enum = postgresql.ENUM(
    "CONFIRMED",
    "WAITLISTED",
    "CANCELLED",
    "NO_SHOW",
    "ATTENDED",
    name="reservation_status_enum",
    create_type=False,
)
payment_status_enum = postgresql.ENUM(
    "PENDING",
    "COMPLETED",
    "FAILED",
    "REFUNDED",
    "CANCELLED",
    name="payment_status_enum",
    create_type=False,
)
payment_method_enum = postgresql.ENUM(
    "STRIPE",
    "MERCADOPAGO",
    "CASH",
    "TRANSFER",
    "OTHER",
    name="payment_method_enum",
    create_type=False,
)
campaign_status_enum = postgresql.ENUM(
    "DRAFT",
    "SCHEDULED",
    "SENDING",
    "SENT",
    "CANCELLED",
    name="campaign_status_enum",
    create_type=False,
)
campaign_channel_enum = postgresql.ENUM(
    "EMAIL",
    "WHATSAPP",
    "SMS",
    name="campaign_channel_enum",
    create_type=False,
)
interaction_channel_enum = postgresql.ENUM(
    "WHATSAPP",
    "EMAIL",
    "PHONE",
    "IN_PERSON",
    name="interaction_channel_enum",
    create_type=False,
)

ENUMS = [
    license_type_enum,
    tenant_status_enum,
    user_role_enum,
    plan_duration_enum,
    membership_status_enum,
    class_modality_enum,
    class_status_enum,
    reservation_status_enum,
    payment_status_enum,
    payment_method_enum,
    campaign_status_enum,
    campaign_channel_enum,
    interaction_channel_enum,
]


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _index_names(bind, table_name: str) -> set[str]:
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_if_missing(bind, table_name: str, index_name: str, columns: list[str], *, unique: bool = False) -> None:
    if index_name not in _index_names(bind, table_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def _drop_index_if_exists(bind, table_name: str, index_name: str) -> None:
    if index_name in _index_names(bind, table_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    bind = op.get_bind()

    for enum_type in ENUMS:
        enum_type.create(bind, checkfirst=True)

    tables = _table_names(bind)

    if "tenants" not in tables:
        op.create_table(
            "tenants",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("slug", sa.String(length=100), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("phone", sa.String(length=50), nullable=True),
            sa.Column("address", sa.Text(), nullable=True),
            sa.Column("city", sa.String(length=100), nullable=True),
            sa.Column("country", sa.String(length=100), nullable=True),
            sa.Column("timezone", sa.String(length=50), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("license_type", license_type_enum, nullable=False),
            sa.Column("status", tenant_status_enum, nullable=False),
            sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("license_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("logo_url", sa.String(length=500), nullable=True),
            sa.Column("primary_color", sa.String(length=7), nullable=True),
            sa.Column("custom_domain", sa.String(length=255), nullable=True),
            sa.Column("features", sa.Text(), nullable=True),
            sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
            sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("max_members", sa.Integer(), nullable=True),
            sa.Column("max_branches", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    if "users" not in tables:
        op.create_table(
            "users",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("hashed_password", sa.String(length=255), nullable=False),
            sa.Column("first_name", sa.String(length=100), nullable=False),
            sa.Column("last_name", sa.String(length=100), nullable=False),
            sa.Column("phone", sa.String(length=50), nullable=True),
            sa.Column("avatar_url", sa.String(length=500), nullable=True),
            sa.Column("role", user_role_enum, nullable=False),
            sa.Column("is_superadmin", sa.Boolean(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("is_verified", sa.Boolean(), nullable=False),
            sa.Column("date_of_birth", sa.DateTime(), nullable=True),
            sa.Column("gender", sa.String(length=20), nullable=True),
            sa.Column("emergency_contact", sa.String(length=255), nullable=True),
            sa.Column("emergency_phone", sa.String(length=50), nullable=True),
            sa.Column("medical_notes", sa.Text(), nullable=True),
            sa.Column("tags", sa.Text(), nullable=True),
            sa.Column("internal_notes", sa.Text(), nullable=True),
            sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("refresh_token", sa.String(length=500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "branches" not in tables:
        op.create_table(
            "branches",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("address", sa.Text(), nullable=True),
            sa.Column("city", sa.String(length=100), nullable=True),
            sa.Column("phone", sa.String(length=50), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("opening_time", sa.Time(), nullable=True),
            sa.Column("closing_time", sa.Time(), nullable=True),
            sa.Column("capacity", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "plans" not in tables:
        op.create_table(
            "plans",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("price", sa.Numeric(12, 2), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("duration_type", plan_duration_enum, nullable=False),
            sa.Column("duration_days", sa.Integer(), nullable=True),
            sa.Column("max_reservations_per_week", sa.Integer(), nullable=True),
            sa.Column("max_reservations_per_month", sa.Integer(), nullable=True),
            sa.Column("allowed_class_types", sa.Text(), nullable=True),
            sa.Column("allowed_branches", sa.Text(), nullable=True),
            sa.Column("benefits", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("is_featured", sa.Boolean(), nullable=False),
            sa.Column("auto_renew", sa.Boolean(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("stripe_price_id", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "memberships" not in tables:
        op.create_table(
            "memberships",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("status", membership_status_enum, nullable=False),
            sa.Column("starts_at", sa.Date(), nullable=False),
            sa.Column("expires_at", sa.Date(), nullable=True),
            sa.Column("auto_renew", sa.Boolean(), nullable=False),
            sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("frozen_until", sa.Date(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "gym_classes" not in tables:
        op.create_table(
            "gym_classes",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("branch_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("class_type", sa.String(length=100), nullable=True),
            sa.Column("modality", class_modality_enum, nullable=False),
            sa.Column("status", class_status_enum, nullable=False),
            sa.Column("instructor_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("max_capacity", sa.Integer(), nullable=False),
            sa.Column("current_bookings", sa.Integer(), nullable=False),
            sa.Column("waitlist_enabled", sa.Boolean(), nullable=False),
            sa.Column("online_link", sa.String(length=500), nullable=True),
            sa.Column("cancellation_deadline_hours", sa.Integer(), nullable=False),
            sa.Column("is_recurring", sa.Boolean(), nullable=False),
            sa.Column("recurrence_rule", sa.String(length=255), nullable=True),
            sa.Column("color", sa.String(length=7), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
            sa.ForeignKeyConstraint(["instructor_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "reservations" not in tables:
        op.create_table(
            "reservations",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("gym_class_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("status", reservation_status_enum, nullable=False),
            sa.Column("waitlist_position", sa.Integer(), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("attended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["gym_class_id"], ["gym_classes.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "gym_class_id", name="uq_user_class_reservation"),
        )

    if "checkins" not in tables:
        op.create_table(
            "checkins",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("gym_class_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("branch_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("check_type", sa.String(length=20), nullable=False),
            sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("checked_in_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
            sa.ForeignKeyConstraint(["checked_in_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["gym_class_id"], ["gym_classes.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "payments" not in tables:
        op.create_table(
            "payments",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("membership_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("status", payment_status_enum, nullable=False),
            sa.Column("method", payment_method_enum, nullable=False),
            sa.Column("description", sa.String(length=500), nullable=True),
            sa.Column("external_id", sa.String(length=255), nullable=True),
            sa.Column("receipt_url", sa.String(length=500), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["membership_id"], ["memberships.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "campaigns" not in tables:
        op.create_table(
            "campaigns",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("subject", sa.String(length=500), nullable=True),
            sa.Column("content", sa.Text(), nullable=True),
            sa.Column("channel", campaign_channel_enum, nullable=False),
            sa.Column("status", campaign_status_enum, nullable=False),
            sa.Column("segment_filter", sa.Text(), nullable=True),
            sa.Column("template_id", sa.String(length=100), nullable=True),
            sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("total_recipients", sa.Integer(), nullable=False),
            sa.Column("total_sent", sa.Integer(), nullable=False),
            sa.Column("total_opened", sa.Integer(), nullable=False),
            sa.Column("total_clicked", sa.Integer(), nullable=False),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "support_interactions" not in tables:
        op.create_table(
            "support_interactions",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("channel", interaction_channel_enum, nullable=False),
            sa.Column("subject", sa.String(length=300), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("resolved", sa.Boolean(), nullable=False),
            sa.Column("handled_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["handled_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "audit_logs" not in tables:
        op.create_table(
            "audit_logs",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("action", sa.String(length=100), nullable=False),
            sa.Column("entity_type", sa.String(length=50), nullable=True),
            sa.Column("entity_id", sa.String(length=50), nullable=True),
            sa.Column("details", sa.Text(), nullable=True),
            sa.Column("ip_address", sa.String(length=45), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "notifications" not in tables:
        op.create_table(
            "notifications",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("title", sa.String(length=300), nullable=False),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("type", sa.String(length=50), nullable=False),
            sa.Column("is_read", sa.Boolean(), nullable=False),
            sa.Column("action_url", sa.String(length=500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "training_programs" not in tables:
        op.create_table(
            "training_programs",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("trainer_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("program_type", sa.String(length=100), nullable=True),
            sa.Column("duration_weeks", sa.Integer(), nullable=True),
            sa.Column("schedule_json", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["trainer_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    bind = op.get_bind()
    _create_index_if_missing(bind, "tenants", op.f("ix_tenants_slug"), ["slug"], unique=True)
    _create_index_if_missing(bind, "users", op.f("ix_users_email"), ["email"], unique=True)
    _create_index_if_missing(bind, "users", op.f("ix_users_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "branches", op.f("ix_branches_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "plans", op.f("ix_plans_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "memberships", op.f("ix_memberships_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "memberships", op.f("ix_memberships_user_id"), ["user_id"])
    _create_index_if_missing(bind, "memberships", op.f("ix_memberships_plan_id"), ["plan_id"])
    _create_index_if_missing(bind, "gym_classes", op.f("ix_gym_classes_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "gym_classes", op.f("ix_gym_classes_branch_id"), ["branch_id"])
    _create_index_if_missing(bind, "gym_classes", op.f("ix_gym_classes_start_time"), ["start_time"])
    _create_index_if_missing(bind, "reservations", op.f("ix_reservations_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "reservations", op.f("ix_reservations_user_id"), ["user_id"])
    _create_index_if_missing(bind, "reservations", op.f("ix_reservations_gym_class_id"), ["gym_class_id"])
    _create_index_if_missing(bind, "checkins", op.f("ix_checkins_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "checkins", op.f("ix_checkins_user_id"), ["user_id"])
    _create_index_if_missing(bind, "payments", op.f("ix_payments_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "payments", op.f("ix_payments_user_id"), ["user_id"])
    _create_index_if_missing(bind, "campaigns", op.f("ix_campaigns_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "support_interactions", op.f("ix_support_interactions_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "audit_logs", op.f("ix_audit_logs_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "notifications", op.f("ix_notifications_tenant_id"), ["tenant_id"])
    _create_index_if_missing(bind, "notifications", op.f("ix_notifications_user_id"), ["user_id"])
    _create_index_if_missing(bind, "training_programs", op.f("ix_training_programs_tenant_id"), ["tenant_id"])


def downgrade() -> None:
    bind = op.get_bind()

    _drop_index_if_exists(bind, "training_programs", op.f("ix_training_programs_tenant_id"))
    _drop_index_if_exists(bind, "notifications", op.f("ix_notifications_user_id"))
    _drop_index_if_exists(bind, "notifications", op.f("ix_notifications_tenant_id"))
    _drop_index_if_exists(bind, "audit_logs", op.f("ix_audit_logs_tenant_id"))
    _drop_index_if_exists(bind, "support_interactions", op.f("ix_support_interactions_tenant_id"))
    _drop_index_if_exists(bind, "campaigns", op.f("ix_campaigns_tenant_id"))
    _drop_index_if_exists(bind, "payments", op.f("ix_payments_user_id"))
    _drop_index_if_exists(bind, "payments", op.f("ix_payments_tenant_id"))
    _drop_index_if_exists(bind, "checkins", op.f("ix_checkins_user_id"))
    _drop_index_if_exists(bind, "checkins", op.f("ix_checkins_tenant_id"))
    _drop_index_if_exists(bind, "reservations", op.f("ix_reservations_gym_class_id"))
    _drop_index_if_exists(bind, "reservations", op.f("ix_reservations_user_id"))
    _drop_index_if_exists(bind, "reservations", op.f("ix_reservations_tenant_id"))
    _drop_index_if_exists(bind, "gym_classes", op.f("ix_gym_classes_start_time"))
    _drop_index_if_exists(bind, "gym_classes", op.f("ix_gym_classes_branch_id"))
    _drop_index_if_exists(bind, "gym_classes", op.f("ix_gym_classes_tenant_id"))
    _drop_index_if_exists(bind, "memberships", op.f("ix_memberships_plan_id"))
    _drop_index_if_exists(bind, "memberships", op.f("ix_memberships_user_id"))
    _drop_index_if_exists(bind, "memberships", op.f("ix_memberships_tenant_id"))
    _drop_index_if_exists(bind, "plans", op.f("ix_plans_tenant_id"))
    _drop_index_if_exists(bind, "branches", op.f("ix_branches_tenant_id"))
    _drop_index_if_exists(bind, "users", op.f("ix_users_tenant_id"))
    _drop_index_if_exists(bind, "users", op.f("ix_users_email"))
    _drop_index_if_exists(bind, "tenants", op.f("ix_tenants_slug"))

    tables = _table_names(bind)
    for table_name in [
        "training_programs",
        "notifications",
        "audit_logs",
        "support_interactions",
        "campaigns",
        "payments",
        "checkins",
        "reservations",
        "gym_classes",
        "memberships",
        "plans",
        "branches",
        "users",
        "tenants",
    ]:
        if table_name in tables:
            op.drop_table(table_name)

    for enum_type in reversed(ENUMS):
        enum_type.drop(bind, checkfirst=True)
