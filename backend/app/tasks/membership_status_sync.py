"""
Tarea Celery: reconcilia el enum `Membership.status` con el estado real
derivado de las fechas (starts_at / expires_at / uses_remaining).

El estado real se computa en `_resolved_membership_status()`, pero el enum en BD
solo se actualizaba cuando algo tocaba a ese usuario (venta, acceso). Sin este
job el enum queda stale y todo lo que filtra/cuenta por enum crudo (dashboard,
alertas, auto-renovación) miente.

Cada 15 minutos, por tenant (usando su timezone para el corte de "hoy"):
  - PENDING/ACTIVE/FROZEN con expires_at <= hoy  -> EXPIRED (vencida por fecha)
  - PENDING/ACTIVE con uses_remaining <= 0        -> EXPIRED (agotó pases)
  - PENDING cuyo starts_at <= hoy y sigue vigente -> ACTIVE  (programada que arrancó)

Nunca toca CANCELLED (estado terminal). Idempotente.
"""

import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.membership_status_sync.sync_membership_statuses", bind=True, max_retries=2)
def sync_membership_statuses(self) -> dict:
    return asyncio.run(_run_sync_membership_statuses())


def _tenant_today(tz_name: str | None):
    try:
        zone = ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    return datetime.now(zone).date()


async def _run_sync_membership_statuses() -> dict:
    from sqlalchemy import and_, or_, select, update

    from app.models.business import Membership, MembershipStatus
    from app.models.tenant import Tenant
    from app.tasks._db import task_session

    expired_total = 0
    activated_total = 0

    async with task_session() as db:
        tenants = (await db.execute(select(Tenant.id, Tenant.timezone))).all()

        for tenant_id, tz_name in tenants:
            today = _tenant_today(tz_name)

            # → EXPIRED: venció por fecha (active/pending/frozen) o agotó pases.
            expired_result = await db.execute(
                update(Membership)
                .where(
                    Membership.tenant_id == tenant_id,
                    Membership.status.in_(
                        [MembershipStatus.ACTIVE, MembershipStatus.PENDING, MembershipStatus.FROZEN]
                    ),
                    or_(
                        and_(Membership.expires_at.is_not(None), Membership.expires_at <= today),
                        and_(Membership.uses_remaining.is_not(None), Membership.uses_remaining <= 0),
                    ),
                )
                .values(status=MembershipStatus.EXPIRED)
                .execution_options(synchronize_session=False)
            )
            expired_total += expired_result.rowcount or 0

            # → ACTIVE: programada cuyo inicio ya llegó y sigue vigente.
            activated_result = await db.execute(
                update(Membership)
                .where(
                    Membership.tenant_id == tenant_id,
                    Membership.status == MembershipStatus.PENDING,
                    Membership.starts_at <= today,
                    or_(Membership.expires_at.is_(None), Membership.expires_at > today),
                    or_(Membership.uses_remaining.is_(None), Membership.uses_remaining > 0),
                )
                .values(status=MembershipStatus.ACTIVE)
                .execution_options(synchronize_session=False)
            )
            activated_total += activated_result.rowcount or 0

        await db.commit()

    if expired_total or activated_total:
        logger.info("membership_status_sync", expired=expired_total, activated=activated_total)

    return {"expired": expired_total, "activated": activated_total}
