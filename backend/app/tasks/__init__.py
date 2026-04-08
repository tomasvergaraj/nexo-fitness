"""Celery application setup for background workers."""

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery = Celery(
    "nexo_fitness",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.tasks.campaigns",
        "app.tasks.push_receipts",
        "app.tasks.trial_warnings",
    ],
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "dispatch-due-campaigns": {
            "task": "app.tasks.campaigns.dispatch_due_campaigns",
            "schedule": settings.CAMPAIGN_SCHEDULER_INTERVAL_SECONDS,
        },
        "refresh-pending-push-receipts": {
            "task": "app.tasks.push_receipts.refresh_pending_push_receipts",
            "schedule": settings.EXPO_PUSH_RECEIPT_POLL_INTERVAL_SECONDS,
        },
        # Avisos de trial: una vez al día a las 9am UTC (≈ 6am Chile)
        "send-trial-warning-emails": {
            "task": "app.tasks.trial_warnings.send_trial_warning_emails",
            "schedule": 86400,  # cada 24 horas
        },
    },
)
