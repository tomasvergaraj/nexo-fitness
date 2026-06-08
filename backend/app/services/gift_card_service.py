"""Gift cards (Fase 6.6): tarjetas de regalo con saldo.

Emisión manual por el staff; redención parcial en POS o venta de plan. El
descuento se aplica con bloqueo de fila (with_for_update) para evitar doble
gasto del saldo en compras concurrentes.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import GiftCard, GiftCardRedemption
from app.models.tenant import Tenant
from app.models.user import User

logger = structlog.get_logger()

# Alfabeto sin caracteres ambiguos (0/O, 1/I/L).
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_MONEY = Decimal("0.01")


class GiftCardError(ValueError):
    """Error de validación/redención de gift card."""


def _money(value: Decimal | int | float) -> Decimal:
    return Decimal(value).quantize(_MONEY, rounding=ROUND_HALF_UP)


def _gen_segment(length: int = 4) -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


def generate_code() -> str:
    return f"GIFT-{_gen_segment()}-{_gen_segment()}"


async def issue_gift_card(
    db: AsyncSession,
    *,
    tenant: Tenant,
    amount: Decimal,
    issued_by: Optional[uuid.UUID] = None,
    recipient_email: Optional[str] = None,
    recipient_name: Optional[str] = None,
    message: Optional[str] = None,
    currency: Optional[str] = None,
) -> GiftCard:
    """Crea una gift card con saldo = monto y código único. No falla si el email falla."""
    amount = _money(amount)
    if amount <= 0:
        raise GiftCardError("El monto debe ser mayor a 0.")

    code = generate_code()
    for _ in range(5):
        clash = (await db.execute(select(GiftCard.id).where(GiftCard.code == code))).scalar_one_or_none()
        if clash is None:
            break
        code = generate_code()
    else:
        raise GiftCardError("No se pudo generar un código único, reintenta.")

    card = GiftCard(
        tenant_id=tenant.id,
        code=code,
        initial_amount=amount,
        balance=amount,
        currency=(currency or tenant.currency or "CLP").upper(),
        recipient_email=(recipient_email or "").strip() or None,
        recipient_name=(recipient_name or "").strip() or None,
        message=(message or "").strip() or None,
        status="active",
        issued_by=issued_by,
    )
    db.add(card)
    await db.flush()
    await db.refresh(card)

    if card.recipient_email:
        try:
            from app.integrations.email.email_service import email_service

            await email_service.send_gift_card(
                to_email=card.recipient_email,
                gym_name=tenant.name,
                recipient_name=card.recipient_name,
                code=card.code,
                amount=card.balance,
                currency=card.currency,
                message=card.message,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("gift_card_email_failed", gift_card_id=str(card.id), exc_info=exc)

    return card


async def get_active_by_code(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    code: str,
    for_update: bool = False,
) -> Optional[GiftCard]:
    if not code:
        return None
    stmt = select(GiftCard).where(
        GiftCard.tenant_id == tenant_id,
        GiftCard.code == code.strip().upper(),
        GiftCard.status == "active",
    )
    if for_update:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalar_one_or_none()


async def preview_redemption(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    code: str,
    total: Decimal,
) -> dict:
    """Devuelve cuánto cubriría la gift card de un total dado (sin descontar)."""
    card = await get_active_by_code(db, tenant_id=tenant_id, code=code)
    if card is None:
        raise GiftCardError("Código de gift card inválido o sin saldo.")
    total = _money(total)
    applied = min(card.balance, total)
    return {
        "code": card.code,
        "balance": card.balance,
        "applied": _money(applied),
        "remaining_after": _money(card.balance - applied),
        "currency": card.currency,
    }


async def redeem(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    code: str,
    total: Decimal,
    context: str,
    redeemed_by: Optional[uuid.UUID] = None,
    payment_id: Optional[uuid.UUID] = None,
    pos_transaction_id: Optional[uuid.UUID] = None,
) -> GiftCardRedemption:
    """Aplica (descuenta) la gift card sobre `total`. Bloquea la fila para evitar doble gasto.

    Debe llamarse dentro de la misma transacción que la venta. Devuelve el
    registro de redención (incluye `amount` aplicado).
    """
    card = await get_active_by_code(db, tenant_id=tenant_id, code=code, for_update=True)
    if card is None:
        raise GiftCardError("Código de gift card inválido o sin saldo.")

    total = _money(total)
    if total <= 0:
        raise GiftCardError("No hay monto por cubrir.")

    applied = _money(min(card.balance, total))
    if applied <= 0:
        raise GiftCardError("La gift card no tiene saldo disponible.")

    card.balance = _money(card.balance - applied)
    card.last_used_at = datetime.now(timezone.utc)
    if card.balance <= 0:
        card.status = "depleted"

    redemption = GiftCardRedemption(
        tenant_id=tenant_id,
        gift_card_id=card.id,
        amount=applied,
        context=context,
        payment_id=payment_id,
        pos_transaction_id=pos_transaction_id,
        redeemed_by=redeemed_by,
    )
    db.add(redemption)
    await db.flush()
    return redemption
