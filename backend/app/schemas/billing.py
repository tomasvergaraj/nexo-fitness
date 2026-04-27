"""Schemas for SaaS billing and public checkout."""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.auth import TenantOnboardingRequest, TenantResponse, UserResponse


class SaaSPlanResponse(BaseModel):
    key: str
    name: str
    description: str
    license_type: str
    currency: str
    price: Decimal = Field(ge=0)
    discount_pct: Optional[Decimal] = Field(default=None, ge=0, le=100)
    tax_rate: Decimal = Field(ge=0)
    tax_amount: Decimal = Field(ge=0)
    total_price: Decimal = Field(ge=0)
    billing_interval: str
    trial_days: int = Field(ge=0)
    max_members: int = Field(ge=1)
    max_branches: int = Field(ge=1)
    features: List[str]
    highlighted: bool = False
    checkout_enabled: bool = False
    checkout_provider: Optional[str] = None


class AdminSaaSPlanResponse(SaaSPlanResponse):
    id: UUID
    stripe_price_id: Optional[str] = None
    fintoc_enabled: bool = False
    webpay_enabled: bool = False
    is_active: bool = True
    is_public: bool = True
    sort_order: int = 0
    created_at: datetime
    updated_at: datetime


class AdminSaaSPlanCreateRequest(BaseModel):
    key: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9_]+(?:-[a-z0-9_]+)*$")
    name: str = Field(min_length=2, max_length=200)
    description: str = Field(default="")
    license_type: str = Field(pattern=r"^(monthly|quarterly|semi_annual|annual|perpetual)$")
    currency: str = Field(default="CLP", min_length=3, max_length=3)
    price: Decimal = Field(ge=0)
    discount_pct: Optional[Decimal] = Field(default=None, ge=0, le=100)
    billing_interval: str = Field(pattern=r"^(month|quarter|semi_annual|year|manual)$")
    trial_days: int = Field(default=14, ge=0)
    max_members: int = Field(default=500, ge=1)
    max_branches: int = Field(default=3, ge=1)
    features: List[str] = Field(default_factory=list)
    stripe_price_id: Optional[str] = None
    fintoc_enabled: bool = False
    webpay_enabled: bool = False
    highlighted: bool = False
    is_active: bool = True
    is_public: bool = True
    sort_order: int = Field(default=0, ge=0)


class AdminSaaSPlanUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = None
    license_type: Optional[str] = Field(default=None, pattern=r"^(monthly|quarterly|semi_annual|annual|perpetual)$")
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    price: Optional[Decimal] = Field(default=None, ge=0)
    discount_pct: Optional[Decimal] = Field(default=None, ge=0, le=100)
    billing_interval: Optional[str] = Field(default=None, pattern=r"^(month|quarter|semi_annual|year|manual)$")
    trial_days: Optional[int] = Field(default=None, ge=0)
    max_members: Optional[int] = Field(default=None, ge=1)
    max_branches: Optional[int] = Field(default=None, ge=1)
    features: Optional[List[str]] = None
    stripe_price_id: Optional[str] = None
    fintoc_enabled: Optional[bool] = None
    webpay_enabled: Optional[bool] = None
    highlighted: Optional[bool] = None
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0)


class SaaSSignupRequest(TenantOnboardingRequest):
    plan_key: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9_]+(?:-[a-z0-9_]+)*$")
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    verification_token: Optional[str] = None


class SaaSSignupResponse(BaseModel):
    tenant: TenantResponse
    user: UserResponse
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    plan: SaaSPlanResponse
    billing_status: str
    checkout_required: bool = False
    checkout_url: Optional[str] = None
    checkout_session_id: Optional[str] = None
    checkout_provider: Optional[str] = None
    widget_token: Optional[str] = None
    next_action: str
    message: str


class TenantBillingResponse(BaseModel):
    tenant_id: UUID
    tenant_name: str
    tenant_slug: str
    status: str
    license_type: str
    plan_key: str
    plan_name: str
    currency: str
    trial_ends_at: Optional[datetime] = None
    license_expires_at: Optional[datetime] = None
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    checkout_enabled: bool = False
    is_active: bool
    max_members: Optional[int] = None
    max_branches: Optional[int] = None
    usage_active_clients: int = 0
    usage_active_branches: int = 0
    remaining_client_slots: int = 0
    remaining_branch_slots: int = 0
    over_client_limit: bool = False
    over_branch_limit: bool = False
    features: List[str] = Field(default_factory=list)
    owner_email: Optional[str] = None
    owner_name: Optional[str] = None
    created_at: datetime
    next_plan_key: Optional[str] = None
    next_plan_name: Optional[str] = None
    next_plan_starts_at: Optional[datetime] = None
    next_plan_paid: bool = False


class OwnerPaymentItem(BaseModel):
    id: UUID
    plan_key: str
    plan_name: str
    base_amount: Decimal = Field(ge=0)
    promo_discount_amount: Decimal = Field(ge=0)
    tax_rate: Decimal = Field(ge=0)
    tax_amount: Decimal = Field(ge=0)
    total_amount: Decimal = Field(ge=0)
    currency: str
    payment_method: str
    external_reference: Optional[str] = None
    paid_at: Optional[datetime] = None
    starts_at: date
    expires_at: Optional[date] = None
    created_at: datetime


class ReactivateRequest(BaseModel):
    plan_key: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9_]+(?:-[a-z0-9_]+)*$")
    promo_code: Optional[str] = None
    promo_code_id: Optional[UUID] = None
    force_immediate: bool = False
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class AdminTenantBillingResponse(TenantBillingResponse):
    owner_user_id: Optional[UUID] = None


class PlatformPromoCodeResponse(BaseModel):
    id: UUID
    code: str
    name: str
    description: Optional[str] = None
    discount_type: str
    discount_value: Decimal = Field(ge=0)
    max_uses: Optional[int] = Field(default=None, ge=1)
    uses_count: int = Field(ge=0)
    expires_at: Optional[datetime] = None
    is_active: bool = True
    plan_keys: Optional[List[str]] = None
    created_at: datetime
    updated_at: datetime


class PlatformPromoCodeCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    discount_type: str = Field(pattern=r"^(percent|fixed)$")
    discount_value: Decimal = Field(gt=0)
    max_uses: Optional[int] = Field(default=None, ge=1)
    expires_at: Optional[datetime] = None
    is_active: bool = True
    plan_keys: Optional[List[str]] = None


class PlatformPromoCodeUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = None
    discount_type: Optional[str] = Field(default=None, pattern=r"^(percent|fixed)$")
    discount_value: Optional[Decimal] = Field(default=None, gt=0)
    max_uses: Optional[int] = Field(default=None, ge=1)
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None
    plan_keys: Optional[List[str]] = None


class BillingQuoteRequest(BaseModel):
    plan_key: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9_]+(?:-[a-z0-9_]+)*$")
    promo_code: Optional[str] = None
    promo_code_id: Optional[UUID] = None


class BillingQuoteResponse(BaseModel):
    valid: bool
    reason: Optional[str] = None
    plan_key: Optional[str] = None
    plan_name: Optional[str] = None
    currency: Optional[str] = None
    promo_code_id: Optional[UUID] = None
    base_price: Optional[Decimal] = Field(default=None, ge=0)
    promo_discount_amount: Optional[Decimal] = Field(default=None, ge=0)
    taxable_subtotal: Optional[Decimal] = Field(default=None, ge=0)
    tax_rate: Optional[Decimal] = Field(default=None, ge=0)
    tax_amount: Optional[Decimal] = Field(default=None, ge=0)
    total_amount: Optional[Decimal] = Field(default=None, ge=0)


class AdminTenantManualPaymentRequest(BaseModel):
    plan_key: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9_]+(?:-[a-z0-9_]+)*$")
    starts_at: date
    payment_method: str = Field(pattern=r"^(transfer)$")
    promo_code_id: Optional[UUID] = None
    transfer_reference: str = Field(min_length=2, max_length=255)
    notes: Optional[str] = None


class PlatformBillingPaymentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    plan_key: str
    plan_name: str
    promo_code_id: Optional[UUID] = None
    base_amount: Decimal = Field(ge=0)
    promo_discount_amount: Decimal = Field(ge=0)
    tax_rate: Decimal = Field(ge=0)
    tax_amount: Decimal = Field(ge=0)
    total_amount: Decimal = Field(ge=0)
    currency: str
    payment_method: str
    external_reference: Optional[str] = None
    notes: Optional[str] = None
    paid_at: Optional[datetime] = None
    starts_at: date
    expires_at: Optional[date] = None
    created_by: Optional[UUID] = None
    created_at: datetime


class AdminTenantManualPaymentResponse(BaseModel):
    tenant_id: UUID
    tenant_status: str
    plan_key: str
    plan_name: str
    license_expires_at: Optional[datetime] = None
    payment: PlatformBillingPaymentResponse
