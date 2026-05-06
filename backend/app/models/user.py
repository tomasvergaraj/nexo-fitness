"""User model with RBAC and tenant association."""

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class UserRole(str, enum.Enum):
    SUPERADMIN = "superadmin"
    OWNER = "owner"
    ADMIN = "admin"
    RECEPTION = "reception"
    TRAINER = "trainer"
    MARKETING = "marketing"
    CLIENT = "client"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(50))
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500))

    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, name="user_role_enum"), default=UserRole.CLIENT)
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    # Client-specific fields
    date_of_birth: Mapped[Optional[datetime]] = mapped_column(DateTime)
    gender: Mapped[Optional[str]] = mapped_column(String(20))
    emergency_contact: Mapped[Optional[str]] = mapped_column(String(255))
    emergency_phone: Mapped[Optional[str]] = mapped_column(String(50))
    medical_notes: Mapped[Optional[str]] = mapped_column(Text)
    tags: Mapped[Optional[str]] = mapped_column(Text)  # JSON array
    internal_notes: Mapped[Optional[str]] = mapped_column(Text)

    # Auth
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    refresh_token: Mapped[Optional[str]] = mapped_column(String(500))

    # 2FA / TOTP
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    two_factor_secret: Mapped[Optional[str]] = mapped_column(String(255))  # Fernet-encrypted base32 seed
    two_factor_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    backup_codes: Mapped[Optional[str]] = mapped_column(Text)  # JSON list of bcrypt hashes (single-use)

    # Meta
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Relationships
    tenant = relationship("Tenant", back_populates="users")
    memberships = relationship("Membership", back_populates="user")
    reservations = relationship("Reservation", back_populates="user")
    checkins = relationship("CheckIn", back_populates="user", foreign_keys="CheckIn.user_id")
    payments = relationship("Payment", back_populates="user")

    @property
    def full_name(self) -> str:
        return " ".join(part for part in [self.first_name, self.last_name] if part).strip()


class UserTrustedDevice(Base):
    """Devices on which a user has chosen to skip 2FA for ~30 days."""
    __tablename__ = "user_trusted_devices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    label: Mapped[Optional[str]] = mapped_column(String(100))
    user_agent: Mapped[Optional[str]] = mapped_column(String(500))
    ip_address: Mapped[Optional[str]] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
