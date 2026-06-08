"""Servicio del programa de referidos (Fase 6.4).

Responsabilidades:
- Generar un `User.referral_code` único e idempotente al primer pago
  completado del cliente.
- Resolver `referrer_user_id` desde un código entregado por la storefront.
- Conteo simple de referidos para mostrar en MemberApp.
"""
from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import ReferralReward
from app.models.tenant import Tenant
from app.models.user import User, UserRole

logger = structlog.get_logger()

# Config por defecto del reward (Fase 6.4b). Opt-in: deshabilitado salvo que el
# gym lo active en Ajustes.
DEFAULT_REFERRAL_REWARD_DAYS = 7


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


def _referral_reward_config(tenant: Tenant) -> tuple[bool, int]:
    """Lee (enabled, days) del blob features del tenant. Opt-in: default off."""
    raw = tenant.features
    features: dict = {}
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                features = parsed
        except json.JSONDecodeError:
            features = {}
    enabled = bool(features.get("referral_reward_enabled", False))
    try:
        days = int(features.get("referral_reward_days", DEFAULT_REFERRAL_REWARD_DAYS) or 0)
    except (TypeError, ValueError):
        days = DEFAULT_REFERRAL_REWARD_DAYS
    return enabled, max(0, days)


async def grant_referral_reward(
    db: AsyncSession,
    *,
    tenant: Tenant,
    referred_user: User,
    payment_id: Optional[uuid.UUID] = None,
) -> Optional[ReferralReward]:
    """Otorga la recompensa al referrer cuando su referido completa el primer pago.

    Idempotente (1 reward por referido). Opt-in vía Ajustes del gym. Si el referrer
    tiene una membresía vigente, los días gratis se suman a su `expires_at`
    (status=applied); si no, queda registrada como `pending`. Notifica al referrer.

    No lanza: cualquier fallo se loggea y se devuelve None para no romper la venta.
    """
    try:
        if not referred_user.referrer_user_id:
            return None

        enabled, reward_days = _referral_reward_config(tenant)
        if not enabled or reward_days <= 0:
            return None

        # Idempotencia: una recompensa por referido.
        existing = (
            await db.execute(
                select(ReferralReward).where(
                    ReferralReward.tenant_id == tenant.id,
                    ReferralReward.referred_user_id == referred_user.id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return None

        referrer = await db.get(User, referred_user.referrer_user_id)
        if (
            referrer is None
            or not referrer.is_active
            or referrer.tenant_id != tenant.id
            or referrer.role != UserRole.CLIENT
        ):
            return None

        # Aplicación automática: extender la membresía vigente del referrer.
        from app.services.membership_sale_service import sync_membership_timeline

        state = await sync_membership_timeline(db, tenant_id=tenant.id, user_id=referrer.id)
        target = state.current_membership
        status = "pending"
        applied_membership_id: Optional[uuid.UUID] = None
        if target is not None and target.expires_at is not None:
            target.expires_at = target.expires_at + timedelta(days=reward_days)
            applied_membership_id = target.id
            status = "applied"

        reward = ReferralReward(
            tenant_id=tenant.id,
            referrer_user_id=referrer.id,
            referred_user_id=referred_user.id,
            payment_id=payment_id,
            applied_membership_id=applied_membership_id,
            reward_days=reward_days,
            status=status,
        )
        db.add(reward)
        await db.flush()

        # Notificar al referrer (no bloqueante).
        try:
            from app.services.push_notification_service import create_and_dispatch_notification

            if status == "applied":
                message = (
                    f"¡Tu invitado se inscribió! Sumamos {reward_days} días gratis a tu membresía. "
                    "Gracias por recomendarnos."
                )
            else:
                message = (
                    f"¡Tu invitado se inscribió! Ganaste {reward_days} días gratis que aplicaremos "
                    "a tu próxima membresía."
                )
            await create_and_dispatch_notification(
                db,
                tenant_id=tenant.id,
                user_id=referrer.id,
                title="Ganaste días gratis 🎁",
                message=message,
                type="success",
                action_url="nexofitness://tab/profile",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("referral_reward_notify_failed", referrer_id=str(referrer.id), exc_info=exc)

        logger.info(
            "referral_reward_granted",
            tenant_id=str(tenant.id),
            referrer_id=str(referrer.id),
            referred_id=str(referred_user.id),
            reward_days=reward_days,
            status=status,
        )
        return reward
    except Exception as exc:  # noqa: BLE001
        logger.error("referral_reward_error", referred_id=str(referred_user.id), exc_info=exc)
        return None


async def get_rewards_earned_days(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    referrer_user_id: uuid.UUID,
) -> int:
    """Total de días gratis ganados por el referrer (para mostrar en MemberApp)."""
    total = (
        await db.execute(
            select(func.coalesce(func.sum(ReferralReward.reward_days), 0)).where(
                ReferralReward.tenant_id == tenant_id,
                ReferralReward.referrer_user_id == referrer_user_id,
            )
        )
    ).scalar()
    return int(total or 0)


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
