"""Pydantic schemas for business domain objects."""

from datetime import datetime, date, time
from decimal import Decimal
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field


# ─── Branch ───────────────────────────────────────────────────────────────────

class BranchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    opening_time: Optional[time] = None
    closing_time: Optional[time] = None
    capacity: Optional[int] = None

class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    opening_time: Optional[time] = None
    closing_time: Optional[time] = None
    capacity: Optional[int] = None
    is_active: Optional[bool] = None

class BranchResponse(BaseModel):
    id: UUID
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── Plan ─────────────────────────────────────────────────────────────────────

class PlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    price: Decimal = Field(ge=0)
    discount_pct: Optional[Decimal] = Field(default=None, ge=0, le=100)
    currency: str = "CLP"
    duration_type: str
    duration_days: Optional[int] = None
    max_reservations_per_week: Optional[int] = None
    max_reservations_per_month: Optional[int] = None
    allowed_class_types: Optional[List[str]] = None
    allowed_branches: Optional[List[str]] = None
    benefits: Optional[List[str]] = None
    is_featured: bool = False
    auto_renew: bool = True

class PlanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[Decimal] = None
    discount_pct: Optional[Decimal] = Field(default=None, ge=0, le=100)
    duration_type: Optional[str] = None
    duration_days: Optional[int] = None
    max_reservations_per_week: Optional[int] = None
    max_reservations_per_month: Optional[int] = None
    is_active: Optional[bool] = None
    is_featured: Optional[bool] = None
    auto_renew: Optional[bool] = None

class PlanResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    price: Decimal
    discount_pct: Optional[Decimal] = None
    currency: str
    duration_type: str
    duration_days: Optional[int] = None
    max_reservations_per_week: Optional[int] = None
    is_active: bool
    is_featured: bool
    auto_renew: bool
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── GymClass ─────────────────────────────────────────────────────────────────

class GymClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    class_type: Optional[str] = None
    modality: str = "in_person"
    branch_id: Optional[UUID] = None
    instructor_id: Optional[UUID] = None
    start_time: datetime
    end_time: datetime
    max_capacity: int = Field(ge=1, default=20)
    waitlist_enabled: bool = True
    online_link: Optional[str] = None
    cancellation_deadline_hours: int = 2
    color: Optional[str] = None

class GymClassUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    class_type: Optional[str] = None
    modality: Optional[str] = None
    branch_id: Optional[UUID] = None
    instructor_id: Optional[UUID] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    max_capacity: Optional[int] = None
    online_link: Optional[str] = None
    status: Optional[str] = None

class GymClassResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    class_type: Optional[str] = None
    modality: str
    status: str
    instructor_id: Optional[UUID] = None
    instructor_name: Optional[str] = None
    branch_id: Optional[UUID] = None
    start_time: datetime
    end_time: datetime
    max_capacity: int
    current_bookings: int
    waitlist_enabled: bool
    online_link: Optional[str] = None
    color: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── Reservation ──────────────────────────────────────────────────────────────

class ReservationCreate(BaseModel):
    gym_class_id: UUID
    user_id: Optional[UUID] = None  # Staff can reserve for a client

class ReservationResponse(BaseModel):
    id: UUID
    user_id: UUID
    gym_class_id: UUID
    status: str
    waitlist_position: Optional[int] = None
    cancel_reason: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── CheckIn ──────────────────────────────────────────────────────────────────

class CheckInCreate(BaseModel):
    user_id: UUID
    gym_class_id: Optional[UUID] = None
    branch_id: Optional[UUID] = None
    check_type: str = "manual"

class CheckInScanRequest(BaseModel):
    qr_payload: str = Field(min_length=1, max_length=255)
    gym_class_id: Optional[UUID] = None
    branch_id: Optional[UUID] = None

class CheckInResponse(BaseModel):
    id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    gym_class_id: Optional[UUID] = None
    check_type: str
    checked_in_at: datetime
    model_config = {"from_attributes": True}


# ─── Payment ──────────────────────────────────────────────────────────────────

class PaymentCreate(BaseModel):
    user_id: UUID
    amount: Decimal = Field(ge=0)
    currency: str = "CLP"
    method: str
    description: Optional[str] = None
    membership_id: Optional[UUID] = None

class PaymentResponse(BaseModel):
    id: UUID
    user_id: UUID
    amount: Decimal
    currency: str
    status: str
    method: str
    description: Optional[str] = None
    paid_at: Optional[datetime] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── Campaign ─────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    subject: Optional[str] = None
    content: Optional[str] = None
    channel: str
    status: Optional[str] = Field(default=None, pattern=r"^(draft|scheduled|sending|sent|cancelled)$")
    segment_filter: Optional[dict] = None
    notification_type: str = Field(default="info", pattern=r"^(info|warning|success|error)$")
    action_url: Optional[str] = Field(default=None, max_length=500)
    send_push: bool = True
    scheduled_at: Optional[datetime] = None
    total_recipients: int = Field(default=0, ge=0)
    total_sent: int = Field(default=0, ge=0)
    total_opened: int = Field(default=0, ge=0)
    total_clicked: int = Field(default=0, ge=0)

class CampaignResponse(BaseModel):
    id: UUID
    name: str
    subject: Optional[str] = None
    content: Optional[str] = None
    channel: str
    status: str
    total_recipients: int
    total_sent: int
    total_opened: int
    total_clicked: int
    segment_filter: Optional[dict] = None
    notification_type: str
    action_url: Optional[str] = None
    send_push: bool
    scheduled_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    last_dispatch_trigger: Optional[str] = None
    last_dispatch_attempted_at: Optional[datetime] = None
    last_dispatch_finished_at: Optional[datetime] = None
    last_dispatch_error: Optional[str] = None
    dispatch_attempts: int
    created_at: datetime


# ─── Dashboard ────────────────────────────────────────────────────────────────

class DashboardMetrics(BaseModel):
    revenue_today: Decimal = Decimal("0")
    revenue_week: Decimal = Decimal("0")
    revenue_month: Decimal = Decimal("0")
    active_members: int = 0
    total_members: int = 0
    classes_today: int = 0
    reservations_today: int = 0
    checkins_today: int = 0
    pending_payments: int = 0
    expiring_memberships: int = 0
    occupancy_rate: float = 0.0
    churn_rate: float = 0.0
    recent_checkins: List[CheckInResponse] = []
    revenue_chart: List[dict] = []
    class_occupancy_chart: List[dict] = []


# ─── Generic List ─────────────────────────────────────────────────────────────

class PaginatedResponse(BaseModel):
    items: List = []
    total: int = 0
    page: int = 1
    per_page: int = 20
    pages: int = 0
