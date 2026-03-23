"""Authentication and tenant onboarding service."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password, decode_token
from app.models.tenant import Tenant, TenantStatus, LicenseType
from app.models.user import User, UserRole
from app.models.business import Branch
from app.schemas.auth import (
    LoginRequest, LoginResponse, RegisterRequest, TenantOnboardingRequest,
    UserResponse, TenantResponse,
)


class AuthService:

    @staticmethod
    async def login(db: AsyncSession, data: LoginRequest) -> LoginResponse:
        result = await db.execute(select(User).where(User.email == data.email, User.is_active == True))
        user = result.scalar_one_or_none()

        if not user or not verify_password(data.password, user.hashed_password):
            raise ValueError("Invalid email or password")

        tenant_id = str(user.tenant_id) if user.tenant_id else None
        access_token = create_access_token(
            subject=str(user.id),
            tenant_id=tenant_id,
            role=user.role.value if isinstance(user.role, UserRole) else user.role,
        )
        refresh_token = create_refresh_token(subject=str(user.id), tenant_id=tenant_id)

        user.refresh_token = refresh_token
        user.last_login_at = datetime.now(timezone.utc)
        await db.flush()

        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            user=UserResponse.model_validate(user),
        )

    @staticmethod
    async def refresh(db: AsyncSession, refresh_token: str) -> dict:
        try:
            payload = decode_token(refresh_token)
        except ValueError:
            raise ValueError("Invalid refresh token")

        if payload.get("type") != "refresh":
            raise ValueError("Invalid token type")

        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
        user = result.scalar_one_or_none()

        if not user or user.refresh_token != refresh_token:
            raise ValueError("Invalid refresh token")

        tenant_id = str(user.tenant_id) if user.tenant_id else None
        new_access = create_access_token(
            subject=str(user.id),
            tenant_id=tenant_id,
            role=user.role.value if isinstance(user.role, UserRole) else user.role,
        )
        new_refresh = create_refresh_token(subject=str(user.id), tenant_id=tenant_id)
        user.refresh_token = new_refresh
        await db.flush()

        return {"access_token": new_access, "refresh_token": new_refresh, "token_type": "bearer"}

    @staticmethod
    async def register_tenant(db: AsyncSession, data: TenantOnboardingRequest) -> dict:
        """Full tenant onboarding: creates tenant, owner user, default branch."""
        # Check slug uniqueness
        existing = await db.execute(select(Tenant).where(Tenant.slug == data.slug))
        if existing.scalar_one_or_none():
            raise ValueError(f"Slug '{data.slug}' is already taken")

        # Check email uniqueness
        existing_user = await db.execute(select(User).where(User.email == data.owner_email))
        if existing_user.scalar_one_or_none():
            raise ValueError("Email already registered")

        # Map license type
        license_map = {"monthly": LicenseType.MONTHLY, "annual": LicenseType.ANNUAL, "perpetual": LicenseType.PERPETUAL}
        license_type = license_map.get(data.license_type, LicenseType.MONTHLY)

        # Create tenant
        tenant = Tenant(
            name=data.gym_name,
            slug=data.slug,
            email=data.email,
            phone=data.phone,
            address=data.address,
            city=data.city,
            country=data.country,
            timezone=data.timezone,
            currency=data.currency,
            license_type=license_type,
            status=TenantStatus.TRIAL,
            trial_ends_at=datetime.now(timezone.utc) + timedelta(days=14),
        )
        db.add(tenant)
        await db.flush()

        # Create owner user
        owner = User(
            tenant_id=tenant.id,
            email=data.owner_email,
            hashed_password=hash_password(data.owner_password),
            first_name=data.owner_first_name,
            last_name=data.owner_last_name,
            phone=data.phone,
            role=UserRole.OWNER,
            is_verified=True,
        )
        db.add(owner)

        # Create default branch
        branch = Branch(
            tenant_id=tenant.id,
            name=f"{data.gym_name} - Principal",
            address=data.address,
            city=data.city,
        )
        db.add(branch)
        await db.flush()

        # Generate tokens
        access_token = create_access_token(
            subject=str(owner.id),
            tenant_id=str(tenant.id),
            role=UserRole.OWNER.value,
        )
        refresh_token = create_refresh_token(subject=str(owner.id), tenant_id=str(tenant.id))
        owner.refresh_token = refresh_token

        return {
            "tenant": TenantResponse.model_validate(tenant),
            "user": UserResponse.model_validate(owner),
            "access_token": access_token,
            "refresh_token": refresh_token,
        }
