"""Models package - import all models for Alembic discovery."""

from app.models.tenant import Tenant, TenantStatus, LicenseType
from app.models.platform import SaaSPlan
from app.models.user import User, UserRole
from app.models.business import (
    Branch, Plan, PlanDuration, Membership, MembershipStatus,
    GymClass, ClassModality, ClassStatus,
    Reservation, ReservationStatus,
    CheckIn, Payment, PaymentStatus, PaymentMethod,
    Campaign, CampaignStatus, CampaignChannel,
    SupportInteraction, InteractionChannel,
    AuditLog, Notification, TrainingProgram,
)

__all__ = [
    "Tenant", "TenantStatus", "LicenseType",
    "SaaSPlan",
    "User", "UserRole",
    "Branch", "Plan", "PlanDuration", "Membership", "MembershipStatus",
    "GymClass", "ClassModality", "ClassStatus",
    "Reservation", "ReservationStatus",
    "CheckIn", "Payment", "PaymentStatus", "PaymentMethod",
    "Campaign", "CampaignStatus", "CampaignChannel",
    "SupportInteraction", "InteractionChannel",
    "AuditLog", "Notification", "TrainingProgram",
]
