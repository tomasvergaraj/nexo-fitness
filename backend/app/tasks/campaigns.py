"""Celery tasks for scheduled campaign processing."""

from __future__ import annotations

import asyncio

from app.services.campaign_service import run_due_campaigns
from app.tasks import celery


@celery.task(name="app.tasks.campaigns.dispatch_due_campaigns")
def dispatch_due_campaigns() -> int:
    return asyncio.run(run_due_campaigns())
