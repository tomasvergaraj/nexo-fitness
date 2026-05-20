"""Support interactions router (owner-side)."""

from datetime import date, datetime, time, timezone
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
from app.models.business import SupportInteraction
from app.models.user import User, UserRole
from app.schemas.business import PaginatedResponse
from app.schemas.platform import (
    SupportInteractionCreateRequest,
    SupportInteractionResponse,
    SupportInteractionUpdateRequest,
)

from ._common import (
    _get_support_related_users,
    _support_payload,
)


support_router = APIRouter(prefix="/support/interactions", tags=["Support"])

_SUPPORT_STAFF_ROLES = (
    UserRole.OWNER,
    UserRole.ADMIN,
    UserRole.RECEPTION,
    UserRole.TRAINER,
    UserRole.MARKETING,
)


async def _get_support_client(
    db: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
) -> User | None:
    if user_id is None:
        return None

    return (
        await db.execute(
            select(User).where(
                User.id == user_id,
                User.tenant_id == tenant_id,
                User.role == UserRole.CLIENT,
            )
        )
    ).scalar_one_or_none()


async def _get_support_handler(
    db: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
) -> User | None:
    if user_id is None:
        return None

    return (
        await db.execute(
            select(User).where(
                User.id == user_id,
                User.tenant_id == tenant_id,
                User.role.in_(_SUPPORT_STAFF_ROLES),
                User.is_active == True,
            )
        )
    ).scalar_one_or_none()


@support_router.get("", response_model=PaginatedResponse)
async def list_support_interactions(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    resolved: Optional[bool] = None,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser mayor que la fecha final")

    query = select(SupportInteraction).where(SupportInteraction.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(SupportInteraction).where(SupportInteraction.tenant_id == ctx.tenant_id)
    if resolved is not None:
        query = query.where(SupportInteraction.resolved == resolved)
        count_query = count_query.where(SupportInteraction.resolved == resolved)
    if date_from:
        query = query.where(SupportInteraction.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
        count_query = count_query.where(SupportInteraction.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        query = query.where(SupportInteraction.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
        count_query = count_query.where(SupportInteraction.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))

    total = (await db.execute(count_query)).scalar() or 0
    interactions = (
        await db.execute(
            query.order_by(SupportInteraction.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).scalars().all()

    related_users = await _get_support_related_users(db, interactions)

    return PaginatedResponse(
        items=[
            _support_payload(item, related_users.get(item.user_id), related_users.get(item.handled_by))
            for item in interactions
        ],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@support_router.post("", response_model=SupportInteractionResponse, status_code=201)
async def create_support_interaction(
    data: SupportInteractionCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user: User = Depends(require_roles("owner", "admin", "reception")),
):
    client = await _get_support_client(db, ctx.tenant_id, data.user_id)
    if data.user_id and client is None:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    handler = await _get_support_handler(db, ctx.tenant_id, data.handled_by)
    if data.handled_by and handler is None:
        raise HTTPException(status_code=404, detail="Responsable no encontrado")

    interaction = SupportInteraction(
        tenant_id=ctx.tenant_id,
        user_id=data.user_id,
        channel=data.channel,
        subject=data.subject,
        notes=data.notes,
        handled_by=data.handled_by,
        resolved=data.resolved,
    )
    db.add(interaction)
    await db.flush()
    await db.refresh(interaction)

    return _support_payload(interaction, client, handler)


@support_router.patch("/{interaction_id}", response_model=SupportInteractionResponse)
async def update_support_interaction(
    interaction_id: UUID,
    data: SupportInteractionUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    interaction = await db.get(SupportInteraction, interaction_id)
    if not interaction or interaction.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Interacción de soporte no encontrada")

    payload = data.model_dump(exclude_unset=True)

    if "handled_by" in payload:
        handler = await _get_support_handler(db, ctx.tenant_id, payload["handled_by"])
        if payload["handled_by"] and handler is None:
            raise HTTPException(status_code=404, detail="Responsable no encontrado")
    else:
        handler = await _get_support_handler(db, ctx.tenant_id, interaction.handled_by)

    for field, value in payload.items():
        setattr(interaction, field, value)

    await db.flush()
    await db.refresh(interaction)
    client = await _get_support_client(db, ctx.tenant_id, interaction.user_id)
    return _support_payload(interaction, client, handler)
