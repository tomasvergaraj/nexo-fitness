"""
Tarea Celery: encuesta NPS post-clase.

Se ejecuta cada hora. Detecta check-ins en clases ocurridos hace ~24h
(ventana 24-25h) y envía un push al miembro invitándolo a calificar la
clase de 0 a 10 en la app.

Dedup: si ya existe una Notification de tipo "nps_survey" para ese check-in,
no se reenvía. La respuesta en sí se controla con el constraint único de
nps_responses, así que un reenvío accidental no duplica datos.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.nps_surveys.send_nps_surveys", bind=True, max_retries=2)
def send_nps_surveys(self) -> dict:
    """Envía encuestas NPS push a miembros que asistieron a clase hace ~24h."""
    return asyncio.run(_run_nps_surveys())


async def _run_nps_surveys() -> dict:
    from sqlalchemy import select
    from app.tasks._db import task_session
    from app.models.business import CheckIn, GymClass, Notification
    from app.models.user import User
    from app.services.push_notification_service import create_and_dispatch_notification

    now = datetime.now(timezone.utc)
    # Check-ins hace 24-25h (la tarea corre cada hora → ventana de 1h)
    window_oldest = now - timedelta(hours=25)
    window_newest = now - timedelta(hours=24)

    sent = 0
    skipped = 0
    errors = 0

    async with task_session() as db:
        checkins = (
            await db.execute(
                select(CheckIn)
                .where(
                    CheckIn.gym_class_id.isnot(None),
                    CheckIn.checked_in_at >= window_oldest,
                    CheckIn.checked_in_at < window_newest,
                )
            )
        ).scalars().all()

        for checkin in checkins:
            try:
                action_url = f"?tab=nps&checkin={checkin.id}"

                # Dedup: ya enviamos encuesta para este check-in?
                existing = (
                    await db.execute(
                        select(Notification).where(
                            Notification.tenant_id == checkin.tenant_id,
                            Notification.user_id == checkin.user_id,
                            Notification.type == "nps_survey",
                            Notification.action_url == action_url,
                        )
                    )
                ).scalar_one_or_none()
                if existing:
                    skipped += 1
                    continue

                user = await db.get(User, checkin.user_id)
                if not user or not user.is_active:
                    skipped += 1
                    continue

                gym_class = await db.get(GymClass, checkin.gym_class_id)
                class_name = gym_class.name if gym_class else "tu clase"

                await create_and_dispatch_notification(
                    db,
                    tenant_id=checkin.tenant_id,
                    user_id=checkin.user_id,
                    title="¿Cómo estuvo tu clase?",
                    message=f"Califica {class_name} de 0 a 10. ¡Tu opinión nos ayuda a mejorar!",
                    type="nps_survey",
                    action_url=action_url,
                )
                await db.commit()
                sent += 1
                logger.info(
                    "nps_survey_sent",
                    user_id=str(checkin.user_id),
                    checkin_id=str(checkin.id),
                    class_id=str(checkin.gym_class_id),
                )
            except Exception as exc:
                errors += 1
                logger.error(
                    "nps_survey_error",
                    checkin_id=str(checkin.id),
                    exc_info=exc,
                )

    result = {"sent": sent, "skipped": skipped, "errors": errors}
    logger.info("nps_surveys_complete", **result)
    return result
