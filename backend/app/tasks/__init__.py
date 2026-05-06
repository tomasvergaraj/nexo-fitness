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
        "app.tasks.license_expiry_warnings",
        "app.tasks.membership_alerts",
        "app.tasks.class_reminders",
        "app.tasks.class_status_updater",
        "app.tasks.auto_renewal",
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
        # Avisos de vencimiento de licencia (planes pagados): una vez al día
        "send-license-expiry-emails": {
            "task": "app.tasks.license_expiry_warnings.send_license_expiry_emails",
            "schedule": 86400,  # cada 24 horas
        },
        # Alertas de membresía por vencer: una vez al día a las 10am UTC (≈ 7am Chile)
        "send-membership-expiry-alerts": {
            "task": "app.tasks.membership_alerts.send_membership_expiry_alerts",
            "schedule": 86400,  # cada 24 horas
        },
        # Recordatorios de clase 2h antes: cada 15 minutos
        "send-class-reminders": {
            "task": "app.tasks.class_reminders.send_class_reminders",
            "schedule": 900,  # cada 15 minutos
        },
        # Sincroniza estado de clases (scheduled -> in_progress -> completed): cada 5 min
        "sync-class-statuses": {
            "task": "app.tasks.class_status_updater.sync_class_statuses",
            "schedule": 300,
        },
        # Renovación automática de membresías: una vez al día a las 8am UTC (≈ 5am Chile)
        "process-auto-renewals": {
            "task": "app.tasks.auto_renewal.process_auto_renewals",
            "schedule": 86400,  # cada 24 horas
        },
    },
)
