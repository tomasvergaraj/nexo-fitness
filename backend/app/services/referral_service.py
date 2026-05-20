"""Servicio del programa de referidos (Fase 6.4).

Responsabilidades:
- Generar un `User.referral_code` único e idempotente al primer pago
  completado del cliente.
- Resolver `referrer_user_id` desde un código entregado por la storefront.
- Conteo simple de referidos para mostrar en MemberApp.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole


_REFERRAL_CODE_LENGTH = 5  # 16^5 ≈ 1M combinaciones por nombre base
_REFERRAL_CODE_BASE_MAX = 6


def _sanitize_name_base(first_name: str | None) -> str:
    """Normaliza nombre a [A-Z]{1,6}. Fallback 'NEXO' si queda vacío."""
    if not first_name:
        return "NEXO"
    cleaned = re.sub(r"[^A-Za-z]", "", first_name).upper()
    return cleaned[:_REFERRAL_CODE_BASE_MAX] or "NEXO"


def _new_referral_code(first_name: str | None) -> str:
    base = _sanitize_name_base(first_name)
    suffix = uuid.uuid4().hex[:_REFERRAL_CODE_LENGTH].upper()
    return f"{base}-{suffix}"


async def ensure_user_referral_code(db: AsyncSession, *, user: User) -> str:
    """Genera y persiste un referral_code para el user si no tiene uno.

    Idempotente: si ya existe, retorna el existente. Hace retry en caso
    improbable de colisión (UniqueViolation en commit).
    """
    if user.referral_code:
        return user.referral_code

    for _ in range(5):
        candidate = _new_referral_code(user.first_name)
        collision = (
            await db.execute(select(User.id).where(User.referral_code == candidate))
        ).scalar_one_or_none()
        if collision is None:
            user.referral_code = candidate
            await db.flush()
            return candidate

    raise RuntimeError(
        "No se pudo generar un referral_code único después de 5 intentos. "
        "Revisa la unicidad de users.referral_code."
    )


async def resolve_referrer_by_code(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    code: str,
) -> Optional[User]:
    """Devuelve el user dueño de `code` dentro del mismo tenant, o None.

    El código es globalmente único pero se restringe a clientes del mismo
    tenant para evitar referrals cross-gym.
    """
    if not code:
        return None
    code = code.strip().upper()
    if not code:
        return None
    return (
        await db.execute(
            select(User).where(
                User.referral_code == code,
                User.tenant_id == tenant_id,
                User.role == UserRole.CLIENT,
                User.is_active == True,
            )
        )
    ).scalar_one_or_none()


@dataclass
class ReferralStats:
    code: str
    share_url: str
    referred_count: int


async def get_referral_stats(
    db: AsyncSession,
    *,
    user: User,
    storefront_base_url: str,
) -> ReferralStats:
    """Construye los datos que muestra el MemberApp en /refer.

    Asume que `user.referral_code` ya existe (idealmente garantizado
    antes via `ensure_user_referral_code`).
    """
    if not user.referral_code:
        await ensure_user_referral_code(db, user=user)

    count = (
        await db.execute(
            select(func.count()).select_from(User).where(User.referrer_user_id == user.id)
        )
    ).scalar() or 0

    base = storefront_base_url.rstrip("/")
    share_url = f"{base}?{urlencode({'ref': user.referral_code})}"

    return ReferralStats(
        code=user.referral_code or "",
        share_url=share_url,
        referred_count=int(count),
    )
