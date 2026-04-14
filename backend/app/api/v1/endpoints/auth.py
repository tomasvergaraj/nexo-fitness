"""Authentication API endpoints."""

import hashlib
import json
import secrets
import structlog

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.security import create_email_verified_token
from app.models.user import User
from app.schemas.auth import (
    LoginRequest, LoginResponse, RefreshRequest, RegisterRequest,
    TenantOnboardingRequest, UserResponse,
    PasswordResetRequest, PasswordResetConfirm, PasswordChangeRequest,
    PasswordChangeResponse, UserSelfUpdate,
)
from app.integrations.email.email_service import email_service
from app.services.auth_service import AuthService

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
