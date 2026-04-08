"""Authentication API endpoints."""

import structlog

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.auth import (
    LoginRequest, LoginResponse, RefreshRequest, RegisterRequest,
    TenantOnboardingRequest, UserResponse,
    PasswordResetRequest, PasswordResetConfirm, UserSelfUpdate,
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
async def register_gym(data: TenantOnboardingRequest, db: AsyncSession = Depends(get_db)):
    """Public endpoint for gym onboarding."""
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
    try:
        await AuthService.confirm_password_reset(db, data.token, data.new_password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"detail": "Contraseña actualizada correctamente. Ya puedes iniciar sesión."}
