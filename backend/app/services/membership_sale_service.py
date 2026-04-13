"""Helpers for registering manual membership sales from the staff panel."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Membership, MembershipStatus, Payment, PaymentMethod, PaymentStatus, Plan
from app.models.tenant import Tenant
from app.models.user import User
from app.services.tenant_quota_service import assert_can_create_client

_MONEY_QUANTIZER = Decimal("0.01")


@dataclass
class ManualMembershipSaleResult:
    membership: Membership
    payment: Payment
    replaced_membership_ids: list[UUID]


def resolve_plan_sale_amount(plan: Plan, custom_amount: Decimal | None = None) -> Decimal:
    if custom_amount is not None:
        return Decimal(custom_amount).quantize(_MONEY_QUANTIZER, rounding=ROUND_HALF_UP)

    base_amount = Decimal(plan.price or 0)
    discount_pct = Decimal(plan.discount_pct or 0)
    multiplier = Decimal("1") - (discount_pct / Decimal("100"))
    return (base_amount * multiplier).quantize(_MONEY_QUANTIZER, rounding=ROUND_HALF_UP)


def resolve_membership_expiration(
    *,
    starts_at: date,
    plan: Plan,
    explicit_expires_at: date | None = None,
) -> date | None:
    if explicit_expires_at is not None:
        return explicit_expires_at
    if plan.duration_days:
        return starts_at + timedelta(days=plan.duration_days)
    return None


async def create_manual_membership_sale(
    db: AsyncSession,
    *,
    tenant: Tenant,
    client: User,
    plan: Plan,
    starts_at: date,
    payment_method: str,
    amount: Decimal | None = None,
    currency: str | None = None,
    description: str | None = None,
    notes: str | None = None,
    expires_at: date | None = None,
    auto_renew: bool = False,
) -> ManualMembershipSaleResult:
    if not client.is_active:
        await assert_can_create_client(db, tenant)
        client.is_active = True

    now = datetime.now(timezone.utc)
    memberships_to_replace = (
        await db.execute(
            select(Membership).where(
                Membership.tenant_id == tenant.id,
                Membership.user_id == client.id,
                Membership.status.in_(
                    [
                        MembershipStatus.ACTIVE,
                        MembershipStatus.PENDING,
                        MembershipStatus.FROZEN,
                    ]
                ),
            )
        )
    ).scalars().all()

    replaced_membership_ids: list[UUID] = []
    for existing_membership in memberships_to_replace:
        existing_membership.status = MembershipStatus.CANCELLED
        existing_membership.cancelled_at = now
        replaced_membership_ids.append(existing_membership.id)

    membership = Membership(
        tenant_id=tenant.id,
        user_id=client.id,
        plan_id=plan.id,
        starts_at=starts_at,
        expires_at=resolve_membership_expiration(
            starts_at=starts_at,
            plan=plan,
            explicit_expires_at=expires_at,
        ),
        status=MembershipStatus.ACTIVE,
        auto_renew=auto_renew,
        notes=(notes or "").strip() or None,
    )
    db.add(membership)
    await db.flush()

    payment = Payment(
        tenant_id=tenant.id,
        user_id=client.id,
        membership_id=membership.id,
        amount=resolve_plan_sale_amount(plan, amount),
        currency=(currency or plan.currency or tenant.currency or "CLP").strip() or "CLP",
        method=PaymentMethod(payment_method),
        description=((description or "").strip() or f"Venta manual del plan {plan.name}"),
        status=PaymentStatus.COMPLETED,
        paid_at=now,
    )
    db.add(payment)
    await db.flush()
    await db.refresh(membership)
    await db.refresh(payment)

    return ManualMembershipSaleResult(
        membership=membership,
        payment=payment,
        replaced_membership_ids=replaced_membership_ids,
    )
