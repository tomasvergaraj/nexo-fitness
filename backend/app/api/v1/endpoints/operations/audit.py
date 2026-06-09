"""Audit log router (owner-side, read-only).

Expone la tabla `audit_logs` para que el owner investigue acciones sensibles
("¿quién canceló esta membresía?"). Sólo lectura, filtrable. Ver
`services/audit_service.py` para el lado de escritura.
"""

import json
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
from app.models.business import AuditLog
from app.models.user import User
from app.schemas.business import (
    AuditActorOption,
    AuditFilterOption,
    AuditFiltersResponse,
    AuditLogResponse,
    PaginatedResponse,
)


audit_router = APIRouter(prefix="/audit", tags=["Audit"])


# Etiquetas en español para acciones canónicas (ver audit_service.py).
_ACTION_LABELS: dict[str, str] = {
    "login_success": "Inicio de sesión",
    "login_failed": "Inicio de sesión fallido",
    "logout": "Cierre de sesión",
    "password_change": "Cambio de contraseña",
    "password_reset_confirm": "Restablecer contraseña",
    "role_change": "Cambio de rol",
    "staff_invite": "Invitación de staff",
    "staff_remove": "Baja de staff",
    "client_delete": "Eliminar cliente",
    "client_hard_delete": "Eliminar cliente (definitivo)",
    "impersonate_start": "Inicio de suplantación",
    "impersonate_end": "Fin de suplantación",
}

_ENTITY_LABELS: dict[str, str] = {
    "user": "Usuario",
    "client": "Cliente",
    "membership": "Membresía",
    "staff": "Staff",
    "tenant": "Gimnasio",
}


def _humanize(value: str, labels: dict[str, str]) -> str:
    """Etiqueta legible: usa el mapa si existe, sino capitaliza el slug."""
    if value in labels:
        return labels[value]
    return value.replace("_", " ").capitalize()


def _audit_payload(log: AuditLog, actor: Optional[User]) -> AuditLogResponse:
    details = None
    if log.details:
        try:
            details = json.loads(log.details)
        except (ValueError, TypeError):
            details = {"raw": log.details}
    return AuditLogResponse(
        id=log.id,
        action=log.action,
        entity_type=log.entity_type,
        entity_id=log.entity_id,
        details=details,
        ip_address=log.ip_address,
        created_at=log.created_at,
        actor_id=actor.id if actor else None,
        actor_name=(actor.full_name if actor else None),
        actor_email=(actor.email if actor else None),
    )


@audit_router.get("/logs", response_model=PaginatedResponse)
async def list_audit_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    actor_id: Optional[UUID] = Query(None),
    action: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user: User = Depends(require_roles("owner")),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser mayor que la fecha final")

    base = select(AuditLog).where(AuditLog.tenant_id == ctx.tenant_id)
    count_base = select(func.count()).select_from(AuditLog).where(AuditLog.tenant_id == ctx.tenant_id)

    def _apply(stmt):
        if actor_id is not None:
            stmt = stmt.where(AuditLog.user_id == actor_id)
        if action:
            stmt = stmt.where(AuditLog.action == action)
        if entity_type:
            stmt = stmt.where(AuditLog.entity_type == entity_type)
        if date_from:
            stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
        if date_to:
            stmt = stmt.where(AuditLog.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
        return stmt

    total = (await db.execute(_apply(count_base))).scalar() or 0
    logs = (
        await db.execute(
            _apply(base).order_by(AuditLog.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).scalars().all()

    actor_ids = {log.user_id for log in logs if log.user_id}
    actors: dict[UUID, User] = {}
    if actor_ids:
        rows = (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars().all()
        actors = {u.id: u for u in rows}

    return PaginatedResponse(
        items=[_audit_payload(log, actors.get(log.user_id)) for log in logs],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@audit_router.get("/filters", response_model=AuditFiltersResponse)
async def audit_filters(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user: User = Depends(require_roles("owner")),
):
    """Valores distintos presentes en el log del tenant para poblar los selects."""
    actions = (
        await db.execute(
            select(AuditLog.action)
            .where(AuditLog.tenant_id == ctx.tenant_id)
            .distinct()
            .order_by(AuditLog.action)
        )
    ).scalars().all()
    entity_types = (
        await db.execute(
            select(AuditLog.entity_type)
            .where(AuditLog.tenant_id == ctx.tenant_id, AuditLog.entity_type.isnot(None))
            .distinct()
            .order_by(AuditLog.entity_type)
        )
    ).scalars().all()

    actor_ids = (
        await db.execute(
            select(AuditLog.user_id)
            .where(AuditLog.tenant_id == ctx.tenant_id, AuditLog.user_id.isnot(None))
            .distinct()
        )
    ).scalars().all()
    actors: list[AuditActorOption] = []
    if actor_ids:
        rows = (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars().all()
        actors = sorted(
            (AuditActorOption(id=u.id, name=u.full_name or u.email or "—", email=u.email) for u in rows),
            key=lambda a: a.name.lower(),
        )

    return AuditFiltersResponse(
        actions=[AuditFilterOption(value=a, label=_humanize(a, _ACTION_LABELS)) for a in actions],
        entity_types=[AuditFilterOption(value=e, label=_humanize(e, _ENTITY_LABELS)) for e in entity_types if e],
        actors=actors,
    )
