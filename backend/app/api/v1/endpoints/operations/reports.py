"""Reports router: overview (P&L, members, attendance) and attendance ranking."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_tenant_context,
    require_roles,
)
from app.models.business import (
    CheckIn,
    ClassStatus,
    GymClass,
    Membership,
    MembershipStatus,
    Payment,
    PaymentStatus,
    Plan,
    Reservation,
)
from app.models.pos import Expense, POSTransaction, POSTransactionItem, POSTransactionStatus
from app.models.user import User
from app.schemas.platform import (
    ExpenseCategoryPoint,
    ReportSeriesPoint,
    ReportsOverviewResponse,
    TopProductPoint,
)
from app.services.membership_sale_service import resolve_membership_timeline


reports_router = APIRouter(prefix="/reports", tags=["Reports"])


@reports_router.get("/overview", response_model=ReportsOverviewResponse)
async def get_reports_overview(
    range_key: str = Query("12m", pattern=r"^(30d|90d|12m)$"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=365 if range_key == "12m" else 90 if range_key == "90d" else 30)

    payments = (
        await db.execute(
            select(Payment).where(
                Payment.tenant_id == ctx.tenant_id,
                Payment.created_at >= since,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
    ).scalars().all()
    memberships = (
        await db.execute(select(Membership).where(Membership.tenant_id == ctx.tenant_id))
    ).scalars().all()
    plans = {
        plan.id: plan for plan in (
            await db.execute(select(Plan).where(Plan.tenant_id == ctx.tenant_id))
        ).scalars().all()
    }
    checkins = (
        await db.execute(select(CheckIn).where(CheckIn.tenant_id == ctx.tenant_id, CheckIn.checked_in_at >= since))
    ).scalars().all()
    classes = (
        await db.execute(
            select(GymClass).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.start_time >= since,
                GymClass.status != ClassStatus.CANCELLED,
            )
        )
    ).scalars().all()
    reservations = (
        await db.execute(select(Reservation).where(Reservation.tenant_id == ctx.tenant_id, Reservation.created_at >= since))
    ).scalars().all()

    revenue_total = sum((payment.amount for payment in payments), 0)
    memberships_by_user: dict[UUID, list[Membership]] = {}
    for membership in memberships:
        memberships_by_user.setdefault(membership.user_id, []).append(membership)
    active_members = sum(
        1
        for items in memberships_by_user.values()
        if resolve_membership_timeline(items, persist=False).access_membership is not None
    )
    renewed_periods = sum(1 for membership in memberships if membership.previous_membership_id is not None)
    renewal_rate = round((renewed_periods / len(memberships)) * 100, 1) if memberships else 0.0
    churn_rate = round((sum(1 for membership in memberships if membership.status == MembershipStatus.CANCELLED) / len(memberships)) * 100, 1) if memberships else 0.0

    month_keys = [(now - timedelta(days=30 * offset)).strftime("%b") for offset in reversed(range(12 if range_key == "12m" else 3 if range_key == "90d" else 1))]
    revenue_buckets = {key: 0 for key in month_keys}
    member_buckets = {key: 0 for key in month_keys}
    for payment in payments:
        key = payment.created_at.strftime("%b")
        if key in revenue_buckets:
            revenue_buckets[key] += float(payment.amount)
    for membership in memberships:
        key = membership.created_at.strftime("%b")
        if key in member_buckets:
            member_buckets[key] += 1

    plan_revenue: dict[str, float] = {}
    membership_by_id = {membership.id: membership for membership in memberships}
    for payment in payments:
        membership = membership_by_id.get(payment.membership_id) if payment.membership_id else None
        plan_name = (
            payment.plan_name_snapshot
            or (plans[payment.plan_id_snapshot].name if payment.plan_id_snapshot and payment.plan_id_snapshot in plans else None)
            or (plans[membership.plan_id].name if membership and membership.plan_id in plans else None)
            or "Sin plan"
        )
        plan_revenue[plan_name] = plan_revenue.get(plan_name, 0) + float(payment.amount)

    weekday_labels = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]
    attendance = {label: 0 for label in weekday_labels}
    for checkin in checkins:
        attendance[weekday_labels[checkin.checked_in_at.weekday()]] += 1

    reservation_counts: dict[UUID, int] = {}
    for reservation in reservations:
        reservation_counts[reservation.gym_class_id] = reservation_counts.get(reservation.gym_class_id, 0) + 1
    occupancy_points = []
    for gym_class in classes[:5]:
        occupancy = 0.0
        if gym_class.max_capacity:
            occupancy = round((reservation_counts.get(gym_class.id, 0) / gym_class.max_capacity) * 100, 1)
        occupancy_points.append({"name": gym_class.name, "occupancy": occupancy})

    colors = ["#06b6d4", "#10b981", "#8b5cf6", "#f59e0b", "#94a3b8"]
    revenue_by_plan = [
        {"name": name, "value": value, "color": colors[index % len(colors)]}
        for index, (name, value) in enumerate(sorted(plan_revenue.items(), key=lambda item: item[1], reverse=True))
    ]

    # POS data
    pos_txs = (
        await db.execute(
            select(POSTransaction).where(
                POSTransaction.tenant_id == ctx.tenant_id,
                POSTransaction.sold_at >= since,
                POSTransaction.status == POSTransactionStatus.COMPLETED,
            )
        )
    ).scalars().all()

    pos_tx_ids = [tx.id for tx in pos_txs]
    pos_items: list[POSTransactionItem] = []
    if pos_tx_ids:
        pos_items = (
            await db.execute(
                select(POSTransactionItem).where(POSTransactionItem.transaction_id.in_(pos_tx_ids))
            )
        ).scalars().all()

    pos_revenue = sum(tx.total for tx in pos_txs) if pos_txs else Decimal("0")
    pos_cogs = sum(item.unit_cost * item.quantity for item in pos_items) if pos_items else Decimal("0")
    pos_gross_profit = pos_revenue - pos_cogs
    pos_gross_margin_pct = round(float(pos_gross_profit / pos_revenue) * 100, 1) if pos_revenue else 0.0

    pos_revenue_buckets: dict[str, float] = {key: 0.0 for key in month_keys}
    for tx in pos_txs:
        key = tx.sold_at.strftime("%b")
        if key in pos_revenue_buckets:
            pos_revenue_buckets[key] += float(tx.total)

    product_revenue: dict[str, dict] = {}
    for item in pos_items:
        pid = str(item.product_id)
        if pid not in product_revenue:
            product_revenue[pid] = {"name": item.product_name, "revenue": Decimal("0"), "units": 0}
        product_revenue[pid]["revenue"] += item.unit_price * item.quantity
        product_revenue[pid]["units"] += item.quantity
    top_products = [
        TopProductPoint(name=v["name"], revenue=v["revenue"], units_sold=v["units"])
        for v in sorted(product_revenue.values(), key=lambda x: x["revenue"], reverse=True)[:5]
    ]

    # Expenses
    expenses = (
        await db.execute(
            select(Expense).where(
                Expense.tenant_id == ctx.tenant_id,
                Expense.expense_date >= since.date(),
            )
        )
    ).scalars().all()

    total_expenses = sum(e.amount for e in expenses) if expenses else Decimal("0")

    expense_category_labels = {
        "rent": "Arriendo", "utilities": "Servicios", "equipment": "Equipamiento",
        "supplies": "Insumos", "payroll": "Nómina", "maintenance": "Mantención",
        "marketing": "Marketing", "other": "Otro",
    }
    exp_by_cat: dict[str, Decimal] = {}
    for exp in expenses:
        cat = str(exp.category.value) if hasattr(exp.category, "value") else str(exp.category)
        exp_by_cat[cat] = exp_by_cat.get(cat, Decimal("0")) + exp.amount
    expenses_by_category = [
        ExpenseCategoryPoint(
            category=cat,
            label=expense_category_labels.get(cat, cat),
            amount=amount,
        )
        for cat, amount in sorted(exp_by_cat.items(), key=lambda x: x[1], reverse=True)
    ]

    expense_buckets: dict[str, float] = {key: 0.0 for key in month_keys}
    for exp in expenses:
        key = exp.expense_date.strftime("%b")
        if key in expense_buckets:
            expense_buckets[key] += float(exp.amount)

    # P&L
    total_revenue = Decimal(str(revenue_total)) + pos_revenue
    net_profit = total_revenue - pos_cogs - total_expenses
    net_margin_pct = round(float(net_profit / total_revenue) * 100, 1) if total_revenue else 0.0

    return ReportsOverviewResponse(
        revenue_total=revenue_total,
        active_members=active_members,
        renewal_rate=renewal_rate,
        churn_rate=churn_rate,
        revenue_series=[ReportSeriesPoint(label=label, value=value) for label, value in revenue_buckets.items()],
        members_series=[ReportSeriesPoint(label=label, value=value) for label, value in member_buckets.items()],
        revenue_by_plan=revenue_by_plan,
        attendance_by_day=[ReportSeriesPoint(label=label, value=value) for label, value in attendance.items()],
        occupancy_by_class=occupancy_points,
        pos_revenue=pos_revenue,
        pos_revenue_series=[ReportSeriesPoint(label=l, value=v) for l, v in pos_revenue_buckets.items()],
        pos_cogs=pos_cogs,
        pos_gross_profit=pos_gross_profit,
        pos_gross_margin_pct=pos_gross_margin_pct,
        top_products=top_products,
        total_expenses=total_expenses,
        expenses_by_category=expenses_by_category,
        expense_series=[ReportSeriesPoint(label=l, value=v) for l, v in expense_buckets.items()],
        total_revenue=total_revenue,
        net_profit=net_profit,
        net_margin_pct=net_margin_pct,
    )


@reports_router.get("/attendance")
async def get_attendance_report(
    range_key: str = Query("30d", pattern=r"^(30d|90d|12m)$"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Return class occupancy and instructor attendance rankings."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=365 if range_key == "12m" else 90 if range_key == "90d" else 30)
    tid = ctx.tenant_id

    classes = (await db.execute(
        select(GymClass).where(
            GymClass.tenant_id == tid,
            GymClass.start_time >= since,
            GymClass.status != ClassStatus.CANCELLED,
        )
    )).scalars().all()

    if not classes:
        return {"classes": [], "instructors": []}

    class_ids = [c.id for c in classes]

    res_counts_result = await db.execute(
        select(Reservation.gym_class_id, func.count().label("count"))
        .where(
            Reservation.tenant_id == tid,
            Reservation.gym_class_id.in_(class_ids),
            Reservation.status.in_(["confirmed", "attended"]),
        )
        .group_by(Reservation.gym_class_id)
    )
    res_by_class = {row.gym_class_id: row.count for row in res_counts_result}

    attended_res_result = await db.execute(
        select(Reservation.gym_class_id, func.count().label("count"))
        .where(
            Reservation.tenant_id == tid,
            Reservation.gym_class_id.in_(class_ids),
            Reservation.status == "attended",
        )
        .group_by(Reservation.gym_class_id)
    )
    attended_by_class = {row.gym_class_id: row.count for row in attended_res_result}

    legacy_checkin_result = await db.execute(
        select(CheckIn.gym_class_id, func.count().label("count"))
        .where(
            CheckIn.tenant_id == tid,
            CheckIn.gym_class_id.in_(class_ids),
            CheckIn.reservation_id.is_(None),
        )
        .group_by(CheckIn.gym_class_id)
    )
    legacy_checkin_by_class = {row.gym_class_id: row.count for row in legacy_checkin_result}

    class_stats: dict[str, dict] = {}
    for c in classes:
        key = c.name
        if key not in class_stats:
            class_stats[key] = {"name": key, "sessions": 0, "total_capacity": 0, "total_reservations": 0, "total_attended": 0}
        class_stats[key]["sessions"] += 1
        class_stats[key]["total_capacity"] += c.max_capacity or 0
        class_stats[key]["total_reservations"] += res_by_class.get(c.id, 0)
        class_stats[key]["total_attended"] += attended_by_class.get(c.id, 0) + legacy_checkin_by_class.get(c.id, 0)

    class_rows = []
    for stat in class_stats.values():
        occupancy_pct = round(stat["total_reservations"] / stat["total_capacity"] * 100, 1) if stat["total_capacity"] else 0
        attendance_pct = round(stat["total_attended"] / stat["total_reservations"] * 100, 1) if stat["total_reservations"] else 0
        class_rows.append({
            "name": stat["name"],
            "sessions": stat["sessions"],
            "avg_occupancy_pct": occupancy_pct,
            "avg_attendance_pct": attendance_pct,
            "total_reservations": stat["total_reservations"],
            "total_checkins": stat["total_attended"],
        })
    class_rows.sort(key=lambda x: x["avg_occupancy_pct"], reverse=True)

    instructor_ids = list({c.instructor_id for c in classes if c.instructor_id})
    instructor_stats: dict = {}
    for c in classes:
        if not c.instructor_id:
            continue
        iid = str(c.instructor_id)
        if iid not in instructor_stats:
            instructor_stats[iid] = {"instructor_id": iid, "name": None, "sessions": 0, "total_reservations": 0, "total_checkins": 0}
        instructor_stats[iid]["sessions"] += 1
        instructor_stats[iid]["total_reservations"] += res_by_class.get(c.id, 0)
        instructor_stats[iid]["total_checkins"] += attended_by_class.get(c.id, 0) + legacy_checkin_by_class.get(c.id, 0)

    if instructor_ids:
        users = (await db.execute(select(User).where(User.id.in_(instructor_ids)))).scalars().all()
        for u in users:
            iid = str(u.id)
            if iid in instructor_stats:
                instructor_stats[iid]["name"] = f"{u.first_name} {u.last_name}"

    instructor_rows = sorted(instructor_stats.values(), key=lambda x: x["total_checkins"], reverse=True)

    return {"classes": class_rows[:20], "instructors": instructor_rows[:10]}
