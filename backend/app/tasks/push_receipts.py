"""Celery tasks for Expo push receipt polling."""

from __future__ import annotations

import asyncio

from app.core.database import async_session_factory
from app.services.push_notification_service import refresh_push_receipts
from app.tasks import celery


async def _refresh_pending_push_receipts() -> int:
    async with async_session_factory() as db:
        updated = await refresh_push_receipts(db)
        await db.commit()
        return updated


@celery.task(name="app.tasks.push_receipts.refresh_pending_push_receipts")
def refresh_pending_push_receipts() -> int:
    return asyncio.run(_refresh_pending_push_receipts())
