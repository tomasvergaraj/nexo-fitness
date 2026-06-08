"""Memberships router: list, create, manual-sale, update."""

from datetime import timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_tenant_context,
    require_roles,
)
from app.models.business import Membership, Plan
from app.models.user import User, UserRole
from app.schemas.business import PaginatedResponse
from app.schemas.platform import (
    MembershipCreateRequest,
    MembershipManualSaleRequest,
    MembershipManualSaleResponse,
    MembershipResponse,
    MembershipUpdateRequest,
)
from app.services.membership_sale_service import create_manual_membership_sale

from ._common import _membership_payload


memberships_router = APIRouter(prefix="/memberships", tags=["Memberships"])


@memberships_router.get("", response_model=PaginatedResponse)
async def list_memberships(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    user_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    query = select(Membership).where(Membership.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(Membership).where(Membership.tenant_id == ctx.tenant_id)

    if status_filter:
        query = query.where(Membership.status == status_filter)
        count_query = count_query.where(Membership.status == status_filter)
    if user_id:
        query = query.where(Membership.user_id == user_id)
        count_query = count_query.where(Membership.user_id == user_id)

    total = (await db.execute(count_query)).scalar() or 0
    memberships = (
        await db.execute(
            query.order_by(Membership.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).scalars().all()

    user_ids = [membership.user_id for membership in memberships]
    plan_ids = [membership.plan_id for membership in memberships]
    users = {
        user.id: user
        for user in (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
    } if user_ids else {}
    plans = {
        plan.id: plan
        for plan in (
            await db.execute(select(Plan).where(Plan.id.in_(plan_ids)))
        ).scalars().all()
    } if plan_ids else {}

    return PaginatedResponse(
        items=[_membership_payload(item, users.get(item.user_id), plans.get(item.plan_id)) for item in memberships],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@memberships_router.post("", response_model=MembershipResponse, status_code=201)
async def create_membership(
    data: MembershipCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    user = await db.get(User, data.user_id)
    if not user or user.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    plan = await db.get(Plan, data.plan_id)
    if not plan or plan.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Plan no encontrado")

    expires_at = data.expires_at
    if expires_at is None and plan.duration_days:
        expires_at = data.starts_at + timedelta(days=plan.duration_days)

    membership = Membership(
        tenant_id=ctx.tenant_id,
        user_id=data.user_id,
        plan_id=data.plan_id,
        starts_at=data.starts_at,
        expires_at=expires_at,
        status=data.status,
        auto_renew=data.auto_renew,
    )
    db.add(membership)
    await db.flush()
    await db.refresh(membership)
    return _membership_payload(membership, user, plan)


@memberships_router.post("/manual-sale", response_model=MembershipManualSaleResponse, status_code=201)
async def create_manual_membership_sale_endpoint(
    data: MembershipManualSaleRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    if not ctx.tenant:
        raise HTTPException(status_code=403, detail="No hay tenant activo para registrar ventas manuales")

    user = await db.get(User, data.user_id)
    if not user or user.tenant_id != ctx.tenant_id or user.role != UserRole.CLIENT:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    plan = await db.get(Plan, data.plan_id)
    if not plan or plan.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    if not plan.is_active:
        raise HTTPException(status_code=400, detail="Solo puedes asignar planes activos")

    # Gift card (Fase 6.6): se descuenta del monto a cobrar antes de crear la venta.
    from decimal import Decimal
    from app.services import gift_card_service
    from app.services.membership_sale_service import resolve_plan_sale_amount

    gift_card_applied = Decimal("0")
    gift_redemption = None
    charge_amount = data.amount
    if data.gift_card_code and data.gift_card_code.strip():
        base_amount = resolve_plan_sale_amount(plan, data.amount)
        try:
            gift_redemption = await gift_card_service.redeem(
                db,
                tenant_id=ctx.tenant_id,
                code=data.gift_card_code,
                total=base_amount,
                context="membership",
                redeemed_by=_user.id,
            )
        except gift_card_service.GiftCardError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        gift_card_applied = gift_redemption.amount
        charge_amount = base_amount - gift_card_applied

    try:
        result = await create_manual_membership_sale(
            db,
            tenant=ctx.tenant,
            client=user,
            plan=plan,
            starts_at=data.starts_at,
            expires_at=data.expires_at,
            payment_method=data.payment_method,
            amount=charge_amount,
            currency=data.currency,
            description=data.description,
            notes=data.notes,
            auto_renew=data.auto_renew,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Vincular la redención al pago recién creado.
    if gift_redemption is not None:
        gift_redemption.payment_id = result.payment.id
        await db.flush()

    effective_plan = None
    if result.effective_membership:
        effective_plan = plan if result.effective_membership.plan_id == plan.id else await db.get(Plan, result.effective_membership.plan_id)
    scheduled_plan = None
    if result.scheduled_membership:
        scheduled_plan = plan if result.scheduled_membership.plan_id == plan.id else await db.get(Plan, result.scheduled_membership.plan_id)

    return MembershipManualSaleResponse(
        membership=_membership_payload(result.membership, user, plan, result.payment),
        payment=result.payment,
        replaced_membership_ids=result.replaced_membership_ids,
        effective_membership=(
            _membership_payload(
                result.effective_membership,
                user,
                effective_plan,
                result.payment if result.effective_membership and result.payment.membership_id == result.effective_membership.id else None,
            )
            if result.effective_membership and effective_plan
            else None
        ),
        scheduled_membership=(
            _membership_payload(
                result.scheduled_membership,
                user,
                scheduled_plan,
                result.payment if result.scheduled_membership and result.payment.membership_id == result.scheduled_membership.id else None,
            )
            if result.scheduled_membership and scheduled_plan
            else None
        ),
        scheduled=result.scheduled,
        gift_card_applied=gift_card_applied,
    )


@memberships_router.patch("/{membership_id}", response_model=MembershipResponse)
async def update_membership(
    membership_id: UUID,
    data: MembershipUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    membership = await db.get(Membership, membership_id)
    if not membership or membership.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Membresía no encontrada")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(membership, field, value)

    await db.flush()
    await db.refresh(membership)
    user = await db.get(User, membership.user_id)
    plan = await db.get(Plan, membership.plan_id)
    return _membership_payload(membership, user, plan)
