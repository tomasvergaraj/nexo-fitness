"""Dashboard API endpoints with tenant-scoped metrics."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import extract, func, select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_tenant_context, TenantContext, require_roles
from app.models.business import (
    Branch, Campaign, CampaignStatus, GymClass, Plan, Reservation, CheckIn, Payment, Membership, MembershipStatus,
    PaymentStatus, ClassStatus, TrainingProgram,
)
from app.models.tenant import TenantStatus
from app.models.user import User, UserRole
from app.schemas.business import CheckInResponse, DashboardMetrics
from app.services.membership_sale_service import resolve_membership_timeline

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def _valid_program_class_filter(tenant_id: UUID):
    return or_(
        GymClass.program_id.is_(None),
        select(TrainingProgram.id)
        .where(
            TrainingProgram.id == GymClass.program_id,
            TrainingProgram.tenant_id == tenant_id,
        )
        .exists(),
    )


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

    memberships = (
        await db.execute(select(Membership).where(Membership.tenant_id == tid))
    ).scalars().all()
    memberships_by_user: dict[UUID, list[Membership]] = {}
    for membership in memberships:
        memberships_by_user.setdefault(membership.user_id, []).append(membership)

    active_members = 0
    expiring = 0
    expiring_cutoff = (now + timedelta(days=7)).date()
    for user_memberships in memberships_by_user.values():
        timeline = resolve_membership_timeline(user_memberships, today=now.date(), persist=False)
        if timeline.access_membership is not None:
            active_members += 1
            if timeline.access_membership.expires_at and timeline.access_membership.expires_at <= expiring_cutoff:
                expiring += 1

    total_q = select(func.count()).where(User.tenant_id == tid, User.role == UserRole.CLIENT, User.is_active == True)
    total_members = (await db.execute(total_q)).scalar() or 0

    # Classes today
    classes_q = select(func.count()).where(
        GymClass.tenant_id == tid,
        _valid_program_class_filter(tid),
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
    recent_user_ids = [checkin.user_id for checkin in recent_checkins]
    recent_users = {
        user.id: user
        for user in (
            await db.execute(select(User).where(User.id.in_(recent_user_ids)))
        ).scalars().all()
    } if recent_user_ids else {}

    # Pending payments
    pp_q = select(func.count()).where(
        Payment.tenant_id == tid,
        Payment.status == PaymentStatus.PENDING,
    )
    pending_payments = (await db.execute(pp_q)).scalar() or 0

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
            _valid_program_class_filter(tid),
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
        recent_checkins=[
            CheckInResponse(
                id=checkin.id,
                user_id=checkin.user_id,
                user_name=recent_users.get(checkin.user_id).full_name if recent_users.get(checkin.user_id) else None,
                gym_class_id=checkin.gym_class_id,
                check_type=checkin.check_type,
                checked_in_at=checkin.checked_in_at,
            )
            for checkin in recent_checkins
        ],
        revenue_chart=revenue_chart,
        class_occupancy_chart=class_occupancy_chart,
    )


# ---------------------------------------------------------------------------
# Panel del Día — vista unificada del día actual para el owner
# ---------------------------------------------------------------------------

class DayPanelClass(BaseModel):
    id: UUID
    name: str
    class_type: Optional[str] = None
    start_time: datetime
    end_time: datetime
    instructor_name: Optional[str] = None
    current_bookings: int
    max_capacity: int
    status: str


class DayPanelPayment(BaseModel):
    id: UUID
    user_name: Optional[str] = None
    amount: float
    method: str
    paid_at: Optional[datetime] = None
    plan_name: Optional[str] = None


class DayPanelBirthday(BaseModel):
    id: UUID
    full_name: str
    email: str


class DayPanel(BaseModel):
    date: str
    classes: list[DayPanelClass]
    payments: list[DayPanelPayment]
    birthdays: list[DayPanelBirthday]
    checkins_count: int
    revenue_today: float


@router.get("/today", response_model=DayPanel)
async def get_day_panel(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
) -> DayPanel:
    """Unified view of the current day: classes, payments, birthdays, check-ins."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = today_start + timedelta(days=1)
    tid = ctx.tenant_id

    # Today's classes
    classes_result = await db.execute(
        select(GymClass)
        .where(
            GymClass.tenant_id == tid,
            _valid_program_class_filter(tid),
            GymClass.start_time >= today_start,
            GymClass.start_time < tomorrow,
            GymClass.status != ClassStatus.CANCELLED,
        )
        .order_by(GymClass.start_time.asc())
    )
    classes = classes_result.scalars().all()

    # Batch-fetch instructors
    instructor_ids = {c.instructor_id for c in classes if c.instructor_id}
    instructors: dict[Any, str] = {}
    if instructor_ids:
        instr_result = await db.execute(select(User).where(User.id.in_(instructor_ids)))
        for u in instr_result.scalars().all():
            instructors[u.id] = f"{u.first_name} {u.last_name}".strip()

    day_classes = [
        DayPanelClass(
            id=c.id,
            name=c.name,
            class_type=c.class_type,
            start_time=c.start_time,
            end_time=c.end_time,
            instructor_name=instructors.get(c.instructor_id) if c.instructor_id else None,
            current_bookings=c.current_bookings,
            max_capacity=c.max_capacity,
            status=c.status.value if hasattr(c.status, "value") else str(c.status),
        )
        for c in classes
    ]

    # Today's completed payments
    payments_result = await db.execute(
        select(Payment)
        .where(
            Payment.tenant_id == tid,
            Payment.status == PaymentStatus.COMPLETED,
            Payment.paid_at >= today_start,
            Payment.paid_at < tomorrow,
        )
        .order_by(Payment.paid_at.desc())
        .limit(20)
    )
    payments = payments_result.scalars().all()

    # Batch-fetch payer names
    payer_ids = {p.user_id for p in payments if p.user_id}
    payers: dict[Any, str] = {}
    if payer_ids:
        payers_result = await db.execute(select(User).where(User.id.in_(payer_ids)))
        for u in payers_result.scalars().all():
            payers[u.id] = f"{u.first_name} {u.last_name}".strip()

    day_payments = [
        DayPanelPayment(
            id=p.id,
            user_name=payers.get(p.user_id) if p.user_id else None,
            amount=float(p.amount),
            method=p.method or "manual",
            paid_at=p.paid_at,
            plan_name=p.description,
        )
        for p in payments
    ]

    # Today's birthdays (clients whose date_of_birth day+month matches today)
    birthdays_result = await db.execute(
        select(User).where(
            User.tenant_id == tid,
            User.is_active.is_(True),
            User.date_of_birth.is_not(None),
            extract("month", User.date_of_birth) == now.month,
            extract("day", User.date_of_birth) == now.day,
        )
    )
    birthday_users = birthdays_result.scalars().all()
    day_birthdays = [
        DayPanelBirthday(
            id=u.id,
            full_name=f"{u.first_name} {u.last_name}".strip(),
            email=u.email,
        )
        for u in birthday_users
    ]

    # Check-ins count today
    checkins_count_result = await db.execute(
        select(func.count()).where(
            CheckIn.tenant_id == tid,
            CheckIn.checked_in_at >= today_start,
            CheckIn.checked_in_at < tomorrow,
        )
    )
    checkins_count = checkins_count_result.scalar() or 0

    # Revenue today
    rev_result = await db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.tenant_id == tid,
            Payment.status == PaymentStatus.COMPLETED,
            Payment.paid_at >= today_start,
            Payment.paid_at < tomorrow,
        )
    )
    revenue_today = float(rev_result.scalar() or 0)

    return DayPanel(
        date=today_start.date().isoformat(),
        classes=day_classes,
        payments=day_payments,
        birthdays=day_birthdays,
        checkins_count=checkins_count,
        revenue_today=revenue_today,
    )


class SidebarCounters(BaseModel):
    classes_today: int
    clients_expiring_soon: int
    marketing_scheduled: int


@router.get("/sidebar-counters", response_model=SidebarCounters)
async def get_sidebar_counters(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    """Contadores livianos para mostrar badges junto a items del sidebar."""
    tid = ctx.tenant_id
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = today_start + timedelta(days=1)
    in_7_days = today_start + timedelta(days=7)

    classes_today_q = await db.execute(
        select(func.count()).where(
            GymClass.tenant_id == tid,
            GymClass.status == ClassStatus.SCHEDULED,
            GymClass.start_time >= today_start,
            GymClass.start_time < tomorrow,
        )
    )
    classes_today = int(classes_today_q.scalar() or 0)

    expiring_q = await db.execute(
        select(func.count()).where(
            Membership.tenant_id == tid,
            Membership.status == MembershipStatus.ACTIVE,
            Membership.end_date.is_not(None),
            Membership.end_date >= today_start,
            Membership.end_date <= in_7_days,
        )
    )
    clients_expiring_soon = int(expiring_q.scalar() or 0)

    scheduled_q = await db.execute(
        select(func.count()).where(
            Campaign.tenant_id == tid,
            Campaign.status == CampaignStatus.SCHEDULED,
        )
    )
    marketing_scheduled = int(scheduled_q.scalar() or 0)

    return SidebarCounters(
        classes_today=classes_today,
        clients_expiring_soon=clients_expiring_soon,
        marketing_scheduled=marketing_scheduled,
    )


class OnboardingItem(BaseModel):
    key: str
    label: str
    description: str
    done: bool
    action_url: str


class OnboardingChecklist(BaseModel):
    items: list[OnboardingItem]
    completed_count: int
    total: int
    all_done: bool


@router.get("/onboarding-checklist", response_model=OnboardingChecklist)
async def get_onboarding_checklist(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Estado de los primeros pasos del gimnasio para guiar el onboarding."""
    tid = ctx.tenant_id
    tenant = ctx.tenant

    branches_count = int((await db.execute(
        select(func.count()).where(Branch.tenant_id == tid, Branch.is_active.is_(True))
    )).scalar() or 0)
    plans_count = int((await db.execute(
        select(func.count()).where(Plan.tenant_id == tid, Plan.is_active.is_(True))
    )).scalar() or 0)
    classes_count = int((await db.execute(
        select(func.count()).where(GymClass.tenant_id == tid)
    )).scalar() or 0)
    clients_count = int((await db.execute(
        select(func.count()).where(User.tenant_id == tid, User.role == UserRole.CLIENT)
    )).scalar() or 0)

    has_logo = bool(tenant and tenant.logo_url)
    has_active_subscription = bool(tenant and tenant.status == TenantStatus.ACTIVE)

    items = [
        OnboardingItem(
            key="branch", label="Crea tu sucursal",
            description="Define al menos una sede física u online.",
            done=branches_count > 0, action_url="/settings?tab=branches",
        ),
        OnboardingItem(
            key="plan", label="Configura un plan",
            description="Define precios y duraciones para tus membresías.",
            done=plans_count > 0, action_url="/plans",
        ),
        OnboardingItem(
            key="class", label="Programa tu primera clase",
            description="Agrega clases al calendario para que los clientes puedan reservar.",
            done=classes_count > 0, action_url="/classes",
        ),
        OnboardingItem(
            key="client", label="Agrega un cliente",
            description="Importa tu cartera o crea clientes manualmente.",
            done=clients_count > 0, action_url="/clients",
        ),
        OnboardingItem(
            key="branding", label="Sube el logo del gimnasio",
            description="Tu logo se mostrará a los clientes en la app y en la landing.",
            done=has_logo, action_url="/settings?tab=branding",
        ),
        OnboardingItem(
            key="subscription", label="Activa tu suscripción",
            description="Pasa de prueba a activa para mantener el acceso completo.",
            done=has_active_subscription, action_url="/subscription",
        ),
    ]
    completed = sum(1 for i in items if i.done)
    return OnboardingChecklist(
        items=items,
        completed_count=completed,
        total=len(items),
        all_done=completed == len(items),
    )
