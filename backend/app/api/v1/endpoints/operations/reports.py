"""Reports router: overview (P&L, members, attendance) and attendance ranking."""

from datetime import date, datetime, timedelta, timezone
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
    CashflowMonthPoint,
    ExpenseCategoryPoint,
    ReportSeriesPoint,
    ReportsOverviewResponse,
    TopProductPoint,
)
from app.core.timezone import tenant_zone
from app.services.membership_sale_service import resolve_membership_timeline

from ._common import _feature_map


reports_router = APIRouter(prefix="/reports", tags=["Reports"])

_MONTH_LABELS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]


def _period_key(day: date, cutoff_day: int | None) -> tuple[int, int]:
    """Período (año, mes) al que pertenece una fecha según el día de corte.

    Con corte D, el período "mes M" cubre desde el D+1 de M-1 hasta el D de M:
    una fecha posterior al corte ya cuenta para el mes siguiente.
    Sin corte (None): mes calendario.
    """
    if cutoff_day is not None and day.day > cutoff_day:
        return (day.year + 1, 1) if day.month == 12 else (day.year, day.month + 1)
    return (day.year, day.month)


def _period_label(period: tuple[int, int]) -> str:
    # Año completo: "Jul 25" se leía como día 25, no como 2025.
    year, month = period
    return f"{_MONTH_LABELS_ES[month - 1]} {year}"


def _last_periods(current: tuple[int, int], count: int) -> list[tuple[int, int]]:
    """(año, mes) en orden ascendente, terminando en el período actual."""
    periods: list[tuple[int, int]] = []
    year, month = current
    for _ in range(count):
        periods.append((year, month))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    periods.reverse()
    return periods


def build_cashflow(
    months: list[tuple[int, int]],
    income_by_month: dict[tuple[int, int], Decimal],
    cost_by_month: dict[tuple[int, int], Decimal],
) -> tuple[Decimal, Decimal, list[CashflowMonthPoint]]:
    """Saldo con arrastre: el excedente/déficit de cada mes es el pie del siguiente.

    El saldo inicial acumula toda la historia anterior al primer mes mostrado.
    Devuelve (saldo_inicial, saldo_final, serie_mensual).
    """
    first = months[0]
    opening = Decimal("0")
    for key in set(income_by_month) | set(cost_by_month):
        if key < first:
            opening += income_by_month.get(key, Decimal("0")) - cost_by_month.get(key, Decimal("0"))

    balance = opening
    series: list[CashflowMonthPoint] = []
    for year, month in months:
        income = income_by_month.get((year, month), Decimal("0"))
        costs = cost_by_month.get((year, month), Decimal("0"))
        net = income - costs
        balance += net
        series.append(
            CashflowMonthPoint(
                label=_period_label((year, month)),
                income=float(income),
                costs=float(costs),
                net=float(net),
                balance=float(balance),
            )
        )
    return opening, balance, series


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

    # P&L
    total_revenue = Decimal(str(revenue_total)) + pos_revenue
    net_profit = total_revenue - pos_cogs - total_expenses
    net_margin_pct = round(float(net_profit / total_revenue) * 100, 1) if total_revenue else 0.0

    # Flujo de caja con arrastre: agregados diarios sobre TODA la historia del
    # tenant (en hora local del gimnasio), agrupados por período según el día de
    # corte configurado. El saldo previo a la ventana entra como pie del primer mes.
    cutoff_raw = _feature_map(ctx.tenant).get("report_cutoff_day") if ctx.tenant else None
    try:
        cutoff_day = int(cutoff_raw) if cutoff_raw else None
    except (TypeError, ValueError):
        cutoff_day = None
    if cutoff_day is not None and not 1 <= cutoff_day <= 28:
        cutoff_day = None
    zone = tenant_zone(ctx)

    def _by_period(rows) -> dict[tuple[int, int], Decimal]:
        totals: dict[tuple[int, int], Decimal] = {}
        for row in rows:
            if row[0] is None:
                continue
            day = row[0].date() if isinstance(row[0], datetime) else row[0]
            key = _period_key(day, cutoff_day)
            totals[key] = totals.get(key, Decimal("0")) + Decimal(str(row[1]))
        return totals

    # Reutilizar el mismo objeto expresión en SELECT y GROUP BY: asyncpg parametriza
    # cada literal por separado y Postgres rechaza el GROUP BY si difieren.
    payment_day = func.date_trunc("day", func.timezone(str(zone), Payment.created_at))
    payment_periods = _by_period((await db.execute(
        select(payment_day, func.sum(Payment.amount))
        .where(Payment.tenant_id == ctx.tenant_id, Payment.status == PaymentStatus.COMPLETED)
        .group_by(payment_day)
    )).all())
    pos_day = func.date_trunc("day", func.timezone(str(zone), POSTransaction.sold_at))
    pos_periods = _by_period((await db.execute(
        select(pos_day, func.sum(POSTransaction.total))
        .where(POSTransaction.tenant_id == ctx.tenant_id, POSTransaction.status == POSTransactionStatus.COMPLETED)
        .group_by(pos_day)
    )).all())
    cogs_periods = _by_period((await db.execute(
        select(pos_day, func.sum(POSTransactionItem.unit_cost * POSTransactionItem.quantity))
        .select_from(POSTransactionItem)
        .join(POSTransaction, POSTransactionItem.transaction_id == POSTransaction.id)
        .where(POSTransaction.tenant_id == ctx.tenant_id, POSTransaction.status == POSTransactionStatus.COMPLETED)
        .group_by(pos_day)
    )).all())
    expense_periods = _by_period((await db.execute(
        select(Expense.expense_date, func.sum(Expense.amount))
        .where(Expense.tenant_id == ctx.tenant_id)
        .group_by(Expense.expense_date)
    )).all())

    income_by_period: dict[tuple[int, int], Decimal] = dict(payment_periods)
    for key, value in pos_periods.items():
        income_by_period[key] = income_by_period.get(key, Decimal("0")) + value
    cost_by_period: dict[tuple[int, int], Decimal] = dict(expense_periods)
    for key, value in cogs_periods.items():
        cost_by_period[key] = cost_by_period.get(key, Decimal("0")) + value

    current_period = _period_key(now.astimezone(zone).date(), cutoff_day)
    cashflow_periods = _last_periods(current_period, 12 if range_key == "12m" else 3 if range_key == "90d" else 1)
    opening_balance, closing_balance, cashflow_series = build_cashflow(
        cashflow_periods, income_by_period, cost_by_period
    )

    # Series mensuales de los gráficos: mismos períodos de corte que el saldo,
    # para que todo el reporte se mueva junto al cambiar el día de corte.
    member_period_counts: dict[tuple[int, int], int] = {}
    for membership in memberships:
        created = membership.created_at
        local_day = created.astimezone(zone).date() if created.tzinfo else created.date()
        key = _period_key(local_day, cutoff_day)
        member_period_counts[key] = member_period_counts.get(key, 0) + 1

    revenue_series = [
        ReportSeriesPoint(label=_period_label(p), value=float(payment_periods.get(p, Decimal("0"))))
        for p in cashflow_periods
    ]
    members_series = [
        ReportSeriesPoint(label=_period_label(p), value=member_period_counts.get(p, 0))
        for p in cashflow_periods
    ]
    pos_revenue_series = [
        ReportSeriesPoint(label=_period_label(p), value=float(pos_periods.get(p, Decimal("0"))))
        for p in cashflow_periods
    ]
    expense_series = [
        ReportSeriesPoint(label=_period_label(p), value=float(expense_periods.get(p, Decimal("0"))))
        for p in cashflow_periods
    ]

    return ReportsOverviewResponse(
        revenue_total=revenue_total,
        active_members=active_members,
        renewal_rate=renewal_rate,
        churn_rate=churn_rate,
        revenue_series=revenue_series,
        members_series=members_series,
        revenue_by_plan=revenue_by_plan,
        attendance_by_day=[ReportSeriesPoint(label=label, value=value) for label, value in attendance.items()],
        occupancy_by_class=occupancy_points,
        pos_revenue=pos_revenue,
        pos_revenue_series=pos_revenue_series,
        pos_cogs=pos_cogs,
        pos_gross_profit=pos_gross_profit,
        pos_gross_margin_pct=pos_gross_margin_pct,
        top_products=top_products,
        total_expenses=total_expenses,
        expenses_by_category=expenses_by_category,
        expense_series=expense_series,
        total_revenue=total_revenue,
        net_profit=net_profit,
        net_margin_pct=net_margin_pct,
        opening_balance=opening_balance,
        closing_balance=closing_balance,
        cashflow_series=cashflow_series,
        report_cutoff_day=cutoff_day,
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
