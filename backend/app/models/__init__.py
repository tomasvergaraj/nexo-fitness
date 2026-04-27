"""Models package - import all models for Alembic discovery."""

from app.models.tenant import Tenant, TenantStatus, LicenseType
from app.models.platform import (
    SaaSPlan,
    PlatformLead,
    TenantPaymentProviderAccount,
    TuuTransaction,
    WebpayTransaction,
    PushSubscription,
    PushDelivery,
    PlatformPromoCode,
    PlatformBillingPayment,
)
from app.models.user import User, UserRole
from app.models.business import (
    Branch, Plan, PlanDuration, Membership, MembershipStatus,
    GymClass, ClassModality, ClassStatus,
    Reservation, ReservationStatus,
    CheckIn, CheckInInvestigationCase, Payment, PaymentStatus, PaymentMethod,
    Campaign, CampaignStatus, CampaignChannel,
    SupportInteraction, InteractionChannel,
    FeedbackSubmission, FeedbackCategory,
    AuditLog, Notification, TrainingProgram, TrainingProgramEnrollment,
)
from app.models.pos import (
    ProductCategory, Product, ProductUnit,
    Inventory, InventoryMovement, InventoryMovementType,
    Supplier, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus,
    POSTransaction, POSTransactionItem, POSTransactionStatus,
    Expense, ExpenseCategory,
)

__all__ = [
    "Tenant", "TenantStatus", "LicenseType",
    "SaaSPlan", "PlatformLead", "TenantPaymentProviderAccount", "TuuTransaction", "WebpayTransaction", "PushSubscription", "PushDelivery",
    "PlatformPromoCode", "PlatformBillingPayment",
    "User", "UserRole",
    "Branch", "Plan", "PlanDuration", "Membership", "MembershipStatus",
    "GymClass", "ClassModality", "ClassStatus",
    "Reservation", "ReservationStatus",
    "CheckIn", "CheckInInvestigationCase", "Payment", "PaymentStatus", "PaymentMethod",
    "Campaign", "CampaignStatus", "CampaignChannel",
    "SupportInteraction", "InteractionChannel",
    "FeedbackSubmission", "FeedbackCategory",
    "AuditLog", "Notification", "TrainingProgram", "TrainingProgramEnrollment",
    # POS
    "ProductCategory", "Product", "ProductUnit",
    "Inventory", "InventoryMovement", "InventoryMovementType",
    "Supplier", "PurchaseOrder", "PurchaseOrderItem", "PurchaseOrderStatus",
    "POSTransaction", "POSTransactionItem", "POSTransactionStatus",
    "Expense", "ExpenseCategory",
]
