"""Celery tasks for scheduled campaign processing."""

from __future__ import annotations

import asyncio

from app.services.campaign_service import run_due_campaigns
from app.tasks import celery
from app.tasks._db import task_session_factory


async def _run() -> int:
    async with task_session_factory() as factory:
        return await run_due_campaigns(session_factory=factory)


@celery.task(name="app.tasks.campaigns.dispatch_due_campaigns")
def dispatch_due_campaigns() -> int:
    return asyncio.run(_run())
