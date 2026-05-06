"""
Tarea Celery: recordatorio de clase 2 horas antes.

Se ejecuta cada 15 minutos. Detecta reservas confirmadas cuya clase
empieza en 90–125 minutos y envía un push al miembro.

Para evitar duplicados usa la tabla de Notifications: si el miembro ya
recibió una notificación de tipo "class_reminder" para esa clase en las
últimas 4 horas, no se reenvía.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.class_reminders.send_class_reminders", bind=True, max_retries=2)
def send_class_reminders(self) -> dict:
    """Envía recordatorios push a miembros con clase en ~2 horas."""
    return asyncio.run(_run_class_reminders())


async def _run_class_reminders() -> dict:
    from sqlalchemy import select, and_
    from app.tasks._db import task_session
    from app.models.business import (
        Reservation, ReservationStatus, GymClass, ClassStatus, Notification,
    )
    from app.models.tenant import Tenant
    from app.models.user import User
    from app.services.push_notification_service import create_and_dispatch_notification

    now = datetime.now(timezone.utc)
    # Ventana: clases que empiezan entre 90 y 125 minutos desde ahora
    window_start = now + timedelta(minutes=90)
    window_end = now + timedelta(minutes=125)
    # Ventana para dedup: si ya enviamos notif en las últimas 3h para la misma clase
    dedup_window = now - timedelta(hours=3)

    sent = 0
    skipped = 0
    errors = 0
    tenant_tz_cache: dict = {}

    async def _tenant_zone(tenant_id) -> ZoneInfo:
        cached = tenant_tz_cache.get(tenant_id)
        if cached is not None:
            return cached
        tenant = await db.get(Tenant, tenant_id)
        tz_name = tenant.timezone if tenant and tenant.timezone else "UTC"
        try:
            zone = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            zone = ZoneInfo("UTC")
        tenant_tz_cache[tenant_id] = zone
        return zone

    async with task_session() as db:
        # Reservas confirmadas para clases en la ventana de 90–125 min
        reservations = (
            await db.execute(
                select(Reservation)
                .join(GymClass, Reservation.gym_class_id == GymClass.id)
                .where(
                    Reservation.status == ReservationStatus.CONFIRMED,
                    GymClass.status == ClassStatus.SCHEDULED,
                    GymClass.start_time >= window_start,
                    GymClass.start_time <= window_end,
                )
            )
        ).scalars().all()

        for reservation in reservations:
            try:
                gym_class = await db.get(GymClass, reservation.gym_class_id)
                if not gym_class:
                    skipped += 1
                    continue

                # Dedup: ya enviamos recordatorio para esta clase a este usuario?
                existing = (
                    await db.execute(
                        select(Notification).where(
                            Notification.tenant_id == reservation.tenant_id,
                            Notification.user_id == reservation.user_id,
                            Notification.type == "class_reminder",
                            Notification.action_url == f"?tab=agenda&class={reservation.gym_class_id}",
                            Notification.created_at >= dedup_window,
                        )
                    )
                ).scalar_one_or_none()

                if existing:
                    skipped += 1
                    continue

                user = await db.get(User, reservation.user_id)
                if not user or not user.is_active:
                    skipped += 1
                    continue

                class_time = ""
                if gym_class.start_time:
                    start_utc = gym_class.start_time
                    if start_utc.tzinfo is None:
                        start_utc = start_utc.replace(tzinfo=timezone.utc)
                    zone = await _tenant_zone(reservation.tenant_id)
                    class_time = start_utc.astimezone(zone).strftime("%H:%M")

                await create_and_dispatch_notification(
                    db,
                    tenant_id=reservation.tenant_id,
                    user_id=reservation.user_id,
                    title=f"Tu clase empieza en 2 horas",
                    message=f"{gym_class.name}{f' a las {class_time}' if class_time else ''}. ¡Recuerda venir preparado!",
                    type="class_reminder",
                    action_url=f"?tab=agenda&class={reservation.gym_class_id}",
                )
                await db.commit()
                sent += 1
                logger.info(
                    "class_reminder_sent",
                    user_id=str(reservation.user_id),
                    class_id=str(reservation.gym_class_id),
                    class_name=gym_class.name,
                    start_time=gym_class.start_time.isoformat() if gym_class.start_time else None,
                )
            except Exception as exc:
                errors += 1
                logger.error(
                    "class_reminder_error",
                    reservation_id=str(reservation.id),
                    exc_info=exc,
                )

    result = {"sent": sent, "skipped": skipped, "errors": errors}
    logger.info("class_reminders_complete", **result)
    return result
