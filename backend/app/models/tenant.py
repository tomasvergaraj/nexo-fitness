"""Tenant model - the foundation of multitenancy."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, Text, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

import enum


class TenantStatus(str, enum.Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    TRIAL = "trial"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class LicenseType(str, enum.Enum):
    MONTHLY = "monthly"
    ANNUAL = "annual"
    PERPETUAL = "perpetual"


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(50))
    address: Mapped[Optional[str]] = mapped_column(Text)
    city: Mapped[Optional[str]] = mapped_column(String(100))
    country: Mapped[Optional[str]] = mapped_column(String(100))
    timezone: Mapped[str] = mapped_column(String(50), default="America/Santiago")
    currency: Mapped[str] = mapped_column(String(3), default="CLP")

    # License
    license_type: Mapped[LicenseType] = mapped_column(
        SAEnum(LicenseType, name="license_type_enum"), default=LicenseType.MONTHLY
    )
    status: Mapped[TenantStatus] = mapped_column(
        SAEnum(TenantStatus, name="tenant_status_enum"), default=TenantStatus.TRIAL
    )
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    license_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Branding (future)
    logo_url: Mapped[Optional[str]] = mapped_column(String(500))
    primary_color: Mapped[Optional[str]] = mapped_column(String(7), default="#06b6d4")
    secondary_color: Mapped[Optional[str]] = mapped_column(String(7), default="#0f766e")
    custom_domain: Mapped[Optional[str]] = mapped_column(String(255))

    # Feature flags
    features: Mapped[Optional[str]] = mapped_column(Text)  # JSON string of enabled features

    # Stripe
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(255))
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(String(255))

    # Meta
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    max_members: Mapped[Optional[int]] = mapped_column(default=500)
    max_branches: Mapped[Optional[int]] = mapped_column(default=3)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    users = relationship("User", back_populates="tenant", lazy="selectin")
    branches = relationship("Branch", back_populates="tenant", lazy="selectin")
