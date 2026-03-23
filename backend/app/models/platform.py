"""Platform-level models used by the SaaS operator."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.tenant import LicenseType


class SaaSPlan(Base):
    __tablename__ = "saas_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    license_type: Mapped[LicenseType] = mapped_column(
        SAEnum(LicenseType, name="saas_plan_license_type_enum"),
        default=LicenseType.MONTHLY,
    )
    currency: Mapped[str] = mapped_column(String(3), default="CLP")
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    billing_interval: Mapped[str] = mapped_column(String(20), default="month")
    trial_days: Mapped[int] = mapped_column(Integer, default=14)
    max_members: Mapped[int] = mapped_column(Integer, default=500)
    max_branches: Mapped[int] = mapped_column(Integer, default=3)
    features: Mapped[Optional[str]] = mapped_column(Text)  # JSON array
    stripe_price_id: Mapped[Optional[str]] = mapped_column(String(255))
    highlighted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
