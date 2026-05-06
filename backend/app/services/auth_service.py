"""Authentication and tenant onboarding service."""

import json
import secrets as _secrets
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

    # ── 2FA helpers ──────────────────────────────────────────────────────────

    _STAFF_ROLES_ENFORCED = {UserRole.OWNER, UserRole.ADMIN, UserRole.RECEPTION, UserRole.TRAINER, UserRole.MARKETING}
    _MFA_TOKEN_TTL_VERIFY = 300   # 5 minutes
    _MFA_TOKEN_TTL_SETUP = 900    # 15 minutes
    _MFA_MAX_ATTEMPTS = 5

    @staticmethod
    async def _get_redis_client():
        import redis.asyncio as aioredis
        return aioredis.from_url(get_settings().REDIS_URL, decode_responses=True)

    @staticmethod
    def _tenant_features(tenant: Optional[Tenant]) -> dict:
        if not tenant or not tenant.features:
            return {}
        try:
            return json.loads(tenant.features) if isinstance(tenant.features, str) else dict(tenant.features)
        except (TypeError, ValueError):
            return {}

    @staticmethod
    def _user_role_value(user: User) -> Optional[UserRole]:
        if isinstance(user.role, UserRole):
            return user.role
        try:
            return UserRole(user.role)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _requires_2fa(user: User, tenant: Optional[Tenant]) -> tuple[bool, bool]:
        """Returns (requires_verify, requires_setup).

        - requires_verify: user already has 2FA enabled → must enter TOTP/backup code.
        - requires_setup: tenant forces 2FA, user is staff, but has not enrolled yet.
        """
        if user.is_superadmin:
            return (bool(user.two_factor_enabled), False)
        if user.two_factor_enabled:
            return (True, False)
        role = AuthService._user_role_value(user)
        if role and role in AuthService._STAFF_ROLES_ENFORCED:
            features = AuthService._tenant_features(tenant)
            if bool(features.get("two_factor_required", False)):
                return (False, True)
        return (False, False)

    @staticmethod
    async def _store_mfa_token(*, user_id: str, tenant_id: Optional[str], purpose: str) -> str:
        token = _secrets.token_urlsafe(32)
        ttl = (
            AuthService._MFA_TOKEN_TTL_SETUP
            if purpose == "setup"
            else AuthService._MFA_TOKEN_TTL_VERIFY
        )
        payload = json.dumps({
            "user_id": str(user_id),
            "tenant_id": str(tenant_id) if tenant_id else None,
            "purpose": purpose,
            "attempts": 0,
        })
        redis = await AuthService._get_redis_client()
        try:
            await redis.set(f"mfa_token:{token}", payload, ex=ttl)
        finally:
            await redis.aclose()
        return token

    @staticmethod
    async def _consume_mfa_token(token: str, *, expected_purpose: Optional[str] = None) -> dict:
        redis = await AuthService._get_redis_client()
        try:
            raw = await redis.get(f"mfa_token:{token}")
            if not raw:
                raise ValueError("Sesión MFA expirada. Inicia sesión de nuevo.")
            data = json.loads(raw)
            if expected_purpose and data.get("purpose") != expected_purpose:
                raise ValueError("Token MFA inválido para esta operación.")
            return data
        finally:
            await redis.aclose()

    @staticmethod
    async def _delete_mfa_token(token: str) -> None:
        redis = await AuthService._get_redis_client()
        try:
            await redis.delete(f"mfa_token:{token}")
        finally:
            await redis.aclose()

    @staticmethod
    async def _bump_mfa_attempts(token: str, data: dict) -> int:
        """Increment attempts, invalidate if over limit. Returns remaining."""
        redis = await AuthService._get_redis_client()
        try:
            ttl = await redis.ttl(f"mfa_token:{token}")
            data["attempts"] = int(data.get("attempts", 0)) + 1
            remaining = AuthService._MFA_MAX_ATTEMPTS - data["attempts"]
            if remaining < 0:
                await redis.delete(f"mfa_token:{token}")
                raise ValueError("Demasiados intentos. Inicia sesión nuevamente.")
            await redis.set(f"mfa_token:{token}", json.dumps(data), ex=max(ttl, 30))
            return remaining
        finally:
            await redis.aclose()

    # ── Login ────────────────────────────────────────────────────────────────

    @staticmethod
    async def login(db: AsyncSession, data: LoginRequest) -> LoginResponse:
        result = await db.execute(select(User).where(User.email == data.email, User.is_active == True))
        user = result.scalar_one_or_none()

        if not user or not verify_password(data.password, user.hashed_password):
            _auth_logger.warning("login_failed", email=data.email)
            raise ValueError("Correo o contraseña incorrectos")

        tenant: Optional[Tenant] = None
        if not user.is_superadmin and user.tenant_id:
            tenant = await db.get(Tenant, user.tenant_id)
            if not tenant:
                raise ValueError("La cuenta no existe o está suspendida")

        # Decide if 2FA gates the response
        requires_verify, requires_setup = AuthService._requires_2fa(user, tenant)

        # If a trusted device token bypasses verify, skip the gate
        if requires_verify and data.device_token:
            from app.services.trusted_device_service import find_active_device, touch_device
            device = await find_active_device(db, user_id=user.id, token=data.device_token)
            if device:
                await touch_device(db, device)
                return await AuthService._finalize_login(db, user, tenant)

        if requires_verify or requires_setup:
            purpose = "verify" if requires_verify else "setup"
            mfa_token = await AuthService._store_mfa_token(
                user_id=str(user.id),
                tenant_id=str(user.tenant_id) if user.tenant_id else None,
                purpose=purpose,
            )
            return LoginResponse(
                next_action="mfa_required" if requires_verify else "2fa_setup_required",
                mfa_token=mfa_token,
                mfa_attempts_remaining=AuthService._MFA_MAX_ATTEMPTS if requires_verify else None,
            )

        # No 2FA gate — issue tokens directly
        return await AuthService._finalize_login(db, user, tenant)

    @staticmethod
    async def _finalize_login(db: AsyncSession, user: User, tenant: Optional[Tenant]) -> LoginResponse:
        tokens = AuthService._build_auth_payload(user)
        user.last_login_at = datetime.now(timezone.utc)

        billing_status: Optional[str] = None
        next_action: Optional[str] = None
        checkout_url: Optional[str] = None
        widget_token: Optional[str] = None
        checkout_provider: Optional[str] = None
        billing_detail: Optional[str] = None

        if tenant is not None:
            access_state = evaluate_tenant_access(tenant, now=datetime.now(timezone.utc))
            if not access_state.allow_access:
                if access_state.status_to_apply:
                    tenant.status = access_state.status_to_apply
                if access_state.deactivate:
                    tenant.is_active = False
                billing_status = tenant.status.value if isinstance(tenant.status, TenantStatus) else str(tenant.status)
                billing_detail = access_state.detail
                next_action = "billing_required"

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
    async def start_2fa_setup_with_token(db: AsyncSession, mfa_token: str) -> dict:
        """Used during forced enrollment after login. Returns secret + URI."""
        from app.services import totp_service

        data = await AuthService._consume_mfa_token(mfa_token, expected_purpose="setup")
        user = await db.get(User, uuid.UUID(data["user_id"]))
        if not user or not user.is_active:
            raise ValueError("Usuario no encontrado o inactivo")
        if user.two_factor_enabled:
            raise ValueError("2FA ya está activado")

        secret = totp_service.generate_secret()
        # Stash the in-progress secret alongside the mfa_token (do not modify the token itself)
        redis = await AuthService._get_redis_client()
        try:
            await redis.set(
                f"mfa_setup_pending:{mfa_token}",
                secret,
                ex=AuthService._MFA_TOKEN_TTL_SETUP,
            )
        finally:
            await redis.aclose()

        issuer = "NexoFitness"
        if user.tenant_id:
            tenant = await db.get(Tenant, user.tenant_id)
            if tenant and tenant.name:
                issuer = tenant.name
        uri = totp_service.provisioning_uri(secret, account_name=user.email, issuer_name=issuer)
        return {"secret": secret, "provisioning_uri": uri, "issuer": issuer, "account": user.email}

    @staticmethod
    async def complete_2fa_setup_with_token(db: AsyncSession, mfa_token: str, code: str) -> tuple[LoginResponse, list[str]]:
        from app.services import totp_service

        data = await AuthService._consume_mfa_token(mfa_token, expected_purpose="setup")
        user = await db.get(User, uuid.UUID(data["user_id"]))
        if not user or not user.is_active:
            raise ValueError("Usuario no encontrado o inactivo")
        if user.two_factor_enabled:
            raise ValueError("2FA ya está activado")

        redis = await AuthService._get_redis_client()
        try:
            pending_secret = await redis.get(f"mfa_setup_pending:{mfa_token}")
        finally:
            await redis.aclose()
        if not pending_secret:
            raise ValueError("La configuración expiró. Inicia sesión de nuevo.")

        if not totp_service.verify_code(pending_secret, code):
            await AuthService._bump_mfa_attempts(mfa_token, data)
            raise ValueError("Código incorrecto. Intenta nuevamente.")

        plaintext_codes, hashes_json = totp_service.generate_backup_codes()
        now_utc = datetime.now(timezone.utc)
        user.two_factor_secret = totp_service.encrypt_secret(pending_secret)
        user.two_factor_enabled = True
        user.two_factor_verified_at = now_utc
        user.backup_codes = hashes_json
        await db.flush()

        await AuthService._delete_mfa_token(mfa_token)
        redis = await AuthService._get_redis_client()
        try:
            await redis.delete(f"mfa_setup_pending:{mfa_token}")
        finally:
            await redis.aclose()

        try:
            from app.integrations.email.email_service import email_service as _email
            await _email.send_2fa_changed(
                to_email=user.email,
                first_name=user.first_name,
                action="enabled",
                when=now_utc,
            )
        except Exception as exc:
            _auth_logger.warning("2fa_email_failed", action="enabled", exc_info=exc)

        tenant: Optional[Tenant] = None
        if user.tenant_id:
            tenant = await db.get(Tenant, user.tenant_id)
        login_response = await AuthService._finalize_login(db, user, tenant)
        return login_response, plaintext_codes

    @staticmethod
    async def complete_mfa_login(
        db: AsyncSession,
        *,
        mfa_token: str,
        code: str,
        is_backup_code: bool,
        remember_device: bool = False,
        device_label: Optional[str] = None,
        user_agent: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> LoginResponse:
        from app.services import totp_service

        data = await AuthService._consume_mfa_token(mfa_token, expected_purpose="verify")
        remaining = await AuthService._bump_mfa_attempts(mfa_token, data)

        user = await db.get(User, uuid.UUID(data["user_id"]))
        if not user or not user.is_active:
            raise ValueError("Usuario no encontrado o inactivo")
        if not user.two_factor_enabled:
            raise ValueError("2FA no está activado para este usuario")

        ok = False
        if is_backup_code:
            new_storage = totp_service.consume_backup_code(user.backup_codes, code)
            if new_storage is not None:
                user.backup_codes = new_storage
                ok = True
        else:
            secret = totp_service.decrypt_secret(user.two_factor_secret) if user.two_factor_secret else None
            ok = bool(secret and totp_service.verify_code(secret, code))

        if not ok:
            _auth_logger.warning("mfa_verify_failed", user_id=str(user.id), remaining=remaining)
            err = ValueError(f"Código incorrecto. Intentos restantes: {remaining}.")
            raise err

        await AuthService._delete_mfa_token(mfa_token)
        tenant: Optional[Tenant] = None
        if user.tenant_id:
            tenant = await db.get(Tenant, user.tenant_id)

        device_token: Optional[str] = None
        if remember_device:
            from app.services.trusted_device_service import issue_trusted_device
            device_token = await issue_trusted_device(
                db,
                user_id=user.id,
                tenant_id=user.tenant_id,
                label=device_label,
                user_agent=user_agent,
                ip_address=ip_address,
            )

        login_response = await AuthService._finalize_login(db, user, tenant)
        if device_token:
            login_response.trusted_device_token = device_token
        return login_response

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
    async def change_password(
        db: AsyncSession,
        user: User,
        *,
        current_password: str,
        new_password: str,
    ) -> dict[str, Any]:
        if not verify_password(current_password, user.hashed_password):
            raise ValueError("La contraseña actual es incorrecta")

        if current_password == new_password:
            raise ValueError("La nueva contraseña debe ser distinta a la actual")

        user.hashed_password = hash_password(new_password)
        user.password_changed_at = datetime.now(timezone.utc)
        tokens = AuthService._build_auth_payload(user)
        await db.flush()
        return tokens

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
