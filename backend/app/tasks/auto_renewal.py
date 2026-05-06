"""Tarea Celery para programar renovaciones como nuevos períodos inmutables."""

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import structlog

from app.tasks import celery

logger = structlog.get_logger()


@celery.task(name="app.tasks.auto_renewal.process_auto_renewals", bind=True, max_retries=2)
def process_auto_renewals(self) -> dict:
    """Renueva automáticamente las membresías con auto_renew=True que vencen hoy."""
    return asyncio.run(_run_auto_renewals())


@celery.task(name="app.tasks.auto_renewal.process_saas_scheduled_plans", bind=True, max_retries=2)
def process_saas_scheduled_plans(self) -> dict:
    """Activa planes SaaS programados cuya fecha de inicio ya llegó."""
    return asyncio.run(_run_saas_scheduled_plans())


async def _run_auto_renewals() -> dict:
    from sqlalchemy import select
    from app.tasks._db import task_session
    from app.models.business import (
        Membership, MembershipStatus, PaymentMethod, Plan,
    )
    from app.models.tenant import Tenant
    from app.models.user import User
    from app.services.membership_sale_service import SALE_SOURCE_AUTO_RENEWAL, allocate_membership_purchase
    from app.services.push_notification_service import create_and_dispatch_notification

    now = datetime.now(timezone.utc)
    today = now.date()
    tomorrow = today + timedelta(days=1)

    renewed = 0
    skipped = 0
    errors = 0

    async with task_session() as db:
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
                tenant = await db.get(Tenant, membership.tenant_id)
                if tenant is None:
                    skipped += 1
                    continue

                existing_period = (
                    await db.execute(
                        select(Membership).where(
                            Membership.tenant_id == membership.tenant_id,
                            Membership.user_id == membership.user_id,
                            Membership.previous_membership_id == membership.id,
                        )
                    )
                ).scalars().first()
                if existing_period is not None:
                    skipped += 1
                    continue

                purchase = await allocate_membership_purchase(
                    db,
                    tenant=tenant,
                    client=user,
                    plan=plan,
                    starts_at=membership.expires_at,
                    payment_method=PaymentMethod.OTHER,
                    amount=Decimal(str(plan.price)),
                    currency=(plan.currency or "CLP").upper(),
                    description=f"Renovación automática - {plan.name}",
                    auto_renew=membership.auto_renew,
                    sale_source=SALE_SOURCE_AUTO_RENEWAL,
                    payment_status="pending",
                )

                # Notify the member
                await create_and_dispatch_notification(
                    db,
                    tenant_id=membership.tenant_id,
                    user_id=membership.user_id,
                    title="Tu membresía fue renovada",
                    message=(
                        f'Tu plan "{plan.name}" se renovó hasta el '
                        f"{purchase.membership.expires_at.strftime('%d/%m/%Y') if purchase.membership.expires_at else 'nuevo aviso'}. "
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
                    membership_id=str(purchase.membership.id),
                    previous_membership_id=str(membership.id),
                    new_expires=str(purchase.membership.expires_at),
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


async def _run_saas_scheduled_plans() -> dict:
    from sqlalchemy import select
    from app.tasks._db import task_session
    from app.models.tenant import Tenant, TenantStatus
    from app.services.billing_service import activate_tenant_subscription
    from app.services.saas_plan_service import get_public_saas_plan_definition

    now = datetime.now(timezone.utc)
    activated = 0
    skipped = 0
    errors = 0

    async with task_session() as db:
        tenants = (
            await db.execute(
                select(Tenant).where(
                    Tenant.next_plan_key.is_not(None),
                    Tenant.next_plan_starts_at.is_not(None),
                    Tenant.next_plan_starts_at <= now,
                )
            )
        ).scalars().all()

        for tenant in tenants:
            try:
                plan = await get_public_saas_plan_definition(db, tenant.next_plan_key)
                if not plan:
                    logger.warning("saas_scheduled_plan_not_found", tenant_id=str(tenant.id), plan_key=tenant.next_plan_key)
                    tenant.next_plan_key = None
                    tenant.next_plan_name = None
                    tenant.next_plan_starts_at = None
                    await db.commit()
                    skipped += 1
                    continue

                activate_tenant_subscription(tenant, plan, starts_at=now)
                tenant.next_plan_key = None
                tenant.next_plan_name = None
                tenant.next_plan_starts_at = None
                await db.commit()
                activated += 1
                logger.info("saas_scheduled_plan_activated", tenant_id=str(tenant.id), plan_key=plan.key)

            except Exception as exc:
                errors += 1
                await db.rollback()
                logger.error("saas_scheduled_plan_error", tenant_id=str(tenant.id), exc_info=exc)

    result = {"activated": activated, "skipped": skipped, "errors": errors}
    logger.info("saas_scheduled_plans_complete", **result)
    return result
