"""Security utilities: password hashing, JWT token management."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Optional

import bcrypt as bcrypt_module
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

settings = get_settings()


def _ensure_bcrypt_metadata() -> None:
    """Backfill bcrypt metadata expected by passlib 1.7.x."""
    if hasattr(bcrypt_module, "__about__"):
        return

    version = getattr(bcrypt_module, "__version__", None)
    if version is None:
        return

    bcrypt_module.__about__ = SimpleNamespace(__version__=version)


_ensure_bcrypt_metadata()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(
    subject: str,
    tenant_id: Optional[str] = None,
    role: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": subject,
        "exp": expires,
        "type": "access",
    }
    if tenant_id:
        payload["tenant_id"] = tenant_id
    if role:
        payload["role"] = role
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(subject: str, tenant_id: Optional[str] = None) -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": subject,
        "exp": expires,
        "type": "refresh",
    }
    if tenant_id:
        payload["tenant_id"] = tenant_id
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_password_reset_token(user_id: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    payload = {"sub": user_id, "exp": expires, "type": "password_reset"}
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        raise ValueError("Token inválido o vencido")
