"""
Tarea Celery: alerta de membresía próxima a vencer.

Se ejecuta una vez al día. Detecta membresías activas que vencen en 7 días
(ventana de ±12 horas) y envía una notificación push + in-app al miembro
con un enlace directo a la pestaña de planes para renovar.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.membership_alerts.send_membership_expiry_alerts", bind=True, max_retries=2)
def send_membership_expiry_alerts(self) -> dict:
    """Detecta membresías activas próximas a vencer y notifica a sus titulares."""
    return asyncio.run(_run_membership_alerts())


async def _run_membership_alerts() -> dict:
    from datetime import date
    from sqlalchemy import select, and_
    from app.tasks._db import task_session
    from app.models.business import Membership, MembershipStatus
    from app.models.user import User
    from app.services.push_notification_service import create_and_dispatch_notification

    now = datetime.now(timezone.utc)
    today = now.date()
    # Ventana: vence entre 6 días 12h y 7 días 12h desde ahora (24h centrada en 7d)
    window_start = today + timedelta(days=6)
    window_end = today + timedelta(days=8)

    sent = 0
    skipped = 0
    errors = 0

    async with task_session() as db:
        memberships = (
            await db.execute(
                select(Membership).where(
                    Membership.status == MembershipStatus.ACTIVE,
                    Membership.expires_at.is_not(None),
                    Membership.expires_at >= window_start,
                    Membership.expires_at <= window_end,
                )
            )
        ).scalars().all()

        for membership in memberships:
            try:
                user = await db.get(User, membership.user_id)
                if not user or not user.is_active:
                    skipped += 1
                    continue

                days_left = (membership.expires_at - today).days

                await create_and_dispatch_notification(
                    db,
                    tenant_id=membership.tenant_id,
                    user_id=membership.user_id,
                    title=f"Tu membresía vence en {days_left} día{'s' if days_left != 1 else ''}",
                    message="Renueva tu plan para seguir disfrutando del gimnasio sin interrupciones.",
                    type="warning",
                    action_url="?tab=plans",
                )
                await db.commit()
                sent += 1
                logger.info(
                    "membership_expiry_alert_sent",
                    user_id=str(membership.user_id),
                    expires_at=str(membership.expires_at),
                    days_left=days_left,
                )
            except Exception as exc:
                errors += 1
                logger.error(
                    "membership_expiry_alert_error",
                    user_id=str(membership.user_id),
                    exc_info=exc,
                )

    result = {"sent": sent, "skipped": skipped, "errors": errors}
    logger.info("membership_expiry_alerts_complete", **result)
    return result
