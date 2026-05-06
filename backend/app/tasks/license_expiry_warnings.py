"""
Tarea Celery: envía emails de aviso cuando la licencia (plan pagado) de un tenant
está por vencer.

Se ejecuta una vez al día (configurable via beat_schedule).
Envía tres alertas:
  - 7 días antes del vencimiento
  - 3 días antes del vencimiento
  - 1 día antes del vencimiento

Solo afecta a tenants con status=ACTIVE y is_active=True.
Salta tenants que ya tienen una renovación encolada (next_plan_key con
next_plan_starts_at <= license_expires_at) — esos ya pagaron el siguiente período.
Para avisos de trial usar `trial_warnings.py`.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.license_expiry_warnings.send_license_expiry_emails", bind=True, max_retries=2)
def send_license_expiry_emails(self) -> dict:
    """Detecta tenants con licencia próxima a vencer y les envía email de aviso."""
    return asyncio.run(_run_license_expiry_warnings())


async def _run_license_expiry_warnings() -> dict:
    from sqlalchemy import select

    from app.core.config import get_settings
    from app.tasks._db import task_session
    from app.integrations.email.email_service import email_service
    from app.models.tenant import Tenant, TenantStatus
    from app.models.user import User, UserRole
    from app.services.billing_service import get_tenant_feature_flags
    from app.services.tenant_access_service import create_reactivation_checkout

    settings = get_settings()
    now = datetime.now(timezone.utc)

    # Ventanas de aviso: 7, 3 y 1 día antes del vencimiento
    windows = [
        {"days": 7, "tolerance_hours": 6},
        {"days": 3, "tolerance_hours": 6},
        {"days": 1, "tolerance_hours": 6},
    ]

    sent = 0
    skipped = 0
    errors = 0

    async with task_session() as db:
        result = await db.execute(
            select(Tenant).where(
                Tenant.status == TenantStatus.ACTIVE,
                Tenant.is_active == True,
                Tenant.license_expires_at.is_not(None),
            )
        )
        tenants = result.scalars().all()

        for tenant in tenants:
            license_end = tenant.license_expires_at
            if license_end.tzinfo is None:
                license_end = license_end.replace(tzinfo=timezone.utc)

            days_remaining = (license_end - now).total_seconds() / 86400

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

            # Si el tenant ya pagó la renovación (plan encolado que arranca al vencer),
            # no hace falta avisar.
            if tenant.next_plan_key and tenant.next_plan_starts_at:
                next_starts = tenant.next_plan_starts_at
                if next_starts.tzinfo is None:
                    next_starts = next_starts.replace(tzinfo=timezone.utc)
                if next_starts <= license_end + timedelta(days=1):
                    skipped += 1
                    continue

            owner_result = await db.execute(
                select(User).where(
                    User.tenant_id == tenant.id,
                    User.role == UserRole.OWNER,
                    User.is_active == True,
                )
            )
            owner = owner_result.scalar_one_or_none()
            if not owner:
                logger.warning("license_warning_no_owner", tenant=tenant.slug)
                skipped += 1
                continue

            features = get_tenant_feature_flags(tenant)
            plan_name = (
                features.get("saas_plan_name")
                or (tenant.license_type.value if tenant.license_type else "Plan actual")
            )

            try:
                checkout_url = settings.FRONTEND_URL + "/billing/expired"
                try:
                    generated_checkout_url = await create_reactivation_checkout(
                        db, tenant, owner, queue_after_payment=True
                    )
                    if generated_checkout_url:
                        checkout_url = generated_checkout_url
                except Exception:
                    pass

                ok = await email_service.send_license_expiring(
                    to_email=owner.email,
                    first_name=owner.first_name or "Usuario",
                    gym_name=tenant.name,
                    plan_name=str(plan_name),
                    days_remaining=target_days,
                    checkout_url=checkout_url,
                )
                if ok:
                    sent += 1
                    logger.info(
                        "license_warning_sent",
                        tenant=tenant.slug,
                        days_remaining=target_days,
                        owner=owner.email,
                    )
                else:
                    errors += 1
            except Exception as exc:
                errors += 1
                logger.error(
                    "license_warning_error",
                    tenant=tenant.slug,
                    owner=owner.email,
                    exc_info=exc,
                )

    summary = {"sent": sent, "skipped": skipped, "errors": errors}
    logger.info("license_expiry_warnings_complete", **summary)
    return summary
