"""Gift cards endpoints (tenant-scoped, Fase 6.6)."""

from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_tenant, get_current_user, require_roles
from app.models.business import GiftCard
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services import gift_card_service

gift_cards_router = APIRouter(prefix="/gift-cards", tags=["Gift Cards"])


# ─── Schemas ──────────────────────────────────────────────────────────────────


class GiftCardCreate(BaseModel):
    amount: Decimal = Field(gt=0)
    recipient_email: Optional[str] = None
    recipient_name: Optional[str] = None
    message: Optional[str] = None


class GiftCardResponse(BaseModel):
    id: UUID
    code: str
    initial_amount: Decimal
    balance: Decimal
    currency: str
    recipient_email: Optional[str] = None
    recipient_name: Optional[str] = None
    message: Optional[str] = None
    status: str
    created_at: datetime
    last_used_at: Optional[datetime] = None


class GiftCardValidateRequest(BaseModel):
    code: str
    total: Decimal = Field(gt=0)


class GiftCardValidateResponse(BaseModel):
    code: str
    balance: Decimal
    applied: Decimal
    remaining_after: Decimal
    currency: str


def _to_response(card: GiftCard) -> GiftCardResponse:
    return GiftCardResponse(
        id=card.id,
        code=card.code,
        initial_amount=card.initial_amount,
        balance=card.balance,
        currency=card.currency,
        recipient_email=card.recipient_email,
        recipient_name=card.recipient_name,
        message=card.message,
        status=card.status,
        created_at=card.created_at,
        last_used_at=card.last_used_at,
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────


@gift_cards_router.get("", response_model=list[GiftCardResponse])
async def list_gift_cards(
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.RECEPTION)),
    db: AsyncSession = Depends(get_db),
) -> list[GiftCardResponse]:
    rows = (
        await db.execute(
            select(GiftCard).where(GiftCard.tenant_id == tenant.id).order_by(GiftCard.created_at.desc())
        )
    ).scalars().all()
    return [_to_response(c) for c in rows]


@gift_cards_router.post("", response_model=GiftCardResponse, status_code=201)
async def issue_gift_card(
    data: GiftCardCreate,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.RECEPTION)),
    db: AsyncSession = Depends(get_db),
) -> GiftCardResponse:
    try:
        card = await gift_card_service.issue_gift_card(
            db,
            tenant=tenant,
            amount=data.amount,
            issued_by=current_user.id,
            recipient_email=data.recipient_email,
            recipient_name=data.recipient_name,
            message=data.message,
        )
    except gift_card_service.GiftCardError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return _to_response(card)


@gift_cards_router.post("/validate", response_model=GiftCardValidateResponse)
async def validate_gift_card(
    data: GiftCardValidateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.RECEPTION)),
    db: AsyncSession = Depends(get_db),
) -> GiftCardValidateResponse:
    try:
        preview = await gift_card_service.preview_redemption(
            db, tenant_id=tenant.id, code=data.code, total=data.total
        )
    except gift_card_service.GiftCardError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return GiftCardValidateResponse(**preview)


@gift_cards_router.post("/{gift_card_id}/void", response_model=GiftCardResponse)
async def void_gift_card(
    gift_card_id: UUID,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> GiftCardResponse:
    card = await db.get(GiftCard, gift_card_id)
    if not card or card.tenant_id != tenant.id:
        raise HTTPException(status_code=404, detail="Gift card no encontrada")
    card.status = "void"
    await db.commit()
    await db.refresh(card)
    return _to_response(card)
