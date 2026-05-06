"""Service to record + query platform audit log entries.

Append-only by design — entries are never updated nor deleted via this service.
Use ``record(...)`` from privileged endpoints to leave a trail of who did what."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import Request
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import PlatformAuditLog
from app.models.user import User


def _resolve_request_meta(request: Optional[Request]) -> tuple[Optional[str], Optional[str]]:
    if request is None:
        return None, None
    forwarded = request.headers.get("x-forwarded-for") or ""
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    ua = request.headers.get("user-agent")
    if ua and len(ua) > 500:
        ua = ua[:500]
    return ip, ua


class PlatformAuditService:
    """Append-only writes + paginated reads for the audit log."""

    @staticmethod
    async def record(
        db: AsyncSession,
        *,
        actor: Optional[User],
        action: str,
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        target_label: Optional[str] = None,
        payload: Optional[dict[str, Any]] = None,
        severity: str = "info",
        request: Optional[Request] = None,
        commit: bool = True,
    ) -> PlatformAuditLog:
        ip, ua = _resolve_request_meta(request)
        entry = PlatformAuditLog(
            actor_user_id=actor.id if actor else None,
            actor_email=actor.email if actor else None,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            target_label=target_label,
            payload=payload,
            severity=severity,
            ip_address=ip,
            user_agent=ua,
        )
        db.add(entry)
        if commit:
            await db.commit()
            await db.refresh(entry)
        else:
            await db.flush()
        return entry

    @staticmethod
    async def list(
        db: AsyncSession,
        *,
        page: int = 1,
        per_page: int = 50,
        action: Optional[str] = None,
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        actor_user_id: Optional[UUID] = None,
        severity: Optional[str] = None,
        search: Optional[str] = None,
        since_days: Optional[int] = None,
    ) -> dict[str, Any]:
        query = select(PlatformAuditLog)
        count_query = select(func.count()).select_from(PlatformAuditLog)

        filters = []
        if action:
            filters.append(PlatformAuditLog.action == action)
        if target_type:
            filters.append(PlatformAuditLog.target_type == target_type)
        if target_id:
            filters.append(PlatformAuditLog.target_id == str(target_id))
        if actor_user_id:
            filters.append(PlatformAuditLog.actor_user_id == actor_user_id)
        if severity:
            filters.append(PlatformAuditLog.severity == severity)
        if search:
            term = f"%{search.strip()}%"
            filters.append(
                or_(
                    PlatformAuditLog.action.ilike(term),
                    PlatformAuditLog.target_label.ilike(term),
                    PlatformAuditLog.actor_email.ilike(term),
                    PlatformAuditLog.target_id.ilike(term),
                )
            )
        if since_days is not None and since_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
            filters.append(PlatformAuditLog.created_at >= cutoff)

        if filters:
            query = query.where(*filters)
            count_query = count_query.where(*filters)

        total = (await db.execute(count_query)).scalar() or 0
        rows = (
            await db.execute(
                query.order_by(desc(PlatformAuditLog.created_at))
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).scalars().all()

        return {
            "items": [
                {
                    "id": str(r.id),
                    "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
                    "actor_email": r.actor_email,
                    "action": r.action,
                    "target_type": r.target_type,
                    "target_id": r.target_id,
                    "target_label": r.target_label,
                    "payload": r.payload,
                    "severity": r.severity,
                    "ip_address": r.ip_address,
                    "user_agent": r.user_agent,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ],
            "total": int(total),
            "page": page,
            "per_page": per_page,
            "pages": (int(total) + per_page - 1) // per_page,
        }
