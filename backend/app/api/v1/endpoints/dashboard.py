"""Dashboard API endpoints with tenant-scoped metrics."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_tenant_context, TenantContext, require_roles
from app.models.business import (
    GymClass, Reservation, CheckIn, Payment, Membership, MembershipStatus,
    PaymentStatus, ClassStatus,
)
from app.models.user import User, UserRole
from app.schemas.business import DashboardMetrics

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/metrics", response_model=DashboardMetrics)
async def get_dashboard_metrics(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=now.weekday())
    month_start = today_start.replace(day=1)

    tid = ctx.tenant_id

    # Revenue queries
    async def revenue_since(since: datetime) -> Decimal:
        q = select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.tenant_id == tid,
            Payment.status == PaymentStatus.COMPLETED,
            Payment.paid_at >= since,
        )
        result = await db.execute(q)
        return result.scalar() or Decimal("0")

    rev_today = await revenue_since(today_start)
    rev_week = await revenue_since(week_start)
    rev_month = await revenue_since(month_start)

    # Active members
    active_q = select(func.count()).where(
        Membership.tenant_id == tid,
        Membership.status == MembershipStatus.ACTIVE,
    )
    active_members = (await db.execute(active_q)).scalar() or 0

    total_q = select(func.count()).where(User.tenant_id == tid, User.role == UserRole.CLIENT, User.is_active == True)
    total_members = (await db.execute(total_q)).scalar() or 0

    # Classes today
    classes_q = select(func.count()).where(
        GymClass.tenant_id == tid,
        GymClass.start_time >= today_start,
        GymClass.start_time < today_start + timedelta(days=1),
        GymClass.status != ClassStatus.CANCELLED,
    )
    classes_today = (await db.execute(classes_q)).scalar() or 0

    # Reservations today
    res_q = select(func.count()).where(
        Reservation.tenant_id == tid,
        Reservation.created_at >= today_start,
    )
    reservations_today = (await db.execute(res_q)).scalar() or 0

    # Checkins today
    ci_q = select(func.count()).where(
        CheckIn.tenant_id == tid,
        CheckIn.checked_in_at >= today_start,
    )
    checkins_today = (await db.execute(ci_q)).scalar() or 0

    # Pending payments
    pp_q = select(func.count()).where(
        Payment.tenant_id == tid,
        Payment.status == PaymentStatus.PENDING,
    )
    pending_payments = (await db.execute(pp_q)).scalar() or 0

    # Expiring memberships (next 7 days)
    exp_q = select(func.count()).where(
        Membership.tenant_id == tid,
        Membership.status == MembershipStatus.ACTIVE,
        Membership.expires_at != None,
        Membership.expires_at <= (now + timedelta(days=7)).date(),
    )
    expiring = (await db.execute(exp_q)).scalar() or 0

    return DashboardMetrics(
        revenue_today=rev_today,
        revenue_week=rev_week,
        revenue_month=rev_month,
        active_members=active_members,
        total_members=total_members,
        classes_today=classes_today,
        reservations_today=reservations_today,
        checkins_today=checkins_today,
        pending_payments=pending_payments,
        expiring_memberships=expiring,
    )
