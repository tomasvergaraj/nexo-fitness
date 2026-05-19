"""Promo codes endpoints (tenant-scoped)."""

import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_tenant, get_current_user, require_roles
from app.models.business import PromoCode
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.platform import (
    PromoCodeCreate,
    PromoCodeResponse,
    PromoCodeUpdate,
    PromoCodeValidateRequest,
    PromoCodeValidateResponse,
)
from app.services.promo_code_service import resolve_tenant_promo_pricing

from ._common import _promo_to_response

promo_codes_router = APIRouter(prefix="/promo-codes", tags=["Promo Codes"])


@promo_codes_router.get("", response_model=list[PromoCodeResponse])
async def list_promo_codes(
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> list[PromoCodeResponse]:
    result = await db.execute(
        select(PromoCode)
        .where(PromoCode.tenant_id == tenant.id)
        .order_by(PromoCode.created_at.desc())
    )
    promos = result.scalars().all()
    return [_promo_to_response(p) for p in promos]


@promo_codes_router.post("", response_model=PromoCodeResponse, status_code=201)
async def create_promo_code(
    body: PromoCodeCreate,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> PromoCodeResponse:
    # Check uniqueness within tenant
    existing = await db.execute(
        select(PromoCode).where(
            PromoCode.tenant_id == tenant.id,
            PromoCode.code == body.code.upper(),
        )
    )
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail="Ya existe un código promocional con ese código para este gimnasio.")

    promo = PromoCode(
        id=uuid4(),
        tenant_id=tenant.id,
        code=body.code.upper().strip(),
        name=body.name,
        description=body.description,
        discount_type=body.discount_type,
        discount_value=Decimal(str(body.discount_value)),
        max_uses=body.max_uses,
        uses_count=0,
        expires_at=body.expires_at,
        is_active=True,
        plan_ids=json.dumps([str(p) for p in body.plan_ids]) if body.plan_ids else None,
    )
    db.add(promo)
    await db.commit()
    await db.refresh(promo)
    return _promo_to_response(promo)


@promo_codes_router.patch("/{promo_id}", response_model=PromoCodeResponse)
async def update_promo_code(
    promo_id: UUID,
    body: PromoCodeUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> PromoCodeResponse:
    result = await db.execute(
        select(PromoCode).where(PromoCode.id == promo_id, PromoCode.tenant_id == tenant.id)
    )
    promo = result.scalars().first()
    if not promo:
        raise HTTPException(status_code=404, detail="Código promocional no encontrado.")

    if body.name is not None:
        promo.name = body.name
    if body.description is not None:
        promo.description = body.description
    if body.discount_type is not None:
        promo.discount_type = body.discount_type
    if body.discount_value is not None:
        promo.discount_value = Decimal(str(body.discount_value))
    if body.max_uses is not None:
        promo.max_uses = body.max_uses
    if body.expires_at is not None:
        promo.expires_at = body.expires_at
    if body.is_active is not None:
        promo.is_active = body.is_active
    if body.plan_ids is not None:
        promo.plan_ids = json.dumps([str(p) for p in body.plan_ids]) if body.plan_ids else None

    promo.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(promo)
    return _promo_to_response(promo)


@promo_codes_router.delete("/{promo_id}", status_code=204)
async def delete_promo_code(
    promo_id: UUID,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(PromoCode).where(PromoCode.id == promo_id, PromoCode.tenant_id == tenant.id)
    )
    promo = result.scalars().first()
    if not promo:
        raise HTTPException(status_code=404, detail="Código promocional no encontrado.")
    await db.delete(promo)
    await db.commit()


@promo_codes_router.post("/validate", response_model=PromoCodeValidateResponse)
async def validate_promo_code(
    body: PromoCodeValidateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PromoCodeValidateResponse:
    """Validate a promo code for a given plan. Returns discount info if valid."""
    pricing = await resolve_tenant_promo_pricing(
        db,
        tenant_id=tenant.id,
        plan_id=body.plan_id,
        promo_code=body.code,
    )
    if not pricing.valid or pricing.promo is None:
        return PromoCodeValidateResponse(valid=False, reason=pricing.reason)

    promo = pricing.promo
    return PromoCodeValidateResponse(
        valid=True,
        promo_code_id=promo.id,
        discount_type=promo.discount_type,
        discount_value=float(promo.discount_value),
        discount_amount=float(pricing.promo_discount_amount or 0),
        final_price=float(pricing.final_price or 0),
    )
