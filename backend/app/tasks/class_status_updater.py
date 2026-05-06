"""
Tarea Celery: actualiza el estado de las clases segun la hora actual.

Cada 5 minutos:
  - SCHEDULED -> IN_PROGRESS si start_time <= now < end_time
  - SCHEDULED/IN_PROGRESS -> COMPLETED si end_time <= now

Esto evita que clases pasadas queden indefinidamente en estado 'scheduled',
lo que permitia reservas sobre clases ya finalizadas (validacion de UI/endpoint
se apoya tambien en este estado).
"""

import asyncio
from datetime import datetime, timezone

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.class_status_updater.sync_class_statuses", bind=True, max_retries=2)
def sync_class_statuses(self) -> dict:
    return asyncio.run(_run_sync_class_statuses())


async def _run_sync_class_statuses() -> dict:
    from sqlalchemy import update

    from app.models.business import ClassStatus, GymClass
    from app.tasks._db import task_session

    now = datetime.now(timezone.utc)
    transitioned_in_progress = 0
    transitioned_completed = 0

    async with task_session() as db:
        in_progress_result = await db.execute(
            update(GymClass)
            .where(
                GymClass.status == ClassStatus.SCHEDULED,
                GymClass.start_time <= now,
                GymClass.end_time > now,
            )
            .values(status=ClassStatus.IN_PROGRESS, updated_at=now)
            .execution_options(synchronize_session=False)
        )
        transitioned_in_progress = in_progress_result.rowcount or 0

        completed_result = await db.execute(
            update(GymClass)
            .where(
                GymClass.status.in_([ClassStatus.SCHEDULED, ClassStatus.IN_PROGRESS]),
                GymClass.end_time <= now,
            )
            .values(status=ClassStatus.COMPLETED, updated_at=now)
            .execution_options(synchronize_session=False)
        )
        transitioned_completed = completed_result.rowcount or 0

        await db.commit()

    if transitioned_in_progress or transitioned_completed:
        logger.info(
            "class_status_sync",
            in_progress=transitioned_in_progress,
            completed=transitioned_completed,
        )

    return {
        "in_progress": transitioned_in_progress,
        "completed": transitioned_completed,
    }
