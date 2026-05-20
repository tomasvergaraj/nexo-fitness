"""Additional tenant operations endpoints for the complete gym platform."""

import asyncio
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import (
    get_current_tenant,
    get_current_user,
)
from app.models.business import (
    BodyMeasurement,
    ClassStatus,
    GymClass,
    Membership,
    Payment,
    PersonalRecord,
    Plan,
    ProgressPhoto,
    Reservation,
    ReservationStatus,
    SupportInteraction,
    TrainingProgram,
    TrainingProgramEnrollment,
)
from app.models.platform import PushSubscription
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.platform import (
    BodyMeasurementCreate,
    BodyMeasurementResponse,
    MobileMembershipWalletResponse,
    MobilePaymentHistoryItemResponse,
    MobilePushPreviewRequest,
    MobileSupportInteractionCreateRequest,
    MobileWalletMembershipSummaryResponse,
    NotificationDispatchResponse,
    PersonalRecordCreate,
    PersonalRecordResponse,
    ProgressPhotoResponse,
    PushSubscriptionCreateRequest,
    PushSubscriptionResponse,
    SupportInteractionResponse,
    TrainingProgramResponse,
    WebPushConfigResponse,
)
from app.services.calendar_export_service import build_member_calendar_ical
from app.services.membership_sale_service import (
    membership_status_value,
    sync_membership_timeline,
)
from app.services.push_notification_service import create_and_dispatch_notification

# Routers extracted to sub-modules (Phase A + B + C + D). Re-exported so main.py
# keeps importing them as `operations.<name>_router`.
from .branches import branches_router  # noqa: F401
from .campaigns import campaigns_router  # noqa: F401
from .feedback import feedback_router  # noqa: F401
from .memberships import memberships_router  # noqa: F401
from .notifications import notifications_router  # noqa: F401
from .payment_accounts import payment_accounts_router  # noqa: F401
from .personal_records import personal_records_router  # noqa: F401
from .programs import programs_router  # noqa: F401
from .progress import progress_router  # noqa: F401
from .promo_codes import promo_codes_router  # noqa: F401
from .reports import reports_router  # noqa: F401
from .settings import settings_router  # noqa: F401
from .staff import staff_router  # noqa: F401
from .support import support_router  # noqa: F401
from .upload import upload_router  # noqa: F401

# Shared helpers and constants used by remaining in-place routers
from ._common import (
    _JPEG_MAGIC,
    _MAX_PHOTO_BYTES,
    _MAX_PHOTOS_PER_USER,
    _PHOTO_ALLOWED_TYPES,
    _PNG_MAGIC,
    _UPLOADS_ROOT,
    _WEBP_ID,
    _WEBP_RIFF,
    _compress_photo,
    _get_support_related_users,
    _measurement_to_response,
    _notification_dispatch_payload,
    _pr_to_response,
    _support_payload,
)



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
mobile_router = APIRouter(prefix="/mobile", tags=["Mobile"])
settings = get_settings()
logger = structlog.get_logger()
def _wallet_membership_summary(
    membership: Optional[Membership],
    plan: Optional[Plan],
) -> Optional[MobileWalletMembershipSummaryResponse]:
    if membership is None:
        return None
    return MobileWalletMembershipSummaryResponse(
        membership_id=membership.id,
        plan_id=membership.plan_id,
        plan_name=plan.name if plan else None,
        membership_status=membership_status_value(membership.status) or "pending",
        starts_at=membership.starts_at,
        expires_at=membership.expires_at,
        auto_renew=membership.auto_renew,
        sale_source=membership.sale_source,
    )


def _build_mobile_wallet_response(
    *,
    tenant: Tenant,
    current_membership: Optional[Membership],
    current_plan: Optional[Plan],
    next_membership: Optional[Membership],
    next_plan: Optional[Plan],
    next_class: Optional[GymClass],
    next_program_class: Optional[GymClass],
    qr_payload: Optional[str],
    weekly_used: int | None,
    monthly_used: int | None,
) -> MobileMembershipWalletResponse:
    def _class_dict(c: GymClass) -> dict:
        return {
            "id": str(c.id),
            "name": c.name,
            "start_time": c.start_time.isoformat(),
            "modality": c.modality.value if hasattr(c.modality, "value") else str(c.modality),
            "program_id": str(c.program_id) if c.program_id else None,
        }

    return MobileMembershipWalletResponse(
        tenant_slug=tenant.slug,
        tenant_name=tenant.name,
        membership_id=current_membership.id if current_membership else None,
        plan_id=current_membership.plan_id if current_membership else None,
        plan_name=current_plan.name if current_plan else None,
        membership_status=membership_status_value(current_membership.status) if current_membership else None,
        starts_at=current_membership.starts_at if current_membership else None,
        expires_at=current_membership.expires_at if current_membership else None,
        auto_renew=current_membership.auto_renew if current_membership else None,
        current_membership=_wallet_membership_summary(current_membership, current_plan),
        next_membership=_wallet_membership_summary(next_membership, next_plan),
        next_class=_class_dict(next_class) if next_class else None,
        next_program_class=_class_dict(next_program_class) if next_program_class else None,
        qr_payload=qr_payload,
        max_reservations_per_week=current_plan.max_reservations_per_week if current_plan else None,
        max_reservations_per_month=current_plan.max_reservations_per_month if current_plan else None,
        weekly_reservations_used=weekly_used,
        monthly_reservations_used=monthly_used,
    )


def _mobile_payment_payload(
    payment: Payment,
    membership: Optional[Membership],
    plan: Optional[Plan],
) -> MobilePaymentHistoryItemResponse:
    snapshot_plan_name = payment.plan_name_snapshot or (plan.name if plan else None)
    return MobilePaymentHistoryItemResponse(
        id=payment.id,
        user_id=payment.user_id,
        membership_id=payment.membership_id,
        amount=payment.amount,
        currency=payment.currency,
        status=membership_status_value(payment.status) or "pending",
        method=membership_status_value(payment.method) or "other",
        description=payment.description,
        paid_at=payment.paid_at,
        created_at=payment.created_at,
        receipt_url=payment.receipt_url,
        external_id=payment.external_id,
        plan_name=snapshot_plan_name,
        plan_id_snapshot=payment.plan_id_snapshot or (plan.id if plan else None),
        plan_name_snapshot=snapshot_plan_name,
        membership_starts_at_snapshot=payment.membership_starts_at_snapshot or (membership.starts_at if membership else None),
        membership_expires_at_snapshot=payment.membership_expires_at_snapshot or (membership.expires_at if membership else None),
        membership_status_snapshot=payment.membership_status_snapshot or membership_status_value(membership.status if membership else None),
    )


@mobile_router.get("/wallet", response_model=MobileMembershipWalletResponse)
async def get_mobile_wallet(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    state = await sync_membership_timeline(db, tenant_id=tenant.id, user_id=current_user.id)
    current_membership = state.current_membership
    next_membership = state.next_membership
    current_plan = await db.get(Plan, current_membership.plan_id) if current_membership else None
    next_plan = await db.get(Plan, next_membership.plan_id) if next_membership else None
    next_class = (
        await db.execute(
            select(GymClass)
            .where(
                GymClass.tenant_id == tenant.id,
                _valid_program_class_filter(tenant.id),
                GymClass.start_time >= datetime.now(timezone.utc),
                GymClass.status == ClassStatus.SCHEDULED,
            )
            .order_by(GymClass.start_time.asc())
            .limit(1)
        )
    ).scalars().first()

    # Next class from user's enrolled programs
    enrolled_program_ids = (
        await db.execute(
            select(TrainingProgramEnrollment.program_id)
            .where(
                TrainingProgramEnrollment.tenant_id == tenant.id,
                TrainingProgramEnrollment.user_id == current_user.id,
            )
        )
    ).scalars().all()

    next_program_class = None
    if enrolled_program_ids:
        next_program_class = (
            await db.execute(
                select(GymClass)
                .where(
                    GymClass.tenant_id == tenant.id,
                    _valid_program_class_filter(tenant.id),
                    GymClass.program_id.in_(enrolled_program_ids),
                    GymClass.start_time >= datetime.now(timezone.utc),
                    GymClass.status == ClassStatus.SCHEDULED,
                )
                .order_by(GymClass.start_time.asc())
                .limit(1)
            )
        ).scalars().first()

    # Reservation quota: count confirmed reservations this week / this month
    weekly_used: int | None = None
    monthly_used: int | None = None
    if current_plan and (current_plan.max_reservations_per_week or current_plan.max_reservations_per_month):
        now = datetime.now(timezone.utc)
        week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        if current_plan.max_reservations_per_week:
            weekly_used = (
                await db.execute(
                    select(func.count()).select_from(Reservation)
                    .join(GymClass, Reservation.gym_class_id == GymClass.id)
                    .where(
                        Reservation.user_id == current_user.id,
                        Reservation.status == "confirmed",
                        GymClass.start_time >= week_start,
                    )
                )
            ).scalar() or 0

        if current_plan.max_reservations_per_month:
            monthly_used = (
                await db.execute(
                    select(func.count()).select_from(Reservation)
                    .join(GymClass, Reservation.gym_class_id == GymClass.id)
                    .where(
                        Reservation.user_id == current_user.id,
                        Reservation.status == "confirmed",
                        GymClass.start_time >= month_start,
                    )
                )
            ).scalar() or 0

    return _build_mobile_wallet_response(
        tenant=tenant,
        current_membership=current_membership,
        current_plan=current_plan,
        next_membership=next_membership,
        next_plan=next_plan,
        next_class=next_class,
        next_program_class=next_program_class,
        qr_payload=(
            f"nexo:{tenant.slug}:{current_user.id}:{state.access_membership.id}"
            if state.access_membership
            else None
        ),
        weekly_used=weekly_used,
        monthly_used=monthly_used,
    )


@mobile_router.get("/calendar.ics")
async def get_member_ical(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    """Return an iCalendar (.ics) file with the member's confirmed upcoming reservations."""
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    now = datetime.now(timezone.utc)
    until = now + timedelta(days=60)
    reservations = (await db.execute(
        select(Reservation)
        .where(
            Reservation.tenant_id == tenant.id,
            Reservation.user_id == current_user.id,
            Reservation.status.in_([ReservationStatus.CONFIRMED, ReservationStatus.WAITLISTED]),
        )
    )).scalars().all()

    class_ids = [r.gym_class_id for r in reservations]
    classes_by_id: dict = {}
    if class_ids:
        classes_by_id = {
            c.id: c for c in (await db.execute(
                select(GymClass)
                .where(
                    GymClass.id.in_(class_ids),
                    GymClass.start_time >= now,
                    GymClass.start_time <= until,
                    GymClass.status != ClassStatus.CANCELLED,
                )
            )).scalars().all()
        }

    ical_content = build_member_calendar_ical(
        tenant_name=tenant.name,
        reservations=reservations,
        classes_by_id=classes_by_id,
        generated_at=now,
    )

    filename = f"nexofitness-{tenant.slug}-clases.ics"
    return Response(
        content=ical_content,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@mobile_router.get("/payments", response_model=list[MobilePaymentHistoryItemResponse])
async def list_mobile_payments(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    payments = (
        await db.execute(
            select(Payment)
            .where(Payment.tenant_id == tenant.id, Payment.user_id == current_user.id)
            .order_by(func.coalesce(Payment.paid_at, Payment.created_at).desc(), Payment.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    membership_ids = [payment.membership_id for payment in payments if payment.membership_id]
    memberships = {
        membership.id: membership
        for membership in (
            await db.execute(select(Membership).where(Membership.id.in_(membership_ids)))
        ).scalars().all()
    } if membership_ids else {}
    plan_ids = [membership.plan_id for membership in memberships.values() if membership.plan_id]
    plans = {
        plan.id: plan
        for plan in (
            await db.execute(select(Plan).where(Plan.id.in_(plan_ids)))
        ).scalars().all()
    } if plan_ids else {}

    return [
        _mobile_payment_payload(
            payment,
            memberships.get(payment.membership_id) if payment.membership_id else None,
            plans.get(memberships[payment.membership_id].plan_id)
            if payment.membership_id and payment.membership_id in memberships
            else None,
        )
        for payment in payments
    ]


@mobile_router.get("/programs", response_model=list[TrainingProgramResponse])
async def list_mobile_programs(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")
    if current_user.role != UserRole.CLIENT:
        raise HTTPException(status_code=403, detail="Solo los clientes pueden ver sus programas")

    programs = (
        await db.execute(
            select(TrainingProgram)
            .where(
                TrainingProgram.tenant_id == tenant.id,
                TrainingProgram.is_active == True,
            )
            .order_by(TrainingProgram.created_at.desc())
        )
    ).scalars().all()
    program_ids = [program.id for program in programs]

    trainer_ids = [program.trainer_id for program in programs if program.trainer_id]
    trainers = {
        trainer.id: trainer
        for trainer in (
            await db.execute(select(User).where(User.id.in_(trainer_ids)))
        ).scalars().all()
    } if trainer_ids else {}
    enrollment_counts = await _get_program_enrollment_counts(db, tenant.id, program_ids)
    linked_class_counts = await _get_program_linked_class_counts(db, tenant.id, program_ids)
    enrollments = {
        enrollment.program_id: enrollment
        for enrollment in (
            await db.execute(
                select(TrainingProgramEnrollment).where(
                    TrainingProgramEnrollment.tenant_id == tenant.id,
                    TrainingProgramEnrollment.user_id == current_user.id,
                    TrainingProgramEnrollment.program_id.in_(program_ids),
                )
            )
        ).scalars().all()
    } if program_ids else {}

    return [
        _program_payload(
            program,
            trainers.get(program.trainer_id),
            enrolled_count=enrollment_counts.get(program.id, 0),
            linked_class_count=linked_class_counts.get(program.id, 0),
            enrollment_id=enrollments.get(program.id).id if enrollments.get(program.id) else None,
        )
        for program in programs
    ]


@mobile_router.post("/programs/{program_id}/enroll", response_model=TrainingProgramResponse, status_code=201)
async def enroll_mobile_program(
    program_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")
    if current_user.role != UserRole.CLIENT:
        raise HTTPException(status_code=403, detail="Solo los clientes pueden inscribirse a programas")

    program = await db.get(TrainingProgram, program_id)
    if not program or program.tenant_id != tenant.id:
        raise HTTPException(status_code=404, detail="Programa no encontrado")
    if not program.is_active:
        raise HTTPException(status_code=400, detail="Este programa no está disponible por ahora")

    existing = (
        await db.execute(
            select(TrainingProgramEnrollment).where(
                TrainingProgramEnrollment.tenant_id == tenant.id,
                TrainingProgramEnrollment.program_id == program_id,
                TrainingProgramEnrollment.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        enrollment = TrainingProgramEnrollment(
            tenant_id=tenant.id,
            program_id=program_id,
            user_id=current_user.id,
        )
        db.add(enrollment)
        await db.flush()
        existing = enrollment

    trainer = await db.get(User, program.trainer_id) if program.trainer_id else None
    enrolled_count = (
        await db.execute(
            select(func.count())
            .select_from(TrainingProgramEnrollment)
            .where(
                TrainingProgramEnrollment.tenant_id == tenant.id,
                TrainingProgramEnrollment.program_id == program_id,
            )
        )
    ).scalar() or 0
    linked_class_count = (
        await db.execute(
            select(func.count())
            .select_from(GymClass)
            .where(
                GymClass.tenant_id == tenant.id,
                GymClass.program_id == program_id,
            )
        )
    ).scalar() or 0
    return _program_payload(
        program,
        trainer,
        enrolled_count=enrolled_count,
        linked_class_count=linked_class_count,
        enrollment_id=existing.id,
    )


@mobile_router.delete("/programs/{program_id}/enroll", status_code=204)
async def leave_mobile_program(
    program_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")
    if current_user.role != UserRole.CLIENT:
        raise HTTPException(status_code=403, detail="Solo los clientes pueden gestionar su inscripción a programas")

    enrollment = (
        await db.execute(
            select(TrainingProgramEnrollment).where(
                TrainingProgramEnrollment.tenant_id == tenant.id,
                TrainingProgramEnrollment.program_id == program_id,
                TrainingProgramEnrollment.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if enrollment is None:
        return Response(status_code=204)

    await db.delete(enrollment)
    await db.flush()
    return Response(status_code=204)


@mobile_router.get("/support/interactions", response_model=list[SupportInteractionResponse])
async def list_mobile_support_interactions(
    limit: int = Query(12, ge=1, le=50),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")
    if current_user.role != UserRole.CLIENT:
        raise HTTPException(status_code=403, detail="Solo los clientes pueden revisar este historial")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser mayor que la fecha final")

    query = (
        select(SupportInteraction)
        .where(
            SupportInteraction.tenant_id == tenant.id,
            SupportInteraction.user_id == current_user.id,
        )
        .order_by(SupportInteraction.created_at.desc())
    )

    if date_from:
        query = query.where(SupportInteraction.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        query = query.where(SupportInteraction.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))

    interactions = (
        await db.execute(
            query.limit(limit)
        )
    ).scalars().all()

    related_users = await _get_support_related_users(db, interactions)
    return [
        _support_payload(item, related_users.get(item.user_id), related_users.get(item.handled_by))
        for item in interactions
    ]


@mobile_router.post("/support/interactions", response_model=SupportInteractionResponse, status_code=201)
async def create_mobile_support_interaction(
    data: MobileSupportInteractionCreateRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")
    if current_user.role != UserRole.CLIENT:
        raise HTTPException(status_code=403, detail="Solo los clientes pueden crear solicitudes de ayuda")

    interaction = SupportInteraction(
        tenant_id=tenant.id,
        user_id=current_user.id,
        channel=data.channel,
        subject=data.subject,
        notes=(data.notes or data.subject).strip(),
        resolved=False,
    )
    db.add(interaction)
    await db.flush()
    await db.refresh(interaction)
    return _support_payload(interaction, current_user, None)


@mobile_router.post("/push-preview", response_model=NotificationDispatchResponse, status_code=201)
async def create_mobile_push_preview(
    data: MobilePushPreviewRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    result = await create_and_dispatch_notification(
        db,
        tenant_id=tenant.id,
        user_id=current_user.id,
        title=data.title,
        message=data.message,
        type=data.type,
        action_url=data.action_url,
        send_push=True,
    )
    return _notification_dispatch_payload(result)


@mobile_router.get("/push-subscriptions", response_model=list[PushSubscriptionResponse])
async def list_push_subscriptions(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")
    result = await db.execute(
        select(PushSubscription)
        .where(PushSubscription.tenant_id == tenant.id, PushSubscription.user_id == current_user.id)
        .order_by(PushSubscription.updated_at.desc())
    )
    return [PushSubscriptionResponse.model_validate(item) for item in result.scalars().all()]


@mobile_router.get("/push-config", response_model=WebPushConfigResponse)
async def get_mobile_push_config(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None or current_user is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    public_key = settings.WEB_PUSH_VAPID_PUBLIC_KEY.strip()
    return WebPushConfigResponse(
        enabled=bool(public_key and settings.WEB_PUSH_VAPID_PRIVATE_KEY.strip()),
        public_vapid_key=public_key or None,
    )


@mobile_router.post("/push-subscriptions", response_model=PushSubscriptionResponse, status_code=201)
async def create_push_subscription(
    data: PushSubscriptionCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    lookup_field = (
        PushSubscription.expo_push_token == data.expo_push_token
        if data.provider == "expo"
        else PushSubscription.web_endpoint == data.web_endpoint
    )
    existing = (
        await db.execute(
            select(PushSubscription).where(
                PushSubscription.tenant_id == tenant.id,
                PushSubscription.user_id == current_user.id,
                PushSubscription.provider == data.provider,
                lookup_field,
            )
        )
    ).scalars().first()
    if existing:
        existing.provider = data.provider
        existing.device_type = data.device_type
        existing.device_name = data.device_name
        existing.expo_push_token = data.expo_push_token
        existing.web_endpoint = data.web_endpoint
        existing.web_p256dh_key = data.web_p256dh_key
        existing.web_auth_key = data.web_auth_key
        existing.user_agent = data.user_agent or request.headers.get("user-agent")
        existing.is_active = True
        existing.last_seen_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(existing)
        return PushSubscriptionResponse.model_validate(existing)

    subscription = PushSubscription(
        tenant_id=tenant.id,
        user_id=current_user.id,
        provider=data.provider,
        device_type=data.device_type,
        device_name=data.device_name,
        expo_push_token=data.expo_push_token,
        web_endpoint=data.web_endpoint,
        web_p256dh_key=data.web_p256dh_key,
        web_auth_key=data.web_auth_key,
        user_agent=data.user_agent or request.headers.get("user-agent"),
        is_active=True,
    )
    db.add(subscription)
    await db.flush()
    await db.refresh(subscription)
    return PushSubscriptionResponse.model_validate(subscription)


class MobileMembershipUpdateRequest(BaseModel):
    auto_renew: Optional[bool] = None


@mobile_router.patch("/membership", response_model=MobileMembershipWalletResponse)
async def update_mobile_membership(
    data: MobileMembershipUpdateRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    """Allow a member to update their own membership settings (currently: auto_renew)."""
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    state = await sync_membership_timeline(db, tenant_id=tenant.id, user_id=current_user.id)
    membership = state.current_membership or state.next_membership

    if not membership:
        raise HTTPException(status_code=404, detail="No se encontró una membresía para este miembro")

    if data.auto_renew is not None:
        membership.auto_renew = data.auto_renew

    await db.flush()
    state = await sync_membership_timeline(db, tenant_id=tenant.id, user_id=current_user.id)
    current_membership = state.current_membership
    next_membership = state.next_membership

    # Return the updated wallet so the frontend can refresh in one call
    plan = await db.get(Plan, current_membership.plan_id) if current_membership else None
    next_plan = await db.get(Plan, next_membership.plan_id) if next_membership else None
    next_class = (
        await db.execute(
            select(GymClass)
            .where(
                GymClass.tenant_id == tenant.id,
                _valid_program_class_filter(tenant.id),
                GymClass.start_time >= datetime.now(timezone.utc),
                GymClass.status == ClassStatus.SCHEDULED,
            )
            .order_by(GymClass.start_time.asc())
            .limit(1)
        )
    ).scalars().first()

    return _build_mobile_wallet_response(
        tenant=tenant,
        current_membership=current_membership,
        current_plan=plan,
        next_membership=next_membership,
        next_plan=next_plan,
        next_class=next_class,
        next_program_class=None,
        qr_payload=(
            f"nexo:{tenant.slug}:{current_user.id}:{state.access_membership.id}"
            if state.access_membership
            else None
        ),
        weekly_used=None,
        monthly_used=None,
    )


# ---------------------------------------------------------------------------
# Progress — body measurements (member self-service via mobile)
# ---------------------------------------------------------------------------


# Member: own measurements via /mobile/progress
@mobile_router.get("/progress", response_model=list[BodyMeasurementResponse])
async def mobile_list_measurements(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BodyMeasurementResponse]:
    result = await db.execute(
        select(BodyMeasurement)
        .where(BodyMeasurement.user_id == current_user.id, BodyMeasurement.tenant_id == tenant.id)
        .order_by(BodyMeasurement.recorded_at.desc())
    )
    return [_measurement_to_response(m) for m in result.scalars().all()]


@mobile_router.post("/progress", response_model=BodyMeasurementResponse, status_code=201)
async def mobile_create_measurement(
    body: BodyMeasurementCreate,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BodyMeasurementResponse:
    m = BodyMeasurement(
        id=uuid4(),
        user_id=current_user.id,
        tenant_id=tenant.id,
        recorded_at=body.recorded_at,
        weight_kg=body.weight_kg,
        body_fat_pct=body.body_fat_pct,
        muscle_mass_kg=body.muscle_mass_kg,
        chest_cm=body.chest_cm,
        waist_cm=body.waist_cm,
        hip_cm=body.hip_cm,
        arm_cm=body.arm_cm,
        thigh_cm=body.thigh_cm,
        notes=body.notes,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _measurement_to_response(m)


@mobile_router.delete("/progress/{measurement_id}", status_code=204)
async def mobile_delete_measurement(
    measurement_id: UUID,
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(BodyMeasurement).where(
            BodyMeasurement.id == measurement_id,
            BodyMeasurement.user_id == current_user.id,
            BodyMeasurement.tenant_id == tenant.id,
        )
    )
    m = result.scalars().first()
    if not m:
        raise HTTPException(status_code=404, detail="Medición no encontrada.")
    await db.delete(m)
    await db.commit()


# ─── Personal Records ─────────────────────────────────────────────────────────


# Member: list own PRs
@mobile_router.get("/personal-records", response_model=list[PersonalRecordResponse])
async def list_personal_records(
    exercise: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> list[PersonalRecordResponse]:
    q = (
        select(PersonalRecord)
        .where(PersonalRecord.user_id == current_user.id, PersonalRecord.tenant_id == tenant.id)
        .order_by(PersonalRecord.recorded_at.desc())
    )
    if exercise:
        q = q.where(PersonalRecord.exercise_name.ilike(f"%{exercise}%"))
    result = await db.execute(q)
    return [_pr_to_response(pr) for pr in result.scalars().all()]


# Member: create own PR
@mobile_router.post("/personal-records", response_model=PersonalRecordResponse, status_code=201)
async def create_personal_record(
    body: PersonalRecordCreate,
    current_user: User = Depends(get_current_user),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> PersonalRecordResponse:
    pr = PersonalRecord(
        id=uuid4(),
        user_id=current_user.id,
        tenant_id=tenant.id,
        exercise_name=body.exercise_name.strip(),
        record_value=body.record_value,
        unit=body.unit.strip(),
        recorded_at=body.recorded_at,
        notes=body.notes,
    )
    db.add(pr)
    await db.commit()
    await db.refresh(pr)
    return _pr_to_response(pr)


# Member: delete own PR
@mobile_router.delete("/personal-records/{record_id}", status_code=204)
async def delete_personal_record(
    record_id: UUID,
    current_user: User = Depends(get_current_user),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> None:
    pr = (await db.execute(
        select(PersonalRecord).where(
            PersonalRecord.id == record_id,
            PersonalRecord.user_id == current_user.id,
            PersonalRecord.tenant_id == tenant.id,
        )
    )).scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="Récord no encontrado.")
    await db.delete(pr)
    await db.commit()


# ─── Progress Photos ──────────────────────────────────────────────────────────


def _photo_to_response(p: ProgressPhoto, request: Request) -> ProgressPhotoResponse:
    base_url = str(request.base_url).rstrip("/")
    photo_url = f"{base_url}{p.file_path}"
    return ProgressPhotoResponse(
        id=p.id,
        user_id=p.user_id,
        tenant_id=p.tenant_id,
        recorded_at=p.recorded_at,
        photo_url=photo_url,
        notes=p.notes,
        created_at=p.created_at,
    )


# Member: list own progress photos
@mobile_router.get("/progress/photos", response_model=list[ProgressPhotoResponse])
async def list_progress_photos(
    request: Request,
    current_user: User = Depends(get_current_user),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> list[ProgressPhotoResponse]:
    result = await db.execute(
        select(ProgressPhoto)
        .where(ProgressPhoto.user_id == current_user.id, ProgressPhoto.tenant_id == tenant.id)
        .order_by(ProgressPhoto.recorded_at.desc())
    )
    return [_photo_to_response(p, request) for p in result.scalars().all()]


# Member: upload progress photo
@mobile_router.post("/progress/photos", response_model=ProgressPhotoResponse, status_code=201)
async def upload_progress_photo(
    request: Request,
    file: UploadFile = File(...),
    recorded_at: Optional[str] = None,
    notes: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> ProgressPhotoResponse:
    content_type = file.content_type or ""
    if content_type not in _PHOTO_ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Solo se aceptan imágenes JPEG, PNG o WebP.")

    raw = await file.read()
    if len(raw) > _MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="La imagen supera el tamaño máximo de 15 MB.")

    # Validate magic bytes — don't trust Content-Type header alone
    is_valid_image = (
        raw[:3] == _JPEG_MAGIC
        or raw[:4] == _PNG_MAGIC
        or (len(raw) >= 12 and raw[:4] == _WEBP_RIFF and raw[8:12] == _WEBP_ID)
    )
    if not is_valid_image:
        raise HTTPException(status_code=400, detail="El archivo no es una imagen válida.")

    # Enforce per-user photo limit
    photo_count = (await db.execute(
        select(func.count()).select_from(ProgressPhoto)
        .where(ProgressPhoto.user_id == current_user.id, ProgressPhoto.tenant_id == tenant.id)
    )).scalar_one()
    if photo_count >= _MAX_PHOTOS_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"Límite de {_MAX_PHOTOS_PER_USER} fotos alcanzado. Elimina algunas para continuar.",
        )

    # Compress: resize to max 1920px, re-encode as JPEG ~82% — ~90% less disk space
    try:
        data = await asyncio.to_thread(_compress_photo, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    photo_dir = _UPLOADS_ROOT / "progress_photos" / str(tenant.id) / str(current_user.id)
    photo_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}.jpg"  # always JPEG after compression
    (photo_dir / filename).write_bytes(data)
    file_path = f"/uploads/progress_photos/{tenant.id}/{current_user.id}/{filename}"

    rec_at = datetime.now(timezone.utc)
    if recorded_at:
        try:
            rec_at = datetime.fromisoformat(recorded_at)
        except ValueError:
            pass

    photo = ProgressPhoto(
        id=uuid4(),
        user_id=current_user.id,
        tenant_id=tenant.id,
        recorded_at=rec_at,
        file_path=file_path,
        notes=notes,
    )
    db.add(photo)
    await db.commit()
    await db.refresh(photo)
    return _photo_to_response(photo, request)


# Member: delete progress photo
@mobile_router.delete("/progress/photos/{photo_id}", status_code=204)
async def delete_progress_photo(
    photo_id: UUID,
    current_user: User = Depends(get_current_user),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> None:
    photo = (await db.execute(
        select(ProgressPhoto).where(
            ProgressPhoto.id == photo_id,
            ProgressPhoto.user_id == current_user.id,
            ProgressPhoto.tenant_id == tenant.id,
        )
    )).scalars().first()
    if not photo:
        raise HTTPException(status_code=404, detail="Foto no encontrada.")
    # Delete from disk
    try:
        relative = photo.file_path.removeprefix("/uploads/")
        disk_path = (_UPLOADS_ROOT / relative).resolve()
        uploads_root = _UPLOADS_ROOT.resolve()
        if str(disk_path).startswith(str(uploads_root)):
            disk_path.unlink(missing_ok=True)
    except Exception:
        pass
    await db.delete(photo)
    await db.commit()
