"""Helpers for immutable membership periods, renewals, and payment snapshots."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Membership, MembershipStatus, Payment, PaymentMethod, PaymentStatus, Plan, PlanDuration
from app.models.tenant import Tenant
from app.models.user import User
from app.services.tenant_quota_service import assert_can_create_client

_MONEY_QUANTIZER = Decimal("0.01")

SALE_SOURCE_MANUAL = "manual_sale"
SALE_SOURCE_PUBLIC_CHECKOUT = "public_checkout"
SALE_SOURCE_AUTO_RENEWAL = "auto_renewal"


def membership_status_value(status: MembershipStatus | str | None) -> str | None:
    if status is None:
        return None
    return status.value if hasattr(status, "value") else str(status)


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
    duration_type = plan.duration_type.value if hasattr(plan.duration_type, "value") else str(plan.duration_type)
    if duration_type == PlanDuration.MONTHLY.value:
        return starts_at + timedelta(days=30)
    if duration_type == PlanDuration.ANNUAL.value:
        return starts_at + timedelta(days=365)
    if duration_type == PlanDuration.PERPETUAL.value:
        return None
    return None


def _membership_order_key(membership: Membership) -> tuple[date, date, datetime, str]:
    return (
        membership.starts_at or date.min,
        membership.expires_at or date.max,
        membership.created_at,
        str(membership.id),
    )


def _resolved_membership_status(membership: Membership, today: date) -> MembershipStatus:
    current_status = membership.status if isinstance(membership.status, MembershipStatus) else MembershipStatus(str(membership.status))

    if current_status == MembershipStatus.CANCELLED:
        return MembershipStatus.CANCELLED
    if current_status == MembershipStatus.FROZEN:
        if membership.expires_at is not None and membership.expires_at <= today:
            return MembershipStatus.EXPIRED
        return MembershipStatus.FROZEN
    if membership.starts_at > today:
        return MembershipStatus.PENDING
    if membership.expires_at is not None and membership.expires_at <= today:
        return MembershipStatus.EXPIRED
    return MembershipStatus.ACTIVE


@dataclass
class MembershipTimelineState:
    memberships: list[Membership] = field(default_factory=list)
    resolved_statuses: dict[UUID, MembershipStatus] = field(default_factory=dict)
    current_membership: Membership | None = None
    next_membership: Membership | None = None
    access_membership: Membership | None = None
    changed: bool = False

    def status_for(self, membership: Membership | None) -> MembershipStatus | None:
        if membership is None:
            return None
        return self.resolved_statuses.get(membership.id)


@dataclass
class MembershipPurchaseResult:
    membership: Membership
    payment: Payment
    replaced_membership_ids: list[UUID]
    effective_membership: Membership | None
    scheduled_membership: Membership | None
    scheduled: bool


# Backwards-compatible alias used by current endpoints/tests.
ManualMembershipSaleResult = MembershipPurchaseResult


def resolve_membership_timeline(
    memberships: list[Membership],
    *,
    today: date | None = None,
    persist: bool = False,
) -> MembershipTimelineState:
    current_day = today or datetime.now(timezone.utc).date()
    ordered = sorted(memberships, key=_membership_order_key)
    resolved_statuses: dict[UUID, MembershipStatus] = {}
    changed = False

    for membership in ordered:
        resolved = _resolved_membership_status(membership, current_day)
        resolved_statuses[membership.id] = resolved
        if persist and membership.status != resolved:
            membership.status = resolved
            changed = True

    current_candidates = [
        membership
        for membership in ordered
        if resolved_statuses[membership.id] in {MembershipStatus.ACTIVE, MembershipStatus.FROZEN}
        and membership.starts_at <= current_day
        and (membership.expires_at is None or membership.expires_at > current_day)
    ]
    current_membership = max(current_candidates, key=_membership_order_key, default=None)

    next_candidates = [
        membership
        for membership in ordered
        if resolved_statuses[membership.id] == MembershipStatus.PENDING and membership.starts_at > current_day
    ]
    next_membership = min(next_candidates, key=_membership_order_key, default=None)

    access_membership = (
        current_membership
        if current_membership and resolved_statuses.get(current_membership.id) == MembershipStatus.ACTIVE
        else None
    )

    return MembershipTimelineState(
        memberships=ordered,
        resolved_statuses=resolved_statuses,
        current_membership=current_membership,
        next_membership=next_membership,
        access_membership=access_membership,
        changed=changed,
    )


async def get_user_memberships(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
) -> list[Membership]:
    return (
        await db.execute(
            select(Membership)
            .where(Membership.tenant_id == tenant_id, Membership.user_id == user_id)
            .order_by(Membership.starts_at.asc(), Membership.created_at.asc(), Membership.id.asc())
        )
    ).scalars().all()


async def sync_membership_timeline(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    today: date | None = None,
) -> MembershipTimelineState:
    memberships = await get_user_memberships(db, tenant_id=tenant_id, user_id=user_id)
    state = resolve_membership_timeline(memberships, today=today, persist=True)
    if state.changed:
        await db.flush()
    return state


def apply_payment_membership_snapshot(
    payment: Payment,
    *,
    membership: Membership | None,
    plan: Plan | None,
    membership_status: MembershipStatus | str | None = None,
) -> Payment:
    payment.plan_id_snapshot = plan.id if plan else None
    payment.plan_name_snapshot = plan.name if plan else None
    payment.membership_starts_at_snapshot = membership.starts_at if membership else None
    payment.membership_expires_at_snapshot = membership.expires_at if membership else None
    payment.membership_status_snapshot = membership_status_value(
        membership_status if membership_status is not None else (membership.status if membership else None)
    )
    return payment


def _default_payment_description(plan: Plan, sale_source: str) -> str:
    if sale_source == SALE_SOURCE_AUTO_RENEWAL:
        return f"Renovación automática - {plan.name}"
    if sale_source == SALE_SOURCE_PUBLIC_CHECKOUT:
        return f"Checkout publico - {plan.name}"
    return f"Venta manual del plan {plan.name}"


def _purchase_status_for_period(*, starts_at: date, expires_at: date | None, today: date) -> MembershipStatus:
    if starts_at > today:
        return MembershipStatus.PENDING
    if expires_at is not None and expires_at <= today:
        return MembershipStatus.EXPIRED
    return MembershipStatus.ACTIVE


def _latest_membership_for_history(memberships: list[Membership]) -> Membership | None:
    eligible = [membership for membership in memberships if membership.status != MembershipStatus.CANCELLED]
    if not eligible:
        eligible = memberships
    return max(eligible, key=_membership_order_key, default=None)


async def allocate_membership_purchase(
    db: AsyncSession,
    *,
    tenant: Tenant,
    client: User,
    plan: Plan,
    starts_at: date,
    payment_method: PaymentMethod | str,
    amount: Decimal | None = None,
    currency: str | None = None,
    description: str | None = None,
    notes: str | None = None,
    expires_at: date | None = None,
    auto_renew: bool = False,
    sale_source: str,
    payment_status: PaymentStatus | str = PaymentStatus.COMPLETED,
    paid_at: datetime | None = None,
    external_id: str | None = None,
    receipt_url: str | None = None,
    metadata: dict | None = None,
    existing_payment: Payment | None = None,
) -> MembershipPurchaseResult:
    if not client.is_active:
        await assert_can_create_client(db, tenant)
        client.is_active = True

    now = datetime.now(timezone.utc)
    today = now.date()
    state = await sync_membership_timeline(db, tenant_id=tenant.id, user_id=client.id, today=today)
    queue_memberships = [
        membership
        for membership in state.memberships
        if state.status_for(membership) in {MembershipStatus.ACTIVE, MembershipStatus.PENDING, MembershipStatus.FROZEN}
    ]
    queue_tail = max(queue_memberships, key=_membership_order_key, default=None)

    allocated_starts_at = starts_at
    previous_membership = None
    if queue_tail is not None:
        if queue_tail.expires_at is None:
            raise ValueError("No se puede programar una renovación sobre una membresía perpetua activa")
        previous_membership = queue_tail
        if allocated_starts_at < queue_tail.expires_at:
            allocated_starts_at = queue_tail.expires_at
    else:
        previous_membership = _latest_membership_for_history(state.memberships)

    allocated_expires_at = resolve_membership_expiration(
        starts_at=allocated_starts_at,
        plan=plan,
        explicit_expires_at=expires_at,
    )
    if allocated_expires_at is not None and allocated_expires_at <= allocated_starts_at:
        raise ValueError("La fecha de vencimiento debe ser posterior al inicio del período comprado")

    purchase_status = _purchase_status_for_period(
        starts_at=allocated_starts_at,
        expires_at=allocated_expires_at,
        today=today,
    )

    membership = Membership(
        tenant_id=tenant.id,
        user_id=client.id,
        plan_id=plan.id,
        starts_at=allocated_starts_at,
        expires_at=allocated_expires_at,
        status=purchase_status,
        auto_renew=auto_renew,
        notes=(notes or "").strip() or None,
        previous_membership_id=previous_membership.id if previous_membership else None,
        sale_source=sale_source,
    )
    db.add(membership)
    await db.flush()

    resolved_payment_method = (
        payment_method if isinstance(payment_method, PaymentMethod) else PaymentMethod(str(payment_method))
    )
    resolved_payment_status = (
        payment_status if isinstance(payment_status, PaymentStatus) else PaymentStatus(str(payment_status))
    )
    payment = existing_payment or Payment(
        tenant_id=tenant.id,
        user_id=client.id,
        membership_id=membership.id,
        amount=Decimal("0.00"),
        currency="CLP",
        status=resolved_payment_status,
        method=resolved_payment_method,
    )
    if existing_payment is None:
        db.add(payment)

    payment.tenant_id = tenant.id
    payment.user_id = client.id
    payment.membership_id = membership.id
    payment.amount = resolve_plan_sale_amount(plan, amount)
    payment.currency = (currency or plan.currency or tenant.currency or "CLP").strip().upper() or "CLP"
    payment.status = resolved_payment_status
    payment.method = resolved_payment_method
    payment.description = ((description or "").strip() or _default_payment_description(plan, sale_source))
    payment.external_id = external_id
    payment.receipt_url = receipt_url
    payment.metadata_json = json.dumps(metadata) if metadata is not None else payment.metadata_json
    payment.paid_at = paid_at if paid_at is not None else (now if resolved_payment_status == PaymentStatus.COMPLETED else None)
    apply_payment_membership_snapshot(
        payment,
        membership=membership,
        plan=plan,
        membership_status=purchase_status,
    )
    await db.flush()

    refreshed_state = await sync_membership_timeline(db, tenant_id=tenant.id, user_id=client.id, today=today)
    scheduled = refreshed_state.current_membership is not membership
    effective_membership = refreshed_state.current_membership
    scheduled_membership = membership if scheduled else refreshed_state.next_membership

    await db.refresh(membership)
    await db.refresh(payment)

    return MembershipPurchaseResult(
        membership=membership,
        payment=payment,
        replaced_membership_ids=[],
        effective_membership=effective_membership,
        scheduled_membership=scheduled_membership,
        scheduled=scheduled,
    )


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
    return await allocate_membership_purchase(
        db,
        tenant=tenant,
        client=client,
        plan=plan,
        starts_at=starts_at,
        payment_method=payment_method,
        amount=amount,
        currency=currency,
        description=description,
        notes=notes,
        expires_at=expires_at,
        auto_renew=auto_renew,
        sale_source=SALE_SOURCE_MANUAL,
        payment_status=PaymentStatus.COMPLETED,
    )
