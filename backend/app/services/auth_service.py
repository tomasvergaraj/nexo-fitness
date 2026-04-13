"""Authentication and tenant onboarding service."""

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import structlog

_auth_logger = structlog.get_logger("auth")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    create_access_token, create_refresh_token, create_password_reset_token,
    hash_password, verify_password, decode_token,
)
from app.core.config import get_settings
from app.models.tenant import Tenant, TenantStatus, LicenseType
from app.models.user import User, UserRole
from app.models.business import Branch
from app.schemas.auth import (
    LoginRequest, LoginResponse, RegisterRequest, TenantOnboardingRequest,
    UserResponse, TenantResponse,
)
from app.core.exceptions import ActionRequiredError
from app.services.tenant_access_service import (
    create_reactivation_checkout,
    evaluate_tenant_access,
)


class AuthService:
    @staticmethod
    async def _ensure_user_tenant_access(db: AsyncSession, user: User) -> None:
        """Used by refresh — raises ActionRequiredError if tenant is not active."""
        if user.is_superadmin or not user.tenant_id:
            return

        tenant = await db.get(Tenant, user.tenant_id)
        if not tenant:
            raise ValueError("La cuenta no existe o está suspendida")

        from app.services.tenant_access_service import enforce_tenant_access  # local to avoid circular
        await enforce_tenant_access(db, tenant, user, now=datetime.now(timezone.utc))

    _DISPOSABLE_DOMAINS: frozenset[str] = frozenset({
        "mailinator.com", "guerrillamail.com", "guerrillamail.info", "guerrillamail.biz",
        "guerrillamail.de", "guerrillamail.net", "guerrillamail.org", "sharklasers.com",
        "grr.la", "spam4.me", "trashmail.com", "trashmail.me", "trashmail.at", "trashmail.io",
        "fakeinbox.com", "maildrop.cc", "dispostable.com", "yopmail.com", "yopmail.fr",
        "tempmail.com", "tempr.email", "discard.email", "10minutemail.com", "10minutemail.net",
        "minutemail.com", "mailnull.com", "spamspot.com", "getairmail.com", "filzmail.com",
        "mailnesia.com", "throwam.com", "spamgourmet.com", "temp-mail.org", "throwam.com",
        "getnada.com", "mailsac.com", "inboxbear.com", "spamfree24.org", "trashmail.net",
        "mytemp.email", "burnermail.io", "tempinbox.com", "incognitomail.com",
    })

    @staticmethod
    def _normalize_email(email: str) -> str:
        """Strip +alias and Gmail dots to detect duplicate registrations."""
        email = email.lower().strip()
        local, _, domain = email.partition("@")
        local = local.split("+")[0]
        if domain in {"gmail.com", "googlemail.com"}:
            local = local.replace(".", "")
            domain = "gmail.com"
        return f"{local}@{domain}"

    @staticmethod
    async def _ensure_registration_is_unique(db: AsyncSession, data: TenantOnboardingRequest) -> None:
        existing = await db.execute(select(Tenant).where(Tenant.slug == data.slug))
        if existing.scalar_one_or_none():
            raise ValueError(f"El slug '{data.slug}' ya está en uso")

        email = data.owner_email.lower().strip()
        _, _, domain = email.partition("@")

        if domain in AuthService._DISPOSABLE_DOMAINS:
            raise ValueError("No se permiten correos temporales o desechables.")

        existing_user = await db.execute(select(User).where(User.email == email))
        if existing_user.scalar_one_or_none():
            raise ValueError("El correo ya está registrado")

        normalized = AuthService._normalize_email(email)
        if normalized != email:
            existing_norm = await db.execute(select(User).where(User.email == normalized))
            if existing_norm.scalar_one_or_none():
                raise ValueError("El correo ya está registrado")

    @staticmethod
    def _resolve_license_type(raw_value: str) -> LicenseType:
        license_map = {
            "monthly": LicenseType.MONTHLY,
            "quarterly": LicenseType.QUARTERLY,
            "semi_annual": LicenseType.SEMI_ANNUAL,
            "annual": LicenseType.ANNUAL,
            "perpetual": LicenseType.PERPETUAL,
        }
        return license_map.get(raw_value, LicenseType.MONTHLY)

    @staticmethod
    def _build_auth_payload(user: User) -> dict[str, Any]:
        tenant_id = str(user.tenant_id) if user.tenant_id else None
        access_token = create_access_token(
            subject=str(user.id),
            tenant_id=tenant_id,
            role=user.role.value if isinstance(user.role, UserRole) else user.role,
        )
        refresh_token = create_refresh_token(subject=str(user.id), tenant_id=tenant_id)
        user.refresh_token = refresh_token
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
        }

    @staticmethod
    async def provision_tenant(
        db: AsyncSession,
        data: TenantOnboardingRequest,
        *,
        tenant_status: TenantStatus = TenantStatus.TRIAL,
        tenant_is_active: bool = True,
        trial_days: int = 14,
        license_type: Optional[LicenseType] = None,
        features: Optional[dict[str, Any]] = None,
        max_members: Optional[int] = None,
        max_branches: Optional[int] = None,
        trial_ends_at: Optional[datetime] = None,
        license_expires_at: Optional[datetime] = None,
    ) -> tuple[Tenant, User]:
        await AuthService._ensure_registration_is_unique(db, data)

        resolved_license_type = license_type or AuthService._resolve_license_type(data.license_type)
        if trial_ends_at is None and tenant_status == TenantStatus.TRIAL:
            trial_ends_at = datetime.now(timezone.utc) + timedelta(days=trial_days)

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
            license_type=resolved_license_type,
            status=tenant_status,
            is_active=tenant_is_active,
            trial_ends_at=trial_ends_at,
            license_expires_at=license_expires_at,
            max_members=max_members or 500,
            max_branches=max_branches or 3,
            features=json.dumps(features) if features else None,
        )
        db.add(tenant)
        await db.flush()

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

        branch = Branch(
            tenant_id=tenant.id,
            name=f"{data.gym_name} - Principal",
            address=data.address,
            city=data.city,
        )
        db.add(branch)
        await db.flush()

        return tenant, owner

    @staticmethod
    async def login(db: AsyncSession, data: LoginRequest) -> LoginResponse:
        result = await db.execute(select(User).where(User.email == data.email, User.is_active == True))
        user = result.scalar_one_or_none()

        if not user or not verify_password(data.password, user.hashed_password):
            _auth_logger.warning("login_failed", email=data.email)
            raise ValueError("Correo o contraseña incorrectos")

        # Build tokens unconditionally — credentials are valid
        tokens = AuthService._build_auth_payload(user)
        user.last_login_at = datetime.now(timezone.utc)

        # Check tenant billing status without blocking the login
        billing_status: Optional[str] = None
        next_action: Optional[str] = None
        checkout_url: Optional[str] = None
        widget_token: Optional[str] = None
        checkout_provider: Optional[str] = None
        billing_detail: Optional[str] = None

        if not user.is_superadmin and user.tenant_id:
            tenant = await db.get(Tenant, user.tenant_id)
            if not tenant:
                raise ValueError("La cuenta no existe o está suspendida")

            access_state = evaluate_tenant_access(tenant, now=datetime.now(timezone.utc))

            if not access_state.allow_access:
                # Apply status change without raising
                if access_state.status_to_apply:
                    tenant.status = access_state.status_to_apply
                if access_state.deactivate:
                    tenant.is_active = False

                billing_status = tenant.status.value if isinstance(tenant.status, TenantStatus) else str(tenant.status)
                billing_detail = access_state.detail
                next_action = "billing_required"

                # Try to get checkout URL (Stripe or Fintoc redirect)
                renewable = {TenantStatus.TRIAL, TenantStatus.ACTIVE, TenantStatus.EXPIRED}
                if tenant.status in renewable:
                    try:
                        url = await create_reactivation_checkout(db, tenant, user)
                        if url:
                            checkout_url = url
                            next_action = "redirect_to_checkout"
                    except Exception:
                        pass

        await db.flush()

        return LoginResponse(
            access_token=tokens["access_token"],
            refresh_token=tokens["refresh_token"],
            user=UserResponse.model_validate(user),
            billing_status=billing_status,
            next_action=next_action,
            checkout_url=checkout_url,
            widget_token=widget_token,
            checkout_provider=checkout_provider,
            billing_detail=billing_detail,
        )

    @staticmethod
    async def refresh(db: AsyncSession, refresh_token: str) -> dict:
        try:
            payload = decode_token(refresh_token)
        except ValueError:
            raise ValueError("Token de actualización inválido")

        if payload.get("type") != "refresh":
            raise ValueError("Tipo de token inválido")

        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
        user = result.scalar_one_or_none()

        if not user or user.refresh_token != refresh_token:
            raise ValueError("Token de actualización inválido")

        await AuthService._ensure_user_tenant_access(db, user)
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
    async def request_password_reset(db: AsyncSession, email: str) -> Optional[str]:
        """Returns a reset URL if the user exists; always returns 200 to the caller."""
        result = await db.execute(select(User).where(User.email == email, User.is_active == True))
        user = result.scalar_one_or_none()
        if not user:
            return None
        token = create_password_reset_token(str(user.id))
        cfg = get_settings()
        return f"{cfg.FRONTEND_URL}/reset-password?token={token}"

    @staticmethod
    async def confirm_password_reset(db: AsyncSession, token: str, new_password: str) -> None:
        try:
            payload = decode_token(token)
        except ValueError:
            raise ValueError("El enlace de recuperación es inválido o ha expirado")

        if payload.get("type") != "password_reset":
            raise ValueError("Token inválido")

        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("Usuario no encontrado")

        user.hashed_password = hash_password(new_password)
        user.refresh_token = None  # invalidate all sessions
        user.password_changed_at = datetime.now(timezone.utc)
        await db.flush()

    @staticmethod
    async def register_tenant(db: AsyncSession, data: TenantOnboardingRequest) -> dict:
        """Full tenant onboarding: creates tenant, owner user, default branch."""
        import structlog
        from app.integrations.email.email_service import email_service

        logger = structlog.get_logger()

        tenant, owner = await AuthService.provision_tenant(db, data)
        tokens = AuthService._build_auth_payload(owner)

        # Email de bienvenida — no bloqueante (ignorar fallo silenciosamente)
        try:
            await email_service.send_welcome(
                to_email=owner.email,
                first_name=owner.first_name or data.owner_first_name,
                gym_name=tenant.name,
            )
        except Exception as exc:
            logger.warning("welcome_email_failed", tenant=tenant.slug, exc_info=exc)

        return {
            "tenant": TenantResponse.model_validate(tenant),
            "user": UserResponse.model_validate(owner),
            **tokens,
        }
