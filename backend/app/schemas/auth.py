"""Pydantic schemas for authentication and user operations."""

from datetime import datetime, date
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


# ─── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: "UserResponse"
    # Billing wall — populated when the tenant is expired/suspended
    billing_status: Optional[str] = None
    next_action: Optional[str] = None
    checkout_url: Optional[str] = None
    widget_token: Optional[str] = None
    checkout_provider: Optional[str] = None
    billing_detail: Optional[str] = None


class RefreshRequest(BaseModel):
    refresh_token: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    phone: Optional[str] = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        if not any(c.isupper() for c in v):
            raise ValueError("La contraseña debe incluir al menos una mayúscula")
        if not any(c.isdigit() for c in v):
            raise ValueError("La contraseña debe incluir al menos un número")
        return v


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        if not any(c.isupper() for c in v):
            raise ValueError("La contraseña debe incluir al menos una mayúscula")
        if not any(c.isdigit() for c in v):
            raise ValueError("La contraseña debe incluir al menos un número")
        return v


# ─── User ─────────────────────────────────────────────────────────────────────

class UserBase(BaseModel):
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    phone: Optional[str] = None
    role: Optional[str] = "client"


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    emergency_contact: Optional[str] = None
    emergency_phone: Optional[str] = None
    medical_notes: Optional[str] = None
    tags: Optional[List[str]] = None


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    emergency_contact: Optional[str] = None
    emergency_phone: Optional[str] = None
    medical_notes: Optional[str] = None
    tags: Optional[List[str]] = None
    internal_notes: Optional[str] = None
    is_active: Optional[bool] = None


class UserSelfUpdate(BaseModel):
    """Fields a member can update on their own profile."""
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone: Optional[str] = None


class UserResponse(BaseModel):
    id: UUID
    email: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    is_active: bool
    is_verified: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserDetailResponse(UserResponse):
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    emergency_contact: Optional[str] = None
    emergency_phone: Optional[str] = None
    medical_notes: Optional[str] = None
    tags: Optional[str] = None
    internal_notes: Optional[str] = None
    last_login_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserClientResponse(UserResponse):
    """UserResponse enriched with the client's active membership summary."""
    date_of_birth: Optional[date] = None
    membership_id: Optional[UUID] = None
    membership_status: Optional[str] = None
    membership_expires_at: Optional[date] = None
    membership_notes: Optional[str] = None
    plan_name: Optional[str] = None
    churn_risk: Optional[str] = None  # "low" | "medium" | "high"

    model_config = {"from_attributes": True}


class ClientListResponse(BaseModel):
    items: List[UserClientResponse]
    total: int
    page: int
    per_page: int
    pages: int


# ─── Tenant Onboarding ───────────────────────────────────────────────────────

class TenantOnboardingRequest(BaseModel):
    gym_name: str = Field(min_length=2, max_length=200)
    slug: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    email: EmailStr
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    country: str = "Chile"
    timezone: str = "America/Santiago"
    currency: str = "CLP"
    license_type: str = "monthly"
    owner_first_name: str = Field(min_length=1, max_length=100)
    owner_last_name: str = Field(min_length=1, max_length=100)
    owner_email: EmailStr
    owner_password: str = Field(min_length=8, max_length=128)


class TenantResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    email: str
    status: str
    license_type: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
