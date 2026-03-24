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

    recent_ci_result = await db.execute(
        select(CheckIn)
        .where(CheckIn.tenant_id == tid)
        .order_by(CheckIn.checked_in_at.desc())
        .limit(5)
    )
    recent_checkins = recent_ci_result.scalars().all()

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

    completed_or_attended = await db.execute(
        select(func.count()).where(
            Reservation.tenant_id == tid,
            Reservation.status == "attended",
            Reservation.created_at >= month_start,
        )
    )
    total_reservations = await db.execute(
        select(func.count()).where(
            Reservation.tenant_id == tid,
            Reservation.created_at >= month_start,
        )
    )
    occupancy_rate = 0.0
    total_reservation_count = total_reservations.scalar() or 0
    if total_reservation_count:
        occupancy_rate = round(((completed_or_attended.scalar() or 0) / total_reservation_count) * 100, 1)

    cancelled_memberships = await db.execute(
        select(func.count()).where(
            Membership.tenant_id == tid,
            Membership.status == MembershipStatus.CANCELLED,
            Membership.created_at >= month_start,
        )
    )
    churn_rate = 0.0
    if total_members:
        churn_rate = round(((cancelled_memberships.scalar() or 0) / total_members) * 100, 1)

    revenue_chart = [
        {"label": "Hoy", "value": rev_today},
        {"label": "Semana", "value": rev_week},
        {"label": "Mes", "value": rev_month},
    ]

    classes_today_result = await db.execute(
        select(GymClass).where(
            GymClass.tenant_id == tid,
            GymClass.start_time >= today_start,
            GymClass.start_time < today_start + timedelta(days=1),
            GymClass.status != ClassStatus.CANCELLED,
        )
    )
    class_items = classes_today_result.scalars().all()
    class_occupancy_chart = [
        {
            "name": item.name,
            "occupancy": round((item.current_bookings / item.max_capacity) * 100, 1) if item.max_capacity else 0.0,
        }
        for item in class_items[:5]
    ]

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
        occupancy_rate=occupancy_rate,
        churn_rate=churn_rate,
        recent_checkins=recent_checkins,
        revenue_chart=revenue_chart,
        class_occupancy_chart=class_occupancy_chart,
    )
