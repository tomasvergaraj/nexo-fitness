"""Retention dashboard endpoints."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import TenantContext, get_tenant_context, require_roles
from app.models.business import CheckIn, Membership, MembershipStatus
from app.models.user import User, UserRole

retention_router = APIRouter(prefix="/retention", tags=["Retention"])


# ─── Schemas ──────────────────────────────────────────────────────────────────


class CohortCell(BaseModel):
    month_index: int  # 0 = mes de alta, 1 = +1 mes, ...
    retained: int
    pct: float


class CohortRow(BaseModel):
    cohort_month: str  # "2026-01"
    cohort_size: int
    cells: List[CohortCell]


class ChurnMonth(BaseModel):
    month: str  # "2026-04"
    active_at_start: int
    cancelled: int
    churn_pct: float


class AtRiskSummary(BaseModel):
    high: int
    medium: int
    low: int
    total_active_clients: int


class RetentionDashboard(BaseModel):
    cohort_matrix: List[CohortRow]
    churn_monthly: List[ChurnMonth]
    at_risk: AtRiskSummary
    avg_lifetime_days: Optional[int]
    months_window: int


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _month_floor(d: date) -> date:
    return d.replace(day=1)


def _add_months(d: date, n: int) -> date:
    y = d.year + (d.month - 1 + n) // 12
    m = (d.month - 1 + n) % 12 + 1
    return date(y, m, 1)


def _compute_cohort_matrix(
    cohort_data: dict[date, list[tuple[date, Optional[datetime]]]],
    cohort_starts: list[date],
    current_month_start: date,
    months: int,
) -> list[CohortRow]:
    """Construye la matriz de retención por cohorte de altas mensuales.

    Para cada cohorte (mes de alta), calcula cuántos miembros seguían activos
    al final de cada mes-offset posterior. Un miembro está retenido en el
    offset M si: cancelled_at is None  OR  cancelled_at >= checkpoint_end (M+1).
    """
    matrix: list[CohortRow] = []
    for c in cohort_starts:
        members = cohort_data.get(c, [])
        size = len(members)
        cells: list[CohortCell] = []
        max_offset = months - cohort_starts.index(c)
        for offset in range(max_offset):
            checkpoint_end = _add_months(c, offset + 1)
            if checkpoint_end > _add_months(current_month_start, 1):
                break
            retained = 0
            for _starts, cancelled_at in members:
                if cancelled_at is None:
                    retained += 1
                    continue
                cancelled_date = cancelled_at.date() if cancelled_at else None
                if cancelled_date and cancelled_date >= checkpoint_end:
                    retained += 1
            pct = (retained / size * 100) if size else 0.0
            cells.append(CohortCell(month_index=offset, retained=retained, pct=round(pct, 1)))
        matrix.append(CohortRow(cohort_month=c.strftime("%Y-%m"), cohort_size=size, cells=cells))
    return matrix


def _compute_risk(membership: Optional[Membership], last_checkin: Optional[datetime], now: datetime) -> str:
    if not membership:
        return "high"
    status = membership.status.value if hasattr(membership.status, "value") else str(membership.status)
    if status in ("expired", "cancelled"):
        return "high"
    if last_checkin is None:
        return "high"
    lc = last_checkin if last_checkin.tzinfo else last_checkin.replace(tzinfo=timezone.utc)
    days = (now - lc).days
    if days >= 30:
        return "high"
    if days >= 14:
        return "medium"
    return "low"


# ─── Endpoint ────────────────────────────────────────────────────────────────


@retention_router.get("/dashboard", response_model=RetentionDashboard)
async def get_retention_dashboard(
    months: int = 6,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    months = max(1, min(months, 12))
    tid = ctx.tenant_id
    now = datetime.now(timezone.utc)
    today = now.date()
    current_month_start = _month_floor(today)

    # ── Cohort matrix ────────────────────────────────────────────────────────
    cohort_starts = [_add_months(current_month_start, -i) for i in range(months - 1, -1, -1)]
    earliest = cohort_starts[0]

    cohort_mem_q = await db.execute(
        select(Membership.starts_at, Membership.cancelled_at).where(
            Membership.tenant_id == tid,
            Membership.starts_at >= earliest,
            Membership.starts_at < _add_months(current_month_start, 1),
        )
    )
    cohort_data: dict[date, list[tuple[date, Optional[datetime]]]] = {c: [] for c in cohort_starts}
    for starts_at, cancelled_at in cohort_mem_q.all():
        cohort_month = _month_floor(starts_at)
        if cohort_month in cohort_data:
            cohort_data[cohort_month].append((starts_at, cancelled_at))

    cohort_matrix = _compute_cohort_matrix(cohort_data, cohort_starts, current_month_start, months)

    # ── Churn mensual ────────────────────────────────────────────────────────
    churn_monthly: list[ChurnMonth] = []
    for i in range(months - 1, -1, -1):
        m_start = _add_months(current_month_start, -i)
        m_end = _add_months(m_start, 1)

        # Activas al inicio del mes: starts_at < m_start Y (cancelled_at IS NULL OR cancelled_at >= m_start)
        active_q = await db.execute(
            select(func.count()).where(
                Membership.tenant_id == tid,
                Membership.starts_at < m_start,
                or_(Membership.cancelled_at.is_(None), Membership.cancelled_at >= m_start),
            )
        )
        active_at_start = int(active_q.scalar() or 0)

        cancelled_q = await db.execute(
            select(func.count()).where(
                Membership.tenant_id == tid,
                Membership.cancelled_at.is_not(None),
                Membership.cancelled_at >= m_start,
                Membership.cancelled_at < m_end,
            )
        )
        cancelled = int(cancelled_q.scalar() or 0)
        churn_pct = (cancelled / active_at_start * 100) if active_at_start else 0.0
        churn_monthly.append(
            ChurnMonth(
                month=m_start.strftime("%Y-%m"),
                active_at_start=active_at_start,
                cancelled=cancelled,
                churn_pct=round(churn_pct, 1),
            )
        )

    # ── At-risk summary ──────────────────────────────────────────────────────
    # Tomar todos los clientes y su última membresía (más reciente starts_at)
    clients_q = await db.execute(
        select(User.id).where(User.tenant_id == tid, User.role == UserRole.CLIENT, User.is_active.is_(True))
    )
    client_ids = [row[0] for row in clients_q.all()]

    high = medium = low = 0
    if client_ids:
        # Última membresía por usuario
        latest_mem_q = await db.execute(
            select(Membership).where(
                Membership.tenant_id == tid,
                Membership.user_id.in_(client_ids),
            ).order_by(Membership.user_id, Membership.starts_at.desc())
        )
        latest_by_user: dict = {}
        for m in latest_mem_q.scalars().all():
            if m.user_id not in latest_by_user:
                latest_by_user[m.user_id] = m

        # Último check-in por usuario
        last_ci_q = await db.execute(
            select(CheckIn.user_id, func.max(CheckIn.checked_in_at))
            .where(CheckIn.tenant_id == tid, CheckIn.user_id.in_(client_ids))
            .group_by(CheckIn.user_id)
        )
        last_ci_by_user = {uid: ts for uid, ts in last_ci_q.all()}

        for uid in client_ids:
            risk = _compute_risk(latest_by_user.get(uid), last_ci_by_user.get(uid), now)
            if risk == "high":
                high += 1
            elif risk == "medium":
                medium += 1
            else:
                low += 1

    at_risk = AtRiskSummary(
        high=high, medium=medium, low=low, total_active_clients=len(client_ids)
    )

    # ── Avg lifetime (días) ──────────────────────────────────────────────────
    lifetime_q = await db.execute(
        select(Membership.starts_at, Membership.cancelled_at).where(
            Membership.tenant_id == tid,
            Membership.cancelled_at.is_not(None),
        )
    )
    days_list: list[int] = []
    for starts_at, cancelled_at in lifetime_q.all():
        if not cancelled_at:
            continue
        delta = (cancelled_at.date() if hasattr(cancelled_at, "date") else cancelled_at) - starts_at
        if delta.days > 0:
            days_list.append(delta.days)
    avg_lifetime_days = int(sum(days_list) / len(days_list)) if days_list else None

    return RetentionDashboard(
        cohort_matrix=cohort_matrix,
        churn_monthly=churn_monthly,
        at_risk=at_risk,
        avg_lifetime_days=avg_lifetime_days,
        months_window=months,
    )


# ─── NPS post-clase ───────────────────────────────────────────────────────────


class NPSSummaryResponse(BaseModel):
    nps_score: Optional[int]
    total: int
    promoters: int
    passives: int
    detractors: int
    average: Optional[float]
    days: int


@retention_router.get("/nps", response_model=NPSSummaryResponse)
async def get_nps_summary(
    days: int = 90,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
) -> NPSSummaryResponse:
    from app.services import nps_service

    window = max(7, min(days, 365))
    summary = await nps_service.get_nps_summary(db, tenant_id=ctx.tenant_id, days=window)
    return NPSSummaryResponse(**summary)
