"""Cross-cutting schemas for public commerce, tenant operations, and mobile."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator


class ApiClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scopes: List[str] = Field(default=["measurements:read"])
    rate_limit_per_minute: int = Field(default=60, ge=1, le=1000)


class ApiClientUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    scopes: Optional[List[str]] = None
    rate_limit_per_minute: Optional[int] = Field(default=None, ge=1, le=1000)
    is_active: Optional[bool] = None


class ApiClientResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    client_id: str
    scopes: List[str]
    rate_limit_per_minute: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ApiClientWithSecret(ApiClientResponse):
    """Returned only on creation — includes the plain-text secret."""
    client_secret: str


class OAuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    scope: str


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
    notes: Optional[str] = None


class MembershipResponse(BaseModel):
    id: UUID
    user_id: UUID
    plan_id: UUID
    status: str
    starts_at: date
    expires_at: Optional[date] = None
    auto_renew: bool
    frozen_until: Optional[date] = None
    notes: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    previous_membership_id: Optional[UUID] = None
    sale_source: Optional[str] = None
    payment_id: Optional[UUID] = None
    payment_amount: Optional[Decimal] = None
    payment_currency: Optional[str] = None
    payment_method: Optional[str] = None
    payment_status: Optional[str] = None
    paid_at: Optional[datetime] = None
    created_at: datetime
    user_name: Optional[str] = None
    plan_name: Optional[str] = None

    model_config = {"from_attributes": True}


class MembershipManualSaleRequest(BaseModel):
    user_id: UUID
    plan_id: UUID
    starts_at: date
    expires_at: Optional[date] = None
    payment_method: str = Field(pattern=r"^(cash|transfer)$")
    amount: Optional[Decimal] = Field(default=None, ge=0)
    currency: str = Field(default="CLP", min_length=3, max_length=3)
    description: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = Field(default=None, max_length=2000)
    auto_renew: bool = False


class ManualPaymentResponse(BaseModel):
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
    plan_id_snapshot: Optional[UUID] = None
    plan_name_snapshot: Optional[str] = None
    membership_starts_at_snapshot: Optional[date] = None
    membership_expires_at_snapshot: Optional[date] = None
    membership_status_snapshot: Optional[str] = None

    model_config = {"from_attributes": True}


class MembershipManualSaleResponse(BaseModel):
    membership: MembershipResponse
    payment: ManualPaymentResponse
    replaced_membership_ids: List[UUID] = Field(default_factory=list)
    effective_membership: Optional[MembershipResponse] = None
    scheduled_membership: Optional[MembershipResponse] = None
    scheduled: bool = False


class PromoCodeCreate(BaseModel):
    code: str = Field(min_length=2, max_length=50, pattern=r"^[A-Za-z0-9_\-]+$")
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    discount_type: str = Field(pattern=r"^(percent|fixed)$")
    discount_value: Decimal = Field(gt=0)
    max_uses: Optional[int] = Field(default=None, ge=1)
    expires_at: Optional[datetime] = None
    plan_ids: Optional[List[UUID]] = None  # None = all plans


class PromoCodeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    discount_type: Optional[str] = Field(default=None, pattern=r"^(percent|fixed)$")
    discount_value: Optional[Decimal] = Field(default=None, gt=0)
    max_uses: Optional[int] = Field(default=None, ge=1)
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None
    plan_ids: Optional[List[UUID]] = None


class PromoCodeResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    code: str
    name: str
    description: Optional[str] = None
    discount_type: str
    discount_value: Decimal
    max_uses: Optional[int] = None
    uses_count: int
    expires_at: Optional[datetime] = None
    is_active: bool
    plan_ids: Optional[List[UUID]] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PromoCodeValidateRequest(BaseModel):
    code: str
    plan_id: UUID


class PromoCodeValidateResponse(BaseModel):
    valid: bool
    reason: Optional[str] = None
    promo_code_id: Optional[UUID] = None
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    discount_amount: Optional[float] = None
    final_price: Optional[float] = None


class BodyMeasurementCreate(BaseModel):
    recorded_at: datetime
    weight_kg: Optional[Decimal] = None
    body_fat_pct: Optional[Decimal] = None
    muscle_mass_kg: Optional[Decimal] = None
    chest_cm: Optional[Decimal] = None
    waist_cm: Optional[Decimal] = None
    hip_cm: Optional[Decimal] = None
    arm_cm: Optional[Decimal] = None
    thigh_cm: Optional[Decimal] = None
    notes: Optional[str] = None


class BodyMeasurementResponse(BaseModel):
    id: UUID
    user_id: UUID
    tenant_id: UUID
    recorded_at: datetime
    weight_kg: Optional[Decimal] = None
    body_fat_pct: Optional[Decimal] = None
    muscle_mass_kg: Optional[Decimal] = None
    chest_cm: Optional[Decimal] = None
    waist_cm: Optional[Decimal] = None
    hip_cm: Optional[Decimal] = None
    arm_cm: Optional[Decimal] = None
    thigh_cm: Optional[Decimal] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PersonalRecordCreate(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=200)
    record_value: Decimal
    unit: str = Field(min_length=1, max_length=50)
    recorded_at: datetime
    notes: Optional[str] = None


class PersonalRecordResponse(BaseModel):
    id: UUID
    user_id: UUID
    tenant_id: UUID
    exercise_name: str
    record_value: Decimal
    unit: str
    recorded_at: datetime
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ProgressPhotoResponse(BaseModel):
    id: UUID
    user_id: UUID
    tenant_id: UUID
    recorded_at: datetime
    photo_url: str
    notes: Optional[str] = None
    created_at: datetime

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
    resolved: bool = False


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


class FeedbackSubmissionResponse(BaseModel):
    id: UUID
    category: str = Field(pattern=r"^(suggestion|improvement|problem|other)$")
    message: str
    image_url: Optional[str] = None
    created_at: datetime
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None

    model_config = {"from_attributes": True}


class PlatformFeedbackSubmissionResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    tenant_name: str
    tenant_slug: str
    category: str = Field(pattern=r"^(suggestion|improvement|problem|other)$")
    message: str
    image_url: Optional[str] = None
    created_at: datetime
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None
    created_by_email: Optional[str] = None

    model_config = {"from_attributes": True}


class MobileSupportInteractionCreateRequest(BaseModel):
    channel: str = Field(default="whatsapp", pattern=r"^(whatsapp|email|phone|in_person)$")
    subject: str = Field(min_length=1, max_length=300)
    notes: Optional[str] = None


class ProgramScheduleFieldOverridePayload(BaseModel):
    mode: Literal["inherit", "custom"]
    value: Any = None


class ProgramScheduleDayConfigPayload(BaseModel):
    branch_id: Optional[ProgramScheduleFieldOverridePayload] = None
    instructor_id: Optional[ProgramScheduleFieldOverridePayload] = None
    modality: Optional[ProgramScheduleFieldOverridePayload] = None
    max_capacity: Optional[ProgramScheduleFieldOverridePayload] = None
    online_link: Optional[ProgramScheduleFieldOverridePayload] = None
    cancellation_deadline_hours: Optional[ProgramScheduleFieldOverridePayload] = None
    restricted_plan_id: Optional[ProgramScheduleFieldOverridePayload] = None
    color: Optional[ProgramScheduleFieldOverridePayload] = None
    class_type: Optional[ProgramScheduleFieldOverridePayload] = None

    @model_validator(mode="before")
    def normalize_legacy_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        normalized: dict[str, Any] = {}
        for field_name in (
            "branch_id",
            "instructor_id",
            "modality",
            "max_capacity",
            "online_link",
            "cancellation_deadline_hours",
            "restricted_plan_id",
            "color",
            "class_type",
        ):
            if field_name not in value:
                continue

            raw_field = value[field_name]
            if isinstance(raw_field, dict) and raw_field.get("mode") in {"inherit", "custom"}:
                normalized[field_name] = {
                    "mode": raw_field.get("mode"),
                    "value": raw_field.get("value"),
                }
            else:
                normalized[field_name] = {
                    "mode": "custom",
                    "value": raw_field,
                }

        return normalized


class ProgramScheduleDayPayload(BaseModel):
    day: str
    focus: str = ""
    exercises: list[Any] = Field(default_factory=list)
    class_config: Optional[ProgramScheduleDayConfigPayload] = None


class TrainingProgramCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    trainer_id: Optional[UUID] = None
    program_type: Optional[str] = None
    duration_weeks: int = Field(default=0, ge=0)  # 0 = indefinido (sin límite)
    schedule: list[ProgramScheduleDayPayload] = Field(default_factory=list)
    is_active: bool = True


class TrainingProgramUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    trainer_id: Optional[UUID] = None
    program_type: Optional[str] = None
    duration_weeks: Optional[int] = Field(default=None, ge=0)  # 0 = indefinido (sin límite)
    schedule: Optional[list[ProgramScheduleDayPayload]] = None
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
    enrolled_count: int = 0
    linked_class_count: int = 0
    is_enrolled: bool = False
    enrollment_id: Optional[UUID] = None

    model_config = {"from_attributes": True}


class ProgramExerciseLibraryItemCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    group: str = Field(min_length=1, max_length=80)


class ProgramExerciseLibraryItemResponse(BaseModel):
    id: str
    name: str
    group: str


class TrainingProgramEnrollmentResponse(BaseModel):
    id: UUID
    program_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_phone: Optional[str] = None
    created_at: datetime

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


class TopProductPoint(BaseModel):
    name: str
    revenue: Decimal
    units_sold: int


class ExpenseCategoryPoint(BaseModel):
    category: str
    label: str
    amount: Decimal


class ReportsOverviewResponse(BaseModel):
    # ── Membresías (existente) ────────────────────────────────────────────────
    revenue_total: Decimal = Decimal("0")
    active_members: int = 0
    renewal_rate: float = 0
    churn_rate: float = 0
    revenue_series: list[ReportSeriesPoint] = Field(default_factory=list)
    members_series: list[ReportSeriesPoint] = Field(default_factory=list)
    revenue_by_plan: list[PlanRevenueShare] = Field(default_factory=list)
    attendance_by_day: list[ReportSeriesPoint] = Field(default_factory=list)
    occupancy_by_class: list[ClassOccupancyPoint] = Field(default_factory=list)
    # ── POS ──────────────────────────────────────────────────────────────────
    pos_revenue: Decimal = Decimal("0")
    pos_revenue_series: list[ReportSeriesPoint] = Field(default_factory=list)
    pos_cogs: Decimal = Decimal("0")
    pos_gross_profit: Decimal = Decimal("0")
    pos_gross_margin_pct: float = 0.0
    top_products: list[TopProductPoint] = Field(default_factory=list)
    # ── Gastos ────────────────────────────────────────────────────────────────
    total_expenses: Decimal = Decimal("0")
    expenses_by_category: list[ExpenseCategoryPoint] = Field(default_factory=list)
    expense_series: list[ReportSeriesPoint] = Field(default_factory=list)
    # ── P&L consolidado ──────────────────────────────────────────────────────
    total_revenue: Decimal = Decimal("0")
    net_profit: Decimal = Decimal("0")
    net_margin_pct: float = 0.0


class TenantBranding(BaseModel):
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
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
    secondary_color: Optional[str] = None
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
    slug: str
    gym_name: str
    email: str
    phone: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
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
    provider: str = Field(pattern=r"^(stripe|mercadopago|webpay|fintoc|tuu|manual)$")
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
    customer_date_of_birth: Optional[date] = None
    customer_password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    promo_code_id: Optional[UUID] = None
    verification_token: Optional[str] = None


class PublicCheckoutSessionResponse(BaseModel):
    provider: str
    status: str
    checkout_url: str
    payment_link_url: str
    qr_payload: str
    session_reference: str
    widget_token: Optional[str] = None  # Fintoc: token para abrir el widget JS


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
                raise ValueError("expo_push_token es obligatorio para las suscripciones de Expo")
            self.web_endpoint = None
            self.web_p256dh_key = None
            self.web_auth_key = None
            return self

        if not self.web_endpoint or not self.web_p256dh_key or not self.web_auth_key:
            raise ValueError("web_endpoint, web_p256dh_key y web_auth_key son obligatorios para las suscripciones Web Push")
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
    plan_id_snapshot: Optional[UUID] = None
    plan_name_snapshot: Optional[str] = None
    membership_starts_at_snapshot: Optional[date] = None
    membership_expires_at_snapshot: Optional[date] = None
    membership_status_snapshot: Optional[str] = None


class MobileWalletMembershipSummaryResponse(BaseModel):
    membership_id: UUID
    plan_id: UUID
    plan_name: Optional[str] = None
    membership_status: str
    starts_at: date
    expires_at: Optional[date] = None
    auto_renew: bool
    sale_source: Optional[str] = None


class MobileMembershipWalletResponse(BaseModel):
    tenant_slug: str
    tenant_name: str
    membership_id: Optional[UUID] = None
    plan_id: Optional[UUID] = None
    plan_name: Optional[str] = None
    membership_status: Optional[str] = None
    starts_at: Optional[date] = None
    expires_at: Optional[date] = None
    auto_renew: Optional[bool] = None
    current_membership: Optional[MobileWalletMembershipSummaryResponse] = None
    next_membership: Optional[MobileWalletMembershipSummaryResponse] = None
    next_class: Optional[dict[str, Any]] = None
    next_program_class: Optional[dict[str, Any]] = None
    qr_payload: Optional[str] = None
    # Reservation quota tracking
    max_reservations_per_week: Optional[int] = None
    max_reservations_per_month: Optional[int] = None
    weekly_reservations_used: Optional[int] = None
    monthly_reservations_used: Optional[int] = None
