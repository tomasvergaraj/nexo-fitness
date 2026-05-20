"""Staff router: list, invite, list/cancel invitations, update, deactivate, hard-delete."""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_tenant_context,
    require_roles,
)
from app.core.security import create_staff_invitation_token
from app.integrations.email.email_service import email_service
from app.models.user import User, UserRole
from app.services.user_account_service import purge_user_account


staff_router = APIRouter(prefix="/staff", tags=["Staff"])

settings = get_settings()

_STAFF_ROLES = {"admin", "reception", "trainer", "marketing"}
_ROLE_LABELS = {
    "admin": "Administrador",
    "reception": "Recepción",
    "trainer": "Entrenador",
    "marketing": "Marketing",
    "owner": "Propietario",
}
_STAFF_INVITATION_TTL = 259200


class StaffInviteRequest(BaseModel):
    email: str = Field(min_length=5, max_length=200)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    role: str
    replace_pending: bool = False


class StaffUpdateRequest(BaseModel):
    role: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: Optional[bool] = None


async def _get_redis():
    import redis.asyncio as aioredis
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def _mark_staff_invitation_status(redis: Any, token_hash: str | None, status: str) -> None:
    if token_hash:
        await redis.set(f"staff_invite_used:{token_hash}", status, ex=_STAFF_INVITATION_TTL)


@staff_router.get("", response_model=list)
async def list_staff(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    """Return staff members (non-client users) of the tenant for dropdowns."""
    staff_roles = [
        UserRole.OWNER, UserRole.ADMIN, UserRole.RECEPTION,
        UserRole.TRAINER, UserRole.MARKETING,
    ]
    result = await db.execute(
        select(User)
        .where(User.tenant_id == ctx.tenant_id, User.role.in_(staff_roles), User.is_active == True)
        .order_by(User.first_name)
    )
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "full_name": u.full_name,
            "role": u.role.value,
            "email": u.email,
            "is_active": u.is_active,
            "two_factor_enabled": bool(u.two_factor_enabled),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        }
        for u in users
    ]


@staff_router.post("/invite", status_code=201)
async def invite_staff(
    data: StaffInviteRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    """Invite a new staff member via email."""
    if data.role not in _STAFF_ROLES:
        raise HTTPException(status_code=400, detail=f"Rol inválido. Opciones: {', '.join(_STAFF_ROLES)}")

    email = data.email.lower().strip()

    existing = (await db.execute(
        select(User).where(User.email == email, User.tenant_id == ctx.tenant_id)
    )).scalar_one_or_none()
    can_reinvite_existing_staff = bool(
        existing
        and not existing.is_active
        and existing.role in {UserRole.ADMIN, UserRole.RECEPTION, UserRole.TRAINER, UserRole.MARKETING}
    )
    if existing and not can_reinvite_existing_staff:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo en esta cuenta.")

    redis = await _get_redis()
    rate_key = f"staff_invite_rate:{ctx.tenant_id}"
    meta_key = f"staff_invite_meta:{ctx.tenant_id}:{email}"
    list_key = f"staff_invite_list:{ctx.tenant_id}"
    pending_key = f"staff_invite_pending:{ctx.tenant_id}:{email}"
    count = await redis.incr(rate_key)
    if count == 1:
        await redis.expire(rate_key, 3600)
    if count > 20:
        await redis.aclose()
        raise HTTPException(status_code=429, detail="Demasiadas invitaciones enviadas. Intenta en una hora.")

    existing_invitation_raw = await redis.get(meta_key)
    if existing_invitation_raw and not data.replace_pending:
        await redis.aclose()
        raise HTTPException(status_code=409, detail="Ya existe una invitación pendiente para ese correo.")
    if existing_invitation_raw:
        existing_invitation = json.loads(existing_invitation_raw)
        await _mark_staff_invitation_status(redis, existing_invitation.get("token_hash"), "invalidated")
    else:
        await redis.delete(pending_key)

    tenant = ctx.tenant
    gym_name = tenant.name if tenant else "el gimnasio"
    invited_by = current_user.full_name

    token = create_staff_invitation_token(
        email=email,
        tenant_id=str(ctx.tenant_id),
        role=data.role,
        first_name=data.first_name,
        last_name=data.last_name,
        invited_by=invited_by,
    )

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    invite_url = f"{settings.FRONTEND_URL}/accept-invitation?token={token}"
    role_label = _ROLE_LABELS.get(data.role, data.role)

    meta = json.dumps({
        "email": email,
        "first_name": data.first_name,
        "last_name": data.last_name,
        "role": data.role,
        "role_label": role_label,
        "invited_by": invited_by,
        "invited_at": datetime.now(timezone.utc).isoformat(),
        "token_hash": token_hash,
    })

    await redis.set(meta_key, meta, ex=_STAFF_INVITATION_TTL)
    await redis.set(pending_key, token_hash, ex=_STAFF_INVITATION_TTL)
    await redis.sadd(list_key, email)
    await redis.expire(list_key, _STAFF_INVITATION_TTL)
    await redis.aclose()

    await email_service.send_staff_invitation(
        to_email=email,
        first_name=data.first_name,
        gym_name=gym_name,
        invite_url=invite_url,
        role_label=role_label,
        invited_by=invited_by,
    )

    replaced_pending = bool(existing_invitation_raw)
    reactivates_existing_user = bool(can_reinvite_existing_staff)
    detail = (
        f"Nueva invitación enviada a {email}. La invitación anterior fue invalidada."
        if replaced_pending
        else (
            f"Invitación enviada a {email} para reactivar su acceso."
            if reactivates_existing_user
            else f"Invitación enviada a {email}."
        )
    )
    return {
        "detail": detail,
        "email": email,
        "role": data.role,
        "replaced_pending": replaced_pending,
        "reactivates_existing_user": reactivates_existing_user,
    }


@staff_router.get("/invitations")
async def list_pending_invitations(
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """List all pending (not yet accepted) staff invitations."""
    redis = await _get_redis()
    list_key = f"staff_invite_list:{ctx.tenant_id}"
    emails = await redis.smembers(list_key)

    invitations = []
    stale_emails = []
    for email in emails:
        meta_key = f"staff_invite_meta:{ctx.tenant_id}:{email}"
        raw = await redis.get(meta_key)
        if raw:
            data = json.loads(raw)
            ttl = await redis.ttl(meta_key)
            data["expires_in_hours"] = max(0, round(ttl / 3600, 1)) if ttl > 0 else 0
            invitations.append(data)
        else:
            stale_emails.append(email)

    if stale_emails:
        await redis.srem(list_key, *stale_emails)

    await redis.aclose()
    invitations.sort(key=lambda x: x.get("invited_at", ""), reverse=True)
    return invitations


@staff_router.delete("/invitations/{email}")
async def cancel_invitation(
    email: str,
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Cancel a pending staff invitation."""
    email = email.lower().strip()
    redis = await _get_redis()
    meta_key = f"staff_invite_meta:{ctx.tenant_id}:{email}"
    list_key = f"staff_invite_list:{ctx.tenant_id}"
    pending_key = f"staff_invite_pending:{ctx.tenant_id}:{email}"

    raw = await redis.get(meta_key)
    if not raw:
        await redis.aclose()
        raise HTTPException(status_code=404, detail="No hay invitación pendiente para ese correo.")

    meta = json.loads(raw)
    token_hash = meta.get("token_hash")

    await _mark_staff_invitation_status(redis, token_hash, "invalidated")

    await redis.delete(meta_key)
    await redis.delete(pending_key)
    await redis.srem(list_key, email)
    await redis.aclose()
    return {"detail": f"Invitación cancelada para {email}."}


@staff_router.patch("/{staff_id}")
async def update_staff(
    staff_id: UUID,
    data: StaffUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    """Update a staff member's role or info."""
    staff = (await db.execute(
        select(User).where(User.id == staff_id, User.tenant_id == ctx.tenant_id, User.role != UserRole.CLIENT)
    )).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Miembro del equipo no encontrado.")

    if staff.role == UserRole.OWNER and getattr(current_user.role, "value", str(current_user.role)) != "owner":
        raise HTTPException(status_code=403, detail="Solo el propietario puede modificar su propio rol.")

    role_before = staff.role.value if hasattr(staff.role, "value") else str(staff.role)
    role_changed = False

    if data.role is not None:
        if data.role not in _STAFF_ROLES and data.role != "owner":
            raise HTTPException(status_code=400, detail="Rol inválido.")
        if staff.role != UserRole(data.role):
            role_changed = True
        staff.role = UserRole(data.role)
    if data.first_name is not None:
        staff.first_name = data.first_name
    if data.last_name is not None:
        staff.last_name = data.last_name
    if data.is_active is not None:
        staff.is_active = data.is_active

    await db.flush()

    if role_changed:
        from app.services import audit_service
        await audit_service.log_audit(
            db,
            action="role_change",
            actor=current_user,
            entity_type="user",
            entity_id=str(staff.id),
            details={"from": role_before, "to": staff.role.value, "target_email": staff.email},
            request=request,
        )

    return {"id": str(staff.id), "full_name": staff.full_name, "role": staff.role.value, "email": staff.email, "is_active": staff.is_active}


@staff_router.delete("/{staff_id}", status_code=204)
async def deactivate_staff(
    staff_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    """Deactivate (soft-delete) a staff member."""
    staff = (await db.execute(
        select(User).where(User.id == staff_id, User.tenant_id == ctx.tenant_id, User.role != UserRole.CLIENT)
    )).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Miembro del equipo no encontrado.")
    if str(staff.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta.")
    staff.is_active = False
    await db.flush()


@staff_router.delete("/{staff_id}/hard-delete", status_code=204)
async def hard_delete_staff(
    staff_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    staff = (await db.execute(
        select(User).where(
            User.id == staff_id,
            User.tenant_id == ctx.tenant_id,
            User.role != UserRole.CLIENT,
        )
    )).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Miembro del equipo no encontrado.")

    await purge_user_account(db, user=staff, actor=current_user, tenant_id=ctx.tenant_id)
