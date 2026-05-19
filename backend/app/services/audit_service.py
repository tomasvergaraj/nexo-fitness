"""Audit logging service para operaciones sensibles a nivel tenant.

Escribe en la tabla `audit_logs` (modelo AuditLog en business.py). Append-only,
best-effort: si la escritura falla no debe romper la operación principal.

Acciones canónicas (string libre pero coordinadas):
- login_success, login_failed, logout
- password_change, password_reset_confirm
- role_change, staff_invite, staff_remove
- client_delete, client_hard_delete
- impersonate_start, impersonate_end
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional
from uuid import UUID

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import AuditLog
from app.models.user import User

logger = logging.getLogger(__name__)


def extract_request_meta(request: Optional[Request]) -> tuple[Optional[str], Optional[str]]:
    """Devuelve (ip, user_agent) del request. None si no hay request."""
    if request is None:
        return None, None
    # X-Forwarded-For prioritario para reverse proxy; sino client.host.
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
    if fwd:
        ip = fwd.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    # Truncar para no exceder schema (45 / 500 chars)
    if ip:
        ip = ip[:45]
    if ua:
        ua = ua[:500]
    return ip, ua


async def log_audit(
    db: AsyncSession,
    *,
    action: str,
    tenant_id: Optional[UUID] = None,
    actor: Optional[User] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> None:
    """Inserta un registro de auditoría. Best-effort — atrapa excepciones y
    sólo loguea warning para no romper la operación que llama."""
    try:
        ip, _ua = extract_request_meta(request)  # ip cabe en schema, user_agent no
        entry = AuditLog(
            tenant_id=tenant_id if tenant_id else (actor.tenant_id if actor else None),
            user_id=actor.id if actor else None,
            action=action[:100],
            entity_type=entity_type[:50] if entity_type else None,
            entity_id=str(entity_id)[:50] if entity_id else None,
            details=json.dumps(details, default=str)[:65535] if details else None,
            ip_address=ip,
        )
        db.add(entry)
        await db.flush()
    except Exception as exc:  # noqa: BLE001
        logger.warning("audit_log_failed action=%s err=%s", action, exc)
