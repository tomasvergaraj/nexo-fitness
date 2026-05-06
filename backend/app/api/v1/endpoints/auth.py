"""Authentication API endpoints."""

import hashlib
import json
import secrets
import structlog

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.security import create_email_verified_token, decode_staff_invitation_token, hash_password as _hash_password
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.schemas.auth import (
    LoginRequest, LoginResponse, RefreshRequest, RegisterRequest,
    TenantOnboardingRequest, UserResponse,
    PasswordResetRequest, PasswordResetConfirm, PasswordChangeRequest,
    PasswordChangeResponse, UserSelfUpdate,
    MfaVerifyRequest,
    TwoFactorDisableRequest,
    TwoFactorRegenerateRequest, TwoFactorRegenerateResponse,
    TwoFactorSetupResponse,
    TwoFactorStatusResponse,
    TwoFactorVerifySetupRequest, TwoFactorVerifySetupResponse,
)
from app.integrations.email.email_service import email_service
from app.services.auth_service import AuthService
from app.services import totp_service

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = structlog.get_logger()
settings = get_settings()


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await AuthService.login(db, data)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))


@router.post("/refresh")
async def refresh_token(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await AuthService.refresh(db, data.refresh_token)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))


@router.post("/register-gym")
async def register_gym(request: Request, data: TenantOnboardingRequest, db: AsyncSession = Depends(get_db)):
    """Public endpoint for gym onboarding."""
    client_ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
    redis = await _get_redis()
    rate_key = f"reg_rate:{client_ip}"
    count = await redis.incr(rate_key)
    if count == 1:
        await redis.expire(rate_key, 3600)
    await redis.aclose()
    if count > 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de registro desde esta dirección. Intenta de nuevo en una hora.",
        )
    try:
        return await AuthService.register_tenant(db, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    data: UserSelfUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    await db.flush()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    current_user.refresh_token = None
    await db.flush()
    return {"message": "Logged out successfully"}


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(data: PasswordResetRequest, db: AsyncSession = Depends(get_db)):
    """Always returns 202 regardless of whether the email exists (prevents user enumeration)."""
    reset_url = await AuthService.request_password_reset(db, data.email)
    if reset_url:
        email_sent = await email_service.send_password_reset(to_email=data.email, reset_url=reset_url)
        if not email_sent and settings.APP_ENV != "production":
            logger.info("password_reset_debug_url", email=data.email, reset_url=reset_url)
    return {"detail": "Si el correo existe, recibirás un enlace para restablecer tu contraseña."}


@router.post("/reset-password")
async def reset_password(data: PasswordResetConfirm, db: AsyncSession = Depends(get_db)):
    token_hash = hashlib.sha256(data.token.encode()).hexdigest()
    redis = await _get_redis()
    already_used = await redis.exists(f"pwd_reset_used:{token_hash}")
    if already_used:
        await redis.aclose()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este enlace ya fue utilizado. Solicita un nuevo correo de recuperación.",
        )
    try:
        await AuthService.confirm_password_reset(db, data.token, data.new_password)
    except ValueError as e:
        await redis.aclose()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    # Burn the token — TTL matches the 15-min expiry of the JWT
    await redis.set(f"pwd_reset_used:{token_hash}", "1", ex=900)
    await redis.aclose()
    return {"detail": "Contraseña actualizada correctamente. Ya puedes iniciar sesión."}


@router.post("/change-password", response_model=PasswordChangeResponse)
async def change_password(
    data: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        tokens = await AuthService.change_password(
            db,
            current_user,
            current_password=data.current_password,
            new_password=data.new_password,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return PasswordChangeResponse(
        detail="Contraseña actualizada correctamente.",
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
        token_type=tokens["token_type"],
    )


# ── Email verification (OTP) ─────────────────────────────────────────────────

class EmailVerificationSendRequest(BaseModel):
    email: EmailStr


class EmailVerificationConfirmRequest(BaseModel):
    email: EmailStr
    code: str


def _redis_otp_key(email: str) -> str:
    return f"email_verify:{email.lower().strip()}"


async def _get_redis():
    import redis.asyncio as aioredis
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


def _get_staff_invitation_status_message(status_value: str | None) -> str:
    if status_value == "accepted":
        return "Esta invitación ya fue aceptada."
    if status_value == "invalidated":
        return "Esta invitación fue invalidada. Solicita una nueva invitación."
    return "Esta invitación ya no es válida."


def _can_reactivate_staff_invitation(existing_user: User | None, tenant_id: str) -> bool:
    if not existing_user:
        return False
    if existing_user.is_active:
        return False
    if str(existing_user.tenant_id) != str(tenant_id):
        return False
    return existing_user.role in {
        UserRole.ADMIN,
        UserRole.RECEPTION,
        UserRole.TRAINER,
        UserRole.MARKETING,
    }


@router.post("/email-verification/send", status_code=status.HTTP_200_OK)
async def send_email_verification(
    data: EmailVerificationSendRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Check if email is already registered.
    - If yes → return {exists: true} (caller can redirect to login).
    - If no  → generate 6-digit OTP, store in Redis (10 min TTL), send email
               → return {exists: false, sent: true}.
    """
    email = data.email.lower().strip()

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        return {"exists": True}

    redis = await _get_redis()

    # Rate limit: max 3 OTP sends per email per 10 minutes
    rate_key = f"otp_rate:{email}"
    send_count = await redis.incr(rate_key)
    if send_count == 1:
        await redis.expire(rate_key, 600)
    if send_count > 3:
        await redis.aclose()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas solicitudes. Espera 10 minutos antes de solicitar otro código.",
        )

    code = f"{secrets.randbelow(1_000_000):06d}"

    key = _redis_otp_key(email)
    payload = json.dumps({"code": code, "attempts": 0})
    await redis.set(key, payload, ex=600)  # 10 minutes
    await redis.aclose()

    sent = await email_service.send_email_verification(to_email=email, code=code)
    if not sent and settings.APP_ENV != "production":
        logger.info("email_verification_debug_code", email=email, code=code)

    return {"exists": False, "sent": True}


@router.post("/email-verification/confirm", status_code=status.HTTP_200_OK)
async def confirm_email_verification(data: EmailVerificationConfirmRequest):
    """
    Validate the OTP code. On success returns a short-lived JWT verification token
    that the frontend must attach to the signup/checkout request.
    """
    email = data.email.lower().strip()
    key = _redis_otp_key(email)

    redis = await _get_redis()
    raw = await redis.get(key)

    if not raw:
        await redis.aclose()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El código ha expirado o no existe. Solicita uno nuevo.",
        )

    stored = json.loads(raw)
    attempts: int = stored.get("attempts", 0)

    if attempts >= 5:
        await redis.delete(key)
        await redis.aclose()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos fallidos. Solicita un nuevo código.",
        )

    if stored["code"] != data.code.strip():
        stored["attempts"] = attempts + 1
        ttl = await redis.ttl(key)
        await redis.set(key, json.dumps(stored), ex=max(ttl, 1))
        await redis.aclose()
        remaining = 5 - stored["attempts"]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Código incorrecto. Te quedan {remaining} intento{'s' if remaining != 1 else ''}.",
        )

    await redis.delete(key)
    await redis.aclose()

    verified_token = create_email_verified_token(email)
    return {"verified_token": verified_token}


# ── Staff Invitation ──────────────────────────────────────────────────────────

class AcceptInvitationRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)

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


@router.get("/invitation/{token}")
async def get_invitation_info(token: str, db: AsyncSession = Depends(get_db)):
    """Public endpoint — validate an invitation token and return its metadata."""
    import hashlib as _hl
    try:
        payload = decode_staff_invitation_token(token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Check not already used
    token_hash = _hl.sha256(token.encode()).hexdigest()
    redis = await _get_redis()
    invite_status = await redis.get(f"staff_invite_used:{token_hash}")
    await redis.aclose()
    if invite_status:
        raise HTTPException(status_code=400, detail=_get_staff_invitation_status_message(invite_status))

    # Check email not already registered
    email = payload["sub"]
    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing and not _can_reactivate_staff_invitation(existing, str(payload["tenant_id"])):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese correo.")

    role_labels = {
        "admin": "Administrador", "reception": "Recepción",
        "trainer": "Entrenador", "marketing": "Marketing",
    }
    tenant = (await db.execute(select(Tenant).where(Tenant.id == payload["tenant_id"]))).scalar_one_or_none()

    return {
        "email": email,
        "first_name": payload.get("first_name", ""),
        "last_name": payload.get("last_name", ""),
        "role": payload["role"],
        "role_label": role_labels.get(payload["role"], payload["role"]),
        "gym_name": tenant.name if tenant else "el gimnasio",
        "invited_by": payload.get("invited_by", ""),
    }


@router.post("/accept-invitation")
async def accept_invitation(data: AcceptInvitationRequest, db: AsyncSession = Depends(get_db)):
    """Public endpoint — accept a staff invitation and create the account."""
    import hashlib as _hl
    try:
        payload = decode_staff_invitation_token(data.token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    token_hash = _hl.sha256(data.token.encode()).hexdigest()
    redis = await _get_redis()
    invite_status = await redis.get(f"staff_invite_used:{token_hash}")
    if invite_status:
        await redis.aclose()
        raise HTTPException(status_code=400, detail=_get_staff_invitation_status_message(invite_status))

    email = payload["sub"]
    tenant_id = payload["tenant_id"]
    role = payload["role"]

    # Double-check email not taken, unless this invitation is reactivating
    # an inactive staff member from the same tenant.
    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    can_reactivate_existing_staff = _can_reactivate_staff_invitation(existing, tenant_id)
    if existing and not can_reactivate_existing_staff:
        await redis.aclose()
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese correo.")

    if can_reactivate_existing_staff and existing:
        existing.hashed_password = _hash_password(data.password)
        existing.first_name = payload.get("first_name", existing.first_name)
        existing.last_name = payload.get("last_name", existing.last_name)
        existing.role = UserRole(role)
        existing.is_active = True
        existing.is_verified = True
        existing.refresh_token = None
        user_record = existing
    else:
        user_record = User(
            tenant_id=tenant_id,
            email=email,
            hashed_password=_hash_password(data.password),
            first_name=payload.get("first_name", ""),
            last_name=payload.get("last_name", ""),
            role=UserRole(role),
            is_active=True,
            is_verified=True,
        )
        db.add(user_record)

    await db.flush()
    await db.refresh(user_record)

    # Burn invitation token (TTL=259200 = 72h)
    await redis.set(f"staff_invite_used:{token_hash}", "accepted", ex=259200)
    # Remove pending markers and list metadata
    await redis.delete(f"staff_invite_pending:{tenant_id}:{email}")
    await redis.delete(f"staff_invite_meta:{tenant_id}:{email}")
    await redis.srem(f"staff_invite_list:{tenant_id}", email)
    await redis.aclose()

    return {
        "detail": (
            "Acceso reactivado exitosamente. Ya puedes iniciar sesión."
            if can_reactivate_existing_staff
            else "Cuenta activada exitosamente. Ya puedes iniciar sesión."
        ),
        "email": email,
    }


# ── 2FA (TOTP) ───────────────────────────────────────────────────────────────

_TWO_FA_SETUP_TTL = 600  # 10 minutes for the user to scan + verify
_TWO_FA_VERIFY_RATE_LIMIT = 10  # max attempts per 15 min window


def _redis_2fa_setup_key(user_id) -> str:
    return f"2fa_setup:{user_id}"


def _redis_2fa_attempts_key(user_id) -> str:
    return f"2fa_attempts:{user_id}"


async def _check_2fa_rate_limit(redis, user_id) -> int:
    """Return remaining attempts; raise 429 if exceeded."""
    key = _redis_2fa_attempts_key(user_id)
    attempts = await redis.incr(key)
    if attempts == 1:
        await redis.expire(key, 900)  # 15 min window
    remaining = _TWO_FA_VERIFY_RATE_LIMIT - attempts
    if remaining < 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos. Intenta nuevamente en 15 minutos.",
        )
    return max(0, remaining)


@router.get("/2fa/status", response_model=TwoFactorStatusResponse)
async def get_2fa_status(current_user: User = Depends(get_current_user)):
    return TwoFactorStatusResponse(
        enabled=bool(current_user.two_factor_enabled),
        verified_at=current_user.two_factor_verified_at,
        backup_codes_remaining=totp_service.remaining_backup_codes(current_user.backup_codes),
    )


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
async def start_2fa_setup(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a fresh TOTP secret and store it in Redis (not yet activated)."""
    if current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA ya está activado. Desactiva primero para regenerar.",
        )

    secret = totp_service.generate_secret()
    redis = await _get_redis()
    await redis.set(_redis_2fa_setup_key(current_user.id), secret, ex=_TWO_FA_SETUP_TTL)
    await redis.aclose()

    issuer = "NexoFitness"
    if current_user.tenant_id:
        tenant = await db.get(Tenant, current_user.tenant_id)
        if tenant and tenant.name:
            issuer = tenant.name
    uri = totp_service.provisioning_uri(secret, account_name=current_user.email, issuer_name=issuer)

    return TwoFactorSetupResponse(
        secret=secret,
        provisioning_uri=uri,
        issuer=issuer,
        account=current_user.email,
    )


@router.post("/2fa/verify-setup", response_model=TwoFactorVerifySetupResponse)
async def verify_2fa_setup(
    data: TwoFactorVerifySetupRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm enrollment: verify TOTP code, persist secret, return backup codes."""
    if current_user.two_factor_enabled:
        raise HTTPException(status_code=400, detail="2FA ya está activado.")

    redis = await _get_redis()
    pending_secret = await redis.get(_redis_2fa_setup_key(current_user.id))
    if not pending_secret:
        await redis.aclose()
        raise HTTPException(
            status_code=400,
            detail="La configuración expiró. Reinicia el proceso desde el paso 1.",
        )

    if not totp_service.verify_code(pending_secret, data.code):
        await redis.aclose()
        raise HTTPException(status_code=400, detail="Código incorrecto. Intenta nuevamente.")

    plaintext_codes, hashes_json = totp_service.generate_backup_codes()
    from datetime import datetime as _dt, timezone as _tz
    now_utc = _dt.now(_tz.utc)
    current_user.two_factor_secret = totp_service.encrypt_secret(pending_secret)
    current_user.two_factor_enabled = True
    current_user.two_factor_verified_at = now_utc
    current_user.backup_codes = hashes_json
    await db.commit()

    await redis.delete(_redis_2fa_setup_key(current_user.id))
    await redis.aclose()

    logger.info("2fa_enabled", user_id=str(current_user.id))
    try:
        await email_service.send_2fa_changed(
            to_email=current_user.email,
            first_name=current_user.first_name,
            action="enabled",
            when=now_utc,
        )
    except Exception as exc:
        logger.warning("2fa_email_failed", action="enabled", exc_info=exc)

    return TwoFactorVerifySetupResponse(
        detail="2FA activado correctamente. Guarda los códigos de respaldo en un lugar seguro.",
        backup_codes=plaintext_codes,
    )


def _verify_user_code(user: User, submitted: str) -> tuple[bool, bool]:
    """Returns (ok, used_backup). Backup code is consumed (DB caller commits)."""
    secret = totp_service.decrypt_secret(user.two_factor_secret) if user.two_factor_secret else None
    if secret and totp_service.verify_code(secret, submitted):
        return True, False
    new_storage = totp_service.consume_backup_code(user.backup_codes, submitted)
    if new_storage is not None:
        user.backup_codes = new_storage
        return True, True
    return False, False


@router.post("/2fa/disable")
async def disable_2fa(
    data: TwoFactorDisableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.core.security import verify_password

    if not current_user.two_factor_enabled:
        raise HTTPException(status_code=400, detail="2FA no está activado.")
    if not verify_password(data.password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Contraseña incorrecta.")

    redis = await _get_redis()
    await _check_2fa_rate_limit(redis, current_user.id)
    await redis.aclose()

    ok, _ = _verify_user_code(current_user, data.code)
    if not ok:
        raise HTTPException(status_code=400, detail="Código incorrecto.")

    from datetime import datetime as _dt, timezone as _tz
    now_utc = _dt.now(_tz.utc)
    current_user.two_factor_enabled = False
    current_user.two_factor_secret = None
    current_user.two_factor_verified_at = None
    current_user.backup_codes = None
    await db.commit()

    logger.info("2fa_disabled", user_id=str(current_user.id))
    try:
        await email_service.send_2fa_changed(
            to_email=current_user.email,
            first_name=current_user.first_name,
            action="disabled",
            when=now_utc,
        )
    except Exception as exc:
        logger.warning("2fa_email_failed", action="disabled", exc_info=exc)
    return {"detail": "2FA desactivado correctamente."}


@router.post("/2fa/regenerate-backup-codes", response_model=TwoFactorRegenerateResponse)
async def regenerate_2fa_backup_codes(
    data: TwoFactorRegenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.two_factor_enabled:
        raise HTTPException(status_code=400, detail="2FA no está activado.")

    redis = await _get_redis()
    await _check_2fa_rate_limit(redis, current_user.id)
    await redis.aclose()

    ok, _ = _verify_user_code(current_user, data.code)
    if not ok:
        raise HTTPException(status_code=400, detail="Código incorrecto.")

    plaintext_codes, hashes_json = totp_service.generate_backup_codes()
    current_user.backup_codes = hashes_json
    await db.commit()

    logger.info("2fa_backup_codes_regenerated", user_id=str(current_user.id))
    from datetime import datetime as _dt, timezone as _tz
    try:
        await email_service.send_2fa_changed(
            to_email=current_user.email,
            first_name=current_user.first_name,
            action="backup_regenerated",
            when=_dt.now(_tz.utc),
        )
    except Exception as exc:
        logger.warning("2fa_email_failed", action="backup_regenerated", exc_info=exc)
    return TwoFactorRegenerateResponse(backup_codes=plaintext_codes)


@router.post("/login/verify", response_model=LoginResponse)
async def verify_mfa_login(
    data: MfaVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await AuthService.complete_mfa_login(
            db,
            mfa_token=data.mfa_token,
            code=data.code,
            is_backup_code=data.is_backup_code,
            remember_device=data.remember_device,
            device_label=data.device_label,
            user_agent=request.headers.get("user-agent"),
            ip_address=(request.client.host if request.client else None),
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))


class MfaSetupTokenRequest(BaseModel):
    mfa_token: str = Field(min_length=10, max_length=128)


class MfaSetupVerifyTokenRequest(BaseModel):
    mfa_token: str = Field(min_length=10, max_length=128)
    code: str = Field(min_length=6, max_length=10)


@router.post("/login/setup-2fa", response_model=TwoFactorSetupResponse)
async def login_start_2fa_setup(data: MfaSetupTokenRequest, db: AsyncSession = Depends(get_db)):
    """Used during the forced-enrollment login flow (next_action='2fa_setup_required')."""
    try:
        result = await AuthService.start_2fa_setup_with_token(db, mfa_token=data.mfa_token)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
    return TwoFactorSetupResponse(**result)


class MfaForcedSetupResponse(LoginResponse):
    backup_codes: list[str]


@router.post("/login/verify-setup-2fa", response_model=MfaForcedSetupResponse)
async def login_verify_2fa_setup(data: MfaSetupVerifyTokenRequest, db: AsyncSession = Depends(get_db)):
    try:
        login_response, backup_codes = await AuthService.complete_2fa_setup_with_token(
            db,
            mfa_token=data.mfa_token,
            code=data.code,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))

    return MfaForcedSetupResponse(
        **login_response.model_dump(),
        backup_codes=backup_codes,
    )


# ── Trusted devices ──────────────────────────────────────────────────────────

from app.schemas.auth import TrustedDeviceResponse  # noqa: E402
from app.services import trusted_device_service  # noqa: E402
from uuid import UUID  # noqa: E402


@router.get("/2fa/trusted-devices", response_model=list[TrustedDeviceResponse])
async def list_trusted_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    devices = await trusted_device_service.list_devices(db, current_user.id)
    return [TrustedDeviceResponse.model_validate(d) for d in devices]


@router.delete("/2fa/trusted-devices/{device_id}", status_code=204)
async def revoke_trusted_device(
    device_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    removed = await trusted_device_service.revoke_device(db, user_id=current_user.id, device_id=device_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")
    await db.commit()


@router.delete("/2fa/trusted-devices", status_code=204)
async def revoke_all_trusted_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await trusted_device_service.revoke_all_devices(db, current_user.id)
    await db.commit()
