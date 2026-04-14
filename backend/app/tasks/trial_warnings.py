"""
Tarea Celery: envía emails de aviso cuando el trial de un tenant está por vencer.

Se ejecuta una vez al día (configurable via beat_schedule).
Envía dos alertas:
  - 7 días antes del vencimiento
  - 1 día antes del vencimiento

Solo afecta a tenants con status=TRIAL y is_active=True.
Nunca envía a tenants que ya tienen una suscripción activa.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.trial_warnings.send_trial_warning_emails", bind=True, max_retries=2)
def send_trial_warning_emails(self) -> dict:
    """Detecta tenants con trial próximo a vencer y les envía email de aviso."""
    return asyncio.run(_run_trial_warnings())


async def _run_trial_warnings() -> dict:
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.core.config import get_settings
    from app.models.tenant import Tenant, TenantStatus
    from app.models.user import User, UserRole
    from app.integrations.email.email_service import email_service
    from app.services.tenant_access_service import create_reactivation_checkout

    settings = get_settings()
    now = datetime.now(timezone.utc)

    # Ventanas de aviso: 7 días y 1 día antes del vencimiento
    windows = [
        {"days": 7, "tolerance_hours": 6},
        {"days": 1, "tolerance_hours": 6},
    ]

    sent = 0
    skipped = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        # Solo tenants en trial activos
        result = await db.execute(
            select(Tenant).where(
                Tenant.status == TenantStatus.TRIAL,
                Tenant.is_active == True,
                Tenant.trial_ends_at.is_not(None),
            )
        )
        tenants = result.scalars().all()

        for tenant in tenants:
            trial_end = tenant.trial_ends_at
            if trial_end.tzinfo is None:
                trial_end = trial_end.replace(tzinfo=timezone.utc)

            days_remaining = (trial_end - now).total_seconds() / 86400

            # Determinar si cae en alguna ventana de aviso
            target_days = None
            for window in windows:
                lower = window["days"] - window["tolerance_hours"] / 24
                upper = window["days"] + window["tolerance_hours"] / 24
                if lower <= days_remaining <= upper:
                    target_days = window["days"]
                    break

            if target_days is None:
                skipped += 1
                continue

            # Buscar el owner del tenant
            owner_result = await db.execute(
                select(User).where(
                    User.tenant_id == tenant.id,
                    User.role == UserRole.OWNER,
                    User.is_active == True,
                )
            )
            owner = owner_result.scalar_one_or_none()
            if not owner:
                logger.warning("trial_warning_no_owner", tenant=tenant.slug)
                skipped += 1
                continue

            try:
                # Intentar obtener URL de checkout para reactivación
                checkout_url = settings.FRONTEND_URL + "/billing/expired"
                try:
                    generated_checkout_url = await create_reactivation_checkout(db, tenant, owner)
                    if generated_checkout_url:
                        checkout_url = generated_checkout_url
                except Exception:
                    pass  # Fallback a la billing wall

                ok = await email_service.send_trial_expiring(
                    to_email=owner.email,
                    first_name=owner.first_name or "Usuario",
                    gym_name=tenant.name,
                    days_remaining=target_days,
                    checkout_url=checkout_url,
                )
                if ok:
                    sent += 1
                    logger.info(
                        "trial_warning_sent",
                        tenant=tenant.slug,
                        days_remaining=target_days,
                        owner=owner.email,
                    )
                else:
                    errors += 1
            except Exception as exc:
                errors += 1
                logger.error(
                    "trial_warning_error",
                    tenant=tenant.slug,
                    owner=owner.email,
                    exc_info=exc,
                )

    result = {"sent": sent, "skipped": skipped, "errors": errors}
    logger.info("trial_warnings_complete", **result)
    return result
