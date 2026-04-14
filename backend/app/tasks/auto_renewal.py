"""
Tarea Celery: renovación automática de membresías.

Se ejecuta una vez al día. Detecta membresías con auto_renew=True que
vencieron o vencen hoy y:
  1. Crea una nueva membresía activa (próximo período).
  2. Crea un pago pendiente (para registrar la deuda / facilitar el cobro).
  3. Envía notificación push al miembro avisando que su membresía fue renovada.

El cobro efectivo sigue siendo manual vía Fintoc/Stripe; esta tarea
garantiza continuidad del acceso mientras se procesa el pago.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.auto_renewal.process_auto_renewals", bind=True, max_retries=2)
def process_auto_renewals(self) -> dict:
    """Renueva automáticamente las membresías con auto_renew=True que vencen hoy."""
    return asyncio.run(_run_auto_renewals())


async def _run_auto_renewals() -> dict:
    from sqlalchemy import select, and_
    from app.core.database import AsyncSessionLocal
    from app.models.business import (
        Membership, MembershipStatus, Payment, PaymentStatus, PaymentMethod, Plan,
    )
    from app.models.user import User
    from app.services.push_notification_service import create_and_dispatch_notification

    now = datetime.now(timezone.utc)
    today = now.date()
    tomorrow = today + timedelta(days=1)

    renewed = 0
    skipped = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        # Find memberships expiring today (or already expired yesterday) with auto_renew=True
        memberships = (
            await db.execute(
                select(Membership).where(
                    Membership.status == MembershipStatus.ACTIVE,
                    Membership.auto_renew.is_(True),
                    Membership.expires_at.is_not(None),
                    Membership.expires_at >= today,
                    Membership.expires_at < tomorrow,
                )
            )
        ).scalars().all()

        for membership in memberships:
            try:
                user = await db.get(User, membership.user_id)
                if not user or not user.is_active:
                    skipped += 1
                    continue

                plan = await db.get(Plan, membership.plan_id)
                if not plan or not plan.is_active:
                    skipped += 1
                    continue

                # Compute new dates: starts right after current expiry
                new_starts = membership.expires_at
                if plan.duration_type == "days" and plan.duration_days:
                    new_expires = new_starts + timedelta(days=plan.duration_days)
                elif plan.duration_type == "monthly":
                    from dateutil.relativedelta import relativedelta
                    new_expires = new_starts + relativedelta(months=1)
                elif plan.duration_type == "annual":
                    from dateutil.relativedelta import relativedelta
                    new_expires = new_starts + relativedelta(years=1)
                else:
                    new_expires = new_starts + timedelta(days=30)

                # Update the existing membership to the new period
                membership.starts_at = new_starts
                membership.expires_at = new_expires
                membership.status = MembershipStatus.ACTIVE

                # Create a pending payment record (the actual charge goes through payment gateway)
                renewal_payment = Payment(
                    id=uuid4(),
                    tenant_id=membership.tenant_id,
                    user_id=membership.user_id,
                    membership_id=membership.id,
                    amount=Decimal(str(plan.price)),
                    currency=(plan.currency or "CLP").upper(),
                    status=PaymentStatus.PENDING,
                    method=PaymentMethod.OTHER,
                    description=f"Renovación automática — {plan.name}",
                )
                db.add(renewal_payment)

                # Notify the member
                await create_and_dispatch_notification(
                    db,
                    tenant_id=membership.tenant_id,
                    user_id=membership.user_id,
                    title="Tu membresía fue renovada",
                    message=(
                        f'Tu plan "{plan.name}" se renovó hasta el '
                        f"{new_expires.strftime('%d/%m/%Y')}. "
                        "Si aún no has pagado, contacta al gimnasio."
                    ),
                    type="success",
                    action_url="?tab=plans",
                )

                await db.commit()
                renewed += 1
                logger.info(
                    "membership_auto_renewed",
                    user_id=str(membership.user_id),
                    membership_id=str(membership.id),
                    new_expires=str(new_expires),
                )

            except Exception as exc:
                errors += 1
                await db.rollback()
                logger.error(
                    "membership_auto_renewal_error",
                    user_id=str(membership.user_id),
                    exc_info=exc,
                )

    result = {"renewed": renewed, "skipped": skipped, "errors": errors}
    logger.info("auto_renewals_complete", **result)
    return result
