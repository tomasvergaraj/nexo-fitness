"""Trusted-device management for 2FA "remember this device" UX.

Tokens are random 32-byte URL-safe strings. The plaintext is sent ONCE to the
client (stored in localStorage) and only its SHA-256 hash is persisted.
Lookup by hash on each login.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import UserTrustedDevice


TRUSTED_DEVICE_TTL_DAYS = 30


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _truncate(value: Optional[str], limit: int) -> Optional[str]:
    if value is None:
        return None
    return value[:limit]


async def issue_trusted_device(
    db: AsyncSession,
    *,
    user_id: UUID,
    tenant_id: Optional[UUID],
    label: Optional[str],
    user_agent: Optional[str],
    ip_address: Optional[str],
    ttl_days: int = TRUSTED_DEVICE_TTL_DAYS,
) -> str:
    """Persist a new trusted device and return the plaintext token."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    device = UserTrustedDevice(
        user_id=user_id,
        tenant_id=tenant_id,
        token_hash=_hash_token(token),
        label=_truncate(label or _label_from_user_agent(user_agent), 100),
        user_agent=_truncate(user_agent, 500),
        ip_address=_truncate(ip_address, 64),
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(days=ttl_days),
    )
    db.add(device)
    await db.flush()
    return token


async def find_active_device(
    db: AsyncSession, *, user_id: UUID, token: str
) -> Optional[UserTrustedDevice]:
    if not token:
        return None
    token_hash = _hash_token(token)
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(UserTrustedDevice).where(
            UserTrustedDevice.user_id == user_id,
            UserTrustedDevice.token_hash == token_hash,
            UserTrustedDevice.expires_at > now,
        )
    )
    return result.scalar_one_or_none()


async def touch_device(db: AsyncSession, device: UserTrustedDevice) -> None:
    device.last_used_at = datetime.now(timezone.utc)
    await db.flush()


async def list_devices(db: AsyncSession, user_id: UUID) -> list[UserTrustedDevice]:
    result = await db.execute(
        select(UserTrustedDevice)
        .where(
            UserTrustedDevice.user_id == user_id,
            UserTrustedDevice.expires_at > datetime.now(timezone.utc),
        )
        .order_by(UserTrustedDevice.last_used_at.desc().nullslast())
    )
    return list(result.scalars().all())


async def revoke_device(db: AsyncSession, *, user_id: UUID, device_id: UUID) -> bool:
    result = await db.execute(
        delete(UserTrustedDevice).where(
            UserTrustedDevice.id == device_id,
            UserTrustedDevice.user_id == user_id,
        )
    )
    await db.flush()
    return (result.rowcount or 0) > 0


async def revoke_all_devices(db: AsyncSession, user_id: UUID) -> int:
    result = await db.execute(
        delete(UserTrustedDevice).where(UserTrustedDevice.user_id == user_id)
    )
    await db.flush()
    return result.rowcount or 0


def _label_from_user_agent(ua: Optional[str]) -> str:
    if not ua:
        return "Dispositivo"
    ua_low = ua.lower()
    if "android" in ua_low:
        return "Android"
    if "iphone" in ua_low or "ipad" in ua_low or "ios" in ua_low:
        return "iOS"
    if "macintosh" in ua_low or "mac os" in ua_low:
        return "Mac"
    if "windows" in ua_low:
        return "Windows"
    if "linux" in ua_low:
        return "Linux"
    return "Dispositivo"
