"""Cross-cutting schemas for public commerce, tenant operations, and mobile."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator


class MembershipCreateRequest(BaseModel):
    user_id: UUID
    plan_id: UUID
    starts_at: date
    expires_at: Optional[date] = None
    status: str = Field(default="active", pattern=r"^(active|expired|cancelled|frozen|pending)$")
    auto_renew: bool = True


class MembershipUpdateRequest(BaseModel):
    status: Optional[str] = Field(default=None, pattern=r"^(active|expired|cancelled|frozen|pending)$")
    starts_at: Optional[date] = None
    expires_at: Optional[date] = None
    auto_renew: Optional[bool] = None
    frozen_until: Optional[date] = None


class MembershipResponse(BaseModel):
    id: UUID
    user_id: UUID
    plan_id: UUID
    status: str
    starts_at: date
    expires_at: Optional[date] = None
    auto_renew: bool
    frozen_until: Optional[date] = None
    stripe_subscription_id: Optional[str] = None
    created_at: datetime
    user_name: Optional[str] = None
    plan_name: Optional[str] = None

    model_config = {"from_attributes": True}


class CampaignUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    subject: Optional[str] = None
    content: Optional[str] = None
    channel: Optional[str] = Field(default=None, pattern=r"^(email|whatsapp|sms)$")
    status: Optional[str] = Field(default=None, pattern=r"^(draft|scheduled|sending|sent|cancelled)$")
    segment_filter: Optional[dict[str, Any]] = None
    notification_type: Optional[str] = Field(default=None, pattern=r"^(info|warning|success|error)$")
    action_url: Optional[str] = Field(default=None, max_length=500)
    send_push: Optional[bool] = None
    scheduled_at: Optional[datetime] = None
    total_recipients: Optional[int] = Field(default=None, ge=0)
    total_sent: Optional[int] = Field(default=None, ge=0)
    total_opened: Optional[int] = Field(default=None, ge=0)
    total_clicked: Optional[int] = Field(default=None, ge=0)


class CampaignOverviewResponse(BaseModel):
    total_campaigns: int = 0
    scheduled_pending: int = 0
    sending_now: int = 0
    sent_total: int = 0
    opened_total: int = 0
    clicked_total: int = 0
    manual_runs: int = 0
    scheduler_runs: int = 0
    scheduler_failures: int = 0
    pending_push_receipts: int = 0
    failed_push_receipts: int = 0
    open_rate: float = 0
    click_rate: float = 0


class SupportInteractionCreateRequest(BaseModel):
    user_id: Optional[UUID] = None
    channel: str = Field(pattern=r"^(whatsapp|email|phone|in_person)$")
    subject: str = Field(min_length=1, max_length=300)
    notes: Optional[str] = None
    handled_by: Optional[UUID] = None


class SupportInteractionUpdateRequest(BaseModel):
    channel: Optional[str] = Field(default=None, pattern=r"^(whatsapp|email|phone|in_person)$")
    subject: Optional[str] = Field(default=None, min_length=1, max_length=300)
    notes: Optional[str] = None
    resolved: Optional[bool] = None
    handled_by: Optional[UUID] = None


class SupportInteractionResponse(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    channel: str
    subject: Optional[str] = None
    notes: Optional[str] = None
    resolved: bool
    handled_by: Optional[UUID] = None
    created_at: datetime
    client_name: Optional[str] = None
    handler_name: Optional[str] = None

    model_config = {"from_attributes": True}


class TrainingProgramCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    trainer_id: Optional[UUID] = None
    program_type: Optional[str] = None
    duration_weeks: Optional[int] = Field(default=None, ge=1)
    schedule: list[dict[str, Any]] = Field(default_factory=list)
    is_active: bool = True


class TrainingProgramUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    trainer_id: Optional[UUID] = None
    program_type: Optional[str] = None
    duration_weeks: Optional[int] = Field(default=None, ge=1)
    schedule: Optional[list[dict[str, Any]]] = None
    is_active: Optional[bool] = None


class TrainingProgramResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    trainer_id: Optional[UUID] = None
    program_type: Optional[str] = None
    duration_weeks: Optional[int] = None
    schedule: list[dict[str, Any]] = Field(default_factory=list)
    is_active: bool
    created_at: datetime
    updated_at: datetime
    trainer_name: Optional[str] = None

    model_config = {"from_attributes": True}


class NotificationResponse(BaseModel):
    id: UUID
    campaign_id: Optional[UUID] = None
    title: str
    message: Optional[str] = None
    type: str
    is_read: bool
    opened_at: Optional[datetime] = None
    clicked_at: Optional[datetime] = None
    action_url: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationUpdateRequest(BaseModel):
    is_read: Optional[bool] = None
    mark_opened: bool = False
    mark_clicked: bool = False


class NotificationCreateRequest(BaseModel):
    user_id: UUID
    title: str = Field(min_length=1, max_length=300)
    message: Optional[str] = Field(default=None, max_length=2000)
    type: str = Field(default="info", pattern=r"^(info|warning|success|error)$")
    action_url: Optional[str] = Field(default=None, max_length=500)
    send_push: bool = True


class NotificationBroadcastRequest(BaseModel):
    user_ids: list[UUID] = Field(default_factory=list, max_length=200)
    title: str = Field(min_length=1, max_length=300)
    message: Optional[str] = Field(default=None, max_length=2000)
    type: str = Field(default="info", pattern=r"^(info|warning|success|error)$")
    action_url: Optional[str] = Field(default=None, max_length=500)
    send_push: bool = True
    campaign_id: Optional[UUID] = None


class MobilePushPreviewRequest(BaseModel):
    title: str = Field(default="Nexo Fitness", min_length=1, max_length=300)
    message: Optional[str] = Field(default="Toca para volver a la app y abrir el flujo asociado.", max_length=2000)
    type: str = Field(default="info", pattern=r"^(info|warning|success|error)$")
    action_url: Optional[str] = Field(default=None, max_length=500)


class PushDeliveryResponse(BaseModel):
    subscription_id: UUID
    provider: str
    delivery_target: str
    expo_push_token: Optional[str] = None
    status: str
    is_active: bool
    ticket_id: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None
    receipt_status: Optional[str] = None
    receipt_message: Optional[str] = None
    receipt_error: Optional[str] = None
    receipt_checked_at: Optional[datetime] = None


class NotificationDispatchResponse(BaseModel):
    notification: NotificationResponse
    push_deliveries: list[PushDeliveryResponse] = Field(default_factory=list)


class NotificationBroadcastRecipientResponse(BaseModel):
    user_id: UUID
    user_name: Optional[str] = None
    notification: NotificationResponse
    push_deliveries: list[PushDeliveryResponse] = Field(default_factory=list)


class NotificationBroadcastResponse(BaseModel):
    total_recipients: int
    total_notifications: int
    total_push_deliveries: int
    accepted_push_deliveries: int
    errored_push_deliveries: int
    campaign_id: Optional[UUID] = None
    recipients: list[NotificationBroadcastRecipientResponse] = Field(default_factory=list)


class ReportSeriesPoint(BaseModel):
    label: str
    value: Decimal | int | float


class PlanRevenueShare(BaseModel):
    name: str
    value: Decimal | int | float
    color: str


class ClassOccupancyPoint(BaseModel):
    name: str
    occupancy: float


class ReportsOverviewResponse(BaseModel):
    revenue_total: Decimal = Decimal("0")
    active_members: int = 0
    renewal_rate: float = 0
    churn_rate: float = 0
    revenue_series: list[ReportSeriesPoint] = Field(default_factory=list)
    members_series: list[ReportSeriesPoint] = Field(default_factory=list)
    revenue_by_plan: list[PlanRevenueShare] = Field(default_factory=list)
    attendance_by_day: list[ReportSeriesPoint] = Field(default_factory=list)
    occupancy_by_class: list[ClassOccupancyPoint] = Field(default_factory=list)


class TenantBranding(BaseModel):
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    custom_domain: Optional[str] = None
    support_email: Optional[str] = None
    support_phone: Optional[str] = None
    marketplace_headline: Optional[str] = None
    marketplace_description: Optional[str] = None


class TenantSettingsUpdateRequest(BaseModel):
    gym_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None
    custom_domain: Optional[str] = None
    billing_email: Optional[EmailStr] = None
    support_email: Optional[EmailStr] = None
    support_phone: Optional[str] = None
    public_api_key: Optional[str] = None
    marketplace_headline: Optional[str] = None
    marketplace_description: Optional[str] = None
    reminder_emails: Optional[bool] = None
    reminder_whatsapp: Optional[bool] = None
    staff_can_edit_plans: Optional[bool] = None
    two_factor_required: Optional[bool] = None
    public_checkout_enabled: Optional[bool] = None


class TenantSettingsResponse(BaseModel):
    gym_name: str
    email: str
    phone: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None
    custom_domain: Optional[str] = None
    billing_email: Optional[str] = None
    support_email: Optional[str] = None
    support_phone: Optional[str] = None
    public_api_key: Optional[str] = None
    marketplace_headline: Optional[str] = None
    marketplace_description: Optional[str] = None
    reminder_emails: bool = True
    reminder_whatsapp: bool = True
    staff_can_edit_plans: bool = False
    two_factor_required: bool = False
    public_checkout_enabled: bool = True
    branding: TenantBranding


class PaymentProviderAccountCreateRequest(BaseModel):
    provider: str = Field(pattern=r"^(stripe|mercadopago|webpay|manual)$")
    status: str = Field(default="pending", pattern=r"^(pending|connected|disabled)$")
    account_label: Optional[str] = None
    public_identifier: Optional[str] = None
    checkout_base_url: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_default: bool = False


class PaymentProviderAccountUpdateRequest(BaseModel):
    status: Optional[str] = Field(default=None, pattern=r"^(pending|connected|disabled)$")
    account_label: Optional[str] = None
    public_identifier: Optional[str] = None
    checkout_base_url: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    is_default: Optional[bool] = None


class PaymentProviderAccountResponse(BaseModel):
    id: UUID
    provider: str
    status: str
    account_label: Optional[str] = None
    public_identifier: Optional[str] = None
    checkout_base_url: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_default: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TenantPublicProfileResponse(BaseModel):
    tenant_id: UUID
    tenant_slug: str
    tenant_name: str
    city: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    branding: TenantBranding
    branches: list[dict[str, Any]] = Field(default_factory=list)
    featured_plans: list[dict[str, Any]] = Field(default_factory=list)
    upcoming_classes: list[dict[str, Any]] = Field(default_factory=list)
    checkout_enabled: bool = False


class PublicCheckoutSessionRequest(BaseModel):
    plan_id: UUID
    customer_name: str = Field(min_length=2, max_length=200)
    customer_email: EmailStr
    customer_phone: Optional[str] = None
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class PublicCheckoutSessionResponse(BaseModel):
    provider: str
    status: str
    checkout_url: str
    payment_link_url: str
    qr_payload: str
    session_reference: str


class PlatformLeadCreateRequest(BaseModel):
    owner_name: str = Field(min_length=2, max_length=200)
    gym_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    phone: Optional[str] = None
    request_type: str = Field(default="lead", pattern=r"^(lead|demo|import)$")
    source: str = Field(default="website", min_length=2, max_length=50)
    desired_plan_key: Optional[str] = None
    notes: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlatformLeadUpdateRequest(BaseModel):
    status: Optional[str] = Field(default=None, pattern=r"^(new|contacted|qualified|won|lost)$")
    notes: Optional[str] = None


class PlatformLeadResponse(BaseModel):
    id: UUID
    tenant_id: Optional[UUID] = None
    owner_name: str
    gym_name: str
    email: str
    phone: Optional[str] = None
    request_type: str
    source: str
    status: str
    desired_plan_key: Optional[str] = None
    notes: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PushSubscriptionCreateRequest(BaseModel):
    provider: str = Field(default="expo", pattern=r"^(expo|webpush)$")
    device_type: str = Field(default="mobile", min_length=2, max_length=30)
    device_name: Optional[str] = None
    expo_push_token: Optional[str] = Field(default=None, min_length=10, max_length=255)
    web_endpoint: Optional[str] = Field(default=None, min_length=10, max_length=1000)
    web_p256dh_key: Optional[str] = Field(default=None, min_length=10, max_length=255)
    web_auth_key: Optional[str] = Field(default=None, min_length=10, max_length=255)
    user_agent: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_provider_payload(self) -> "PushSubscriptionCreateRequest":
        if self.provider == "expo":
            if not self.expo_push_token:
                raise ValueError("expo_push_token is required for Expo subscriptions")
            self.web_endpoint = None
            self.web_p256dh_key = None
            self.web_auth_key = None
            return self

        if not self.web_endpoint or not self.web_p256dh_key or not self.web_auth_key:
            raise ValueError("web_endpoint, web_p256dh_key and web_auth_key are required for Web Push subscriptions")
        self.expo_push_token = None
        return self


class WebPushConfigResponse(BaseModel):
    enabled: bool
    public_vapid_key: Optional[str] = None


class PushSubscriptionResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID
    provider: str
    device_type: str
    device_name: Optional[str] = None
    expo_push_token: Optional[str] = None
    web_endpoint: Optional[str] = None
    user_agent: Optional[str] = None
    is_active: bool
    last_seen_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MobilePaymentHistoryItemResponse(BaseModel):
    id: UUID
    user_id: UUID
    membership_id: Optional[UUID] = None
    amount: Decimal
    currency: str
    status: str
    method: str
    description: Optional[str] = None
    paid_at: Optional[datetime] = None
    created_at: datetime
    receipt_url: Optional[str] = None
    external_id: Optional[str] = None
    plan_name: Optional[str] = None


class MobileMembershipWalletResponse(BaseModel):
    tenant_slug: str
    tenant_name: str
    membership_id: Optional[UUID] = None
    plan_id: Optional[UUID] = None
    plan_name: Optional[str] = None
    membership_status: Optional[str] = None
    expires_at: Optional[date] = None
    auto_renew: Optional[bool] = None
    next_class: Optional[dict[str, Any]] = None
    qr_payload: Optional[str] = None
