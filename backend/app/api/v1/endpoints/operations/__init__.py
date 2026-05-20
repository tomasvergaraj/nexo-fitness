"""Additional tenant operations endpoints for the complete gym platform."""

import asyncio
import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_current_tenant,
    get_current_user,
    get_tenant_context,
    require_roles,
)
from app.core.security import create_staff_invitation_token
from app.integrations.email.email_service import email_service
from app.models.business import (
    BodyMeasurement,
    CheckIn,
    ClassStatus,
    GymClass,
    Membership,
    MembershipStatus,
    Payment,
    PaymentStatus,
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
from app.models.pos import Expense, POSTransaction, POSTransactionItem, POSTransactionStatus
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.business import (
    GymClassResponse,
    PaginatedResponse,
)
from app.schemas.platform import (
    BodyMeasurementCreate,
    BodyMeasurementResponse,
    ExpenseCategoryPoint,
    MobileMembershipWalletResponse,
    MobilePaymentHistoryItemResponse,
    MobilePushPreviewRequest,
    MobileSupportInteractionCreateRequest,
    MobileWalletMembershipSummaryResponse,
    NotificationDispatchResponse,
    PersonalRecordCreate,
    PersonalRecordResponse,
    ProgramExerciseLibraryItemCreateRequest,
    ProgramExerciseLibraryItemResponse,
    ProgressPhotoResponse,
    PushSubscriptionCreateRequest,
    PushSubscriptionResponse,
    ReportSeriesPoint,
    ReportsOverviewResponse,
    SupportInteractionResponse,
    TenantSettingsResponse,
    TenantSettingsUpdateRequest,
    TopProductPoint,
    TrainingProgramCreateRequest,
    TrainingProgramEnrollmentResponse,
    TrainingProgramResponse,
    TrainingProgramUpdateRequest,
    WebPushConfigResponse,
)
from app.services.branding_service import (
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_SECONDARY_COLOR,
    coerce_brand_color,
    normalize_brand_color,
)
from app.services.calendar_export_service import build_member_calendar_ical
from app.services.class_service import build_gym_class_responses
from app.services.custom_domain_service import domains_conflict, extract_hostname, normalize_custom_domain
from app.services.membership_sale_service import (
    membership_status_value,
    resolve_membership_timeline,
    sync_membership_timeline,
)
from app.services.push_notification_service import create_and_dispatch_notification
from app.services.support_contact_service import resolve_tenant_support_contacts
from app.services.user_account_service import purge_user_account

# Routers extracted to sub-modules (Phase A + B + C). Re-exported so main.py
# keeps importing them as `operations.<name>_router`.
from .branches import branches_router  # noqa: F401
from .campaigns import campaigns_router  # noqa: F401
from .feedback import feedback_router  # noqa: F401
from .memberships import memberships_router  # noqa: F401
from .notifications import notifications_router  # noqa: F401
from .payment_accounts import payment_accounts_router  # noqa: F401
from .personal_records import personal_records_router  # noqa: F401
from .progress import progress_router  # noqa: F401
from .promo_codes import promo_codes_router  # noqa: F401
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
    _loads_dict,
    _loads_list,
    _measurement_to_response,
    _notification_dispatch_payload,
    _pr_to_response,
    _support_payload,
)

programs_router = APIRouter(prefix="/programs", tags=["Programs"])


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
staff_router = APIRouter(prefix="/staff", tags=["Staff"])
settings_router = APIRouter(prefix="/settings", tags=["Settings"])
reports_router = APIRouter(prefix="/reports", tags=["Reports"])
mobile_router = APIRouter(prefix="/mobile", tags=["Mobile"])
settings = get_settings()
logger = structlog.get_logger()
_PROGRAM_EXERCISE_LIBRARY_FEATURE_KEY = "program_exercise_library"
_DEFAULT_PROGRAM_EXERCISE_GROUPS: list[tuple[str, str]] = [
    ("Pecho", "Press banca"),
    ("Pecho", "Press inclinado con mancuernas"),
    ("Pecho", "Press declinado"),
    ("Pecho", "Aperturas con mancuernas"),
    ("Pecho", "Cruce de poleas"),
    ("Pecho", "Fondos en paralelas"),
    ("Pecho", "Flexiones"),
    ("Espalda", "Dominadas"),
    ("Espalda", "Jalon al pecho"),
    ("Espalda", "Remo con barra"),
    ("Espalda", "Remo con mancuerna"),
    ("Espalda", "Remo sentado en polea"),
    ("Espalda", "Pullover en polea"),
    ("Espalda", "Peso muerto"),
    ("Piernas", "Sentadilla trasera"),
    ("Piernas", "Sentadilla frontal"),
    ("Piernas", "Prensa de piernas"),
    ("Piernas", "Zancadas caminando"),
    ("Piernas", "Peso muerto rumano"),
    ("Piernas", "Curl femoral"),
    ("Piernas", "Extension de cuadriceps"),
    ("Piernas", "Elevaciones de gemelos"),
    ("Piernas", "Bulgarian split squat"),
    ("Gluteos", "Hip thrust"),
    ("Gluteos", "Patada de gluteo en polea"),
    ("Gluteos", "Puente de gluteos"),
    ("Gluteos", "Abduccion de cadera"),
    ("Hombros", "Press militar"),
    ("Hombros", "Press Arnold"),
    ("Hombros", "Elevaciones laterales"),
    ("Hombros", "Elevaciones frontales"),
    ("Hombros", "Pajaros"),
    ("Hombros", "Face pull"),
    ("Hombros", "Remo al menton"),
    ("Brazos", "Curl con barra"),
    ("Brazos", "Curl martillo"),
    ("Brazos", "Curl concentrado"),
    ("Brazos", "Curl Scott"),
    ("Brazos", "Extension de triceps en cuerda"),
    ("Brazos", "Press cerrado"),
    ("Brazos", "Fondos en banco"),
    ("Core", "Plancha frontal"),
    ("Core", "Plancha lateral"),
    ("Core", "Crunch en polea"),
    ("Core", "Elevaciones de piernas"),
    ("Core", "Russian twist"),
    ("Core", "Hollow hold"),
    ("Core", "Rueda abdominal"),
    ("Cardio", "Caminata en cinta"),
    ("Cardio", "Sprints en cinta"),
    ("Cardio", "Remo ergometro"),
    ("Cardio", "Bicicleta estatica"),
    ("Cardio", "Cuerda para saltar"),
    ("Cardio", "Burpees"),
    ("Cardio", "Battle ropes"),
    ("Movilidad", "Movilidad de cadera"),
    ("Movilidad", "Movilidad de hombros"),
    ("Movilidad", "Estiramiento de isquiotibiales"),
    ("Movilidad", "Estiramiento de pectoral"),
    ("Movilidad", "Foam roller"),
    ("Movilidad", "Respiracion diafragmatica"),
]
_DEFAULT_PROGRAM_EXERCISE_LIBRARY = [
    {
        "id": f"default-{index:03d}",
        "name": name,
        "group": group,
    }
    for index, (group, name) in enumerate(_DEFAULT_PROGRAM_EXERCISE_GROUPS, start=1)
]


def _feature_map(tenant: Tenant) -> dict[str, Any]:
    return _loads_dict(tenant.features)


def _save_feature_map(tenant: Tenant, values: dict[str, Any]) -> None:
    current = _feature_map(tenant)
    current.update(values)
    tenant.features = json.dumps(current)


def _copy_program_exercise_library(items: list[dict[str, str]]) -> list[dict[str, str]]:
    return [dict(item) for item in items]


def _normalize_program_exercise_value(raw_value: Any) -> str:
    return " ".join(str(raw_value or "").strip().split())


def _normalize_program_exercise_library(items: list[Any]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    seen_ids: set[str] = set()

    for index, raw_item in enumerate(items, start=1):
        if not isinstance(raw_item, dict):
            continue

        item_id = _normalize_program_exercise_value(raw_item.get("id")) or f"custom-{index:03d}"
        name = _normalize_program_exercise_value(raw_item.get("name"))
        group = _normalize_program_exercise_value(raw_item.get("group"))
        if not name or not group or item_id in seen_ids:
            continue

        seen_ids.add(item_id)
        normalized.append({
            "id": item_id,
            "name": name,
            "group": group,
        })

    return normalized


def _get_program_exercise_library(tenant: Tenant) -> list[dict[str, str]]:
    features = _feature_map(tenant)
    if _PROGRAM_EXERCISE_LIBRARY_FEATURE_KEY not in features:
        return _copy_program_exercise_library(_DEFAULT_PROGRAM_EXERCISE_LIBRARY)

    raw_items = features.get(_PROGRAM_EXERCISE_LIBRARY_FEATURE_KEY)
    if not isinstance(raw_items, list):
        return []

    return _normalize_program_exercise_library(raw_items)


def _save_program_exercise_library(tenant: Tenant, items: list[dict[str, str]]) -> None:
    _save_feature_map(
        tenant,
        {
            _PROGRAM_EXERCISE_LIBRARY_FEATURE_KEY: _normalize_program_exercise_library(items),
        },
    )


async def _ensure_custom_domain_is_available(
    db: AsyncSession,
    *,
    candidate_domain: str,
    tenant_id: UUID,
) -> None:
    reserved_hosts = {
        host
        for host in {
            extract_hostname(settings.FRONTEND_URL),
            extract_hostname(settings.public_app_url),
        }
        if host
    }

    for host in reserved_hosts:
        if candidate_domain == host:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"El dominio {candidate_domain} ya esta reservado por la plataforma principal. "
                    "Usa otro dominio o subdominio."
                ),
            )

    existing_tenants = (
        await db.execute(
            select(Tenant.id, Tenant.name, Tenant.custom_domain).where(
                Tenant.id != tenant_id,
                Tenant.custom_domain.is_not(None),
            )
        )
    ).all()

    for _existing_tenant_id, existing_name, existing_domain in existing_tenants:
        if not existing_domain:
            continue
        try:
            normalized_existing = normalize_custom_domain(existing_domain)
        except ValueError:
            continue
        if not normalized_existing:
            continue
        if domains_conflict(candidate_domain, normalized_existing):
            if candidate_domain == normalized_existing:
                detail = (
                    f"El dominio {candidate_domain} ya esta siendo usado por el tenant {existing_name}. "
                    "Debe ser unico."
                )
            else:
                detail = (
                    f"El dominio {candidate_domain} entra en conflicto con {normalized_existing} del tenant "
                    f"{existing_name}. Usa un dominio que no sea padre ni subdominio de otro tenant."
                )
            raise HTTPException(status_code=409, detail=detail)


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


def _program_payload(
    program: TrainingProgram,
    trainer: Optional[User],
    *,
    enrolled_count: int = 0,
    enrollment_id: Optional[UUID] = None,
    linked_class_count: int = 0,
) -> TrainingProgramResponse:
    return TrainingProgramResponse(
        id=program.id,
        name=program.name,
        description=program.description,
        trainer_id=program.trainer_id,
        program_type=program.program_type,
        duration_weeks=program.duration_weeks,
        schedule=_loads_list(program.schedule_json),
        is_active=program.is_active,
        created_at=program.created_at,
        updated_at=program.updated_at,
        trainer_name=trainer.full_name if trainer else None,
        enrolled_count=enrolled_count,
        linked_class_count=linked_class_count,
        is_enrolled=enrollment_id is not None,
        enrollment_id=enrollment_id,
    )


async def _get_default_program_trainer_id(db: AsyncSession, tenant_id: UUID) -> Optional[UUID]:
    return (
        await db.execute(
            select(User.id).where(
                User.tenant_id == tenant_id,
                User.role == UserRole.OWNER,
                User.is_active == True,
            ).limit(1)
        )
    ).scalar_one_or_none()


async def _get_program_enrollment_counts(
    db: AsyncSession,
    tenant_id: UUID,
    program_ids: list[UUID],
) -> dict[UUID, int]:
    if not program_ids:
        return {}

    rows = await db.execute(
        select(
            TrainingProgramEnrollment.program_id,
            func.count().label("count"),
        )
        .where(
            TrainingProgramEnrollment.tenant_id == tenant_id,
            TrainingProgramEnrollment.program_id.in_(program_ids),
        )
        .group_by(TrainingProgramEnrollment.program_id)
    )
    return {row.program_id: row.count for row in rows}


async def _get_program_linked_class_counts(
    db: AsyncSession,
    tenant_id: UUID,
    program_ids: list[UUID],
) -> dict[UUID, int]:
    if not program_ids:
        return {}
    rows = await db.execute(
        select(GymClass.program_id, func.count().label("count"))
        .where(
            GymClass.tenant_id == tenant_id,
            GymClass.program_id.in_(program_ids),
        )
        .group_by(GymClass.program_id)
    )
    return {row.program_id: row.count for row in rows}


class GenerateClassesRequest(BaseModel):
    start_date: date
    weeks: int = Field(default=4, ge=1, le=52)
    class_time: str = Field(default="09:00", pattern=r"^\d{2}:\d{2}$")
    duration_minutes: int = Field(default=60, ge=15, le=480)
    branch_id: Optional[UUID] = None
    instructor_id: Optional[UUID] = None
    max_capacity: int = Field(default=20, ge=1)
    online_link: Optional[str] = None
    modality: str = "in_person"
    cancellation_deadline_hours: int = 2
    restricted_plan_id: Optional[UUID] = None
    # utc_offset_minutes: JS getTimezoneOffset() value (e.g. 180 for UTC-3).
    # Used to convert the user's local class_time to UTC before storing.
    utc_offset_minutes: int = Field(default=0, ge=-840, le=840)
    color: Optional[str] = Field(default=None, max_length=20)
    class_type: Optional[str] = Field(default=None, max_length=80)


def _resolve_program_day_config_value(
    class_config: dict[str, Any] | None,
    field_name: str,
    inherited_value: Any,
) -> Any:
    if not isinstance(class_config, dict) or field_name not in class_config:
        return inherited_value

    raw_value = class_config.get(field_name)
    if isinstance(raw_value, dict):
        mode = raw_value.get("mode")
        if mode == "inherit":
            return inherited_value
        if mode == "custom":
            return raw_value.get("value")
        return inherited_value

    return raw_value


def _program_enrollment_payload(
    enrollment: TrainingProgramEnrollment,
    user: Optional[User],
) -> TrainingProgramEnrollmentResponse:
    return TrainingProgramEnrollmentResponse(
        id=enrollment.id,
        program_id=enrollment.program_id,
        user_id=enrollment.user_id,
        user_name=user.full_name if user else None,
        user_email=user.email if user else None,
        user_phone=user.phone if user else None,
        created_at=enrollment.created_at,
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


# ─── Staff Router ─────────────────────────────────────────────────────────────

@staff_router.get("", response_model=list)
async def list_staff(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    """Return staff members (non-client users) of the tenant for dropdowns."""
    staff_roles = [
        UserRole.OWNER, UserRole.ADMIN, UserRole.RECEPTION,
        UserRole.TRAINER, UserRole.MARKETING,
    ]
    result = await db.execute(
        select(User)
        .where(User.tenant_id == ctx.tenant_id, User.role.in_(staff_roles), User.is_active == True)
        .order_by(User.first_name)
    )
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "full_name": u.full_name,
            "role": u.role.value,
            "email": u.email,
            "is_active": u.is_active,
            "two_factor_enabled": bool(u.two_factor_enabled),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        }
        for u in users
    ]


_STAFF_ROLES = {"admin", "reception", "trainer", "marketing"}
_ROLE_LABELS = {
    "admin": "Administrador",
    "reception": "Recepción",
    "trainer": "Entrenador",
    "marketing": "Marketing",
    "owner": "Propietario",
}


class StaffInviteRequest(BaseModel):
    email: str = Field(min_length=5, max_length=200)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    role: str
    replace_pending: bool = False


class StaffUpdateRequest(BaseModel):
    role: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: Optional[bool] = None


async def _get_redis():
    import redis.asyncio as aioredis
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


_STAFF_INVITATION_TTL = 259200


async def _mark_staff_invitation_status(redis: Any, token_hash: str | None, status: str) -> None:
    if token_hash:
        await redis.set(f"staff_invite_used:{token_hash}", status, ex=_STAFF_INVITATION_TTL)


@staff_router.post("/invite", status_code=201)
async def invite_staff(
    data: StaffInviteRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    """Invite a new staff member via email."""
    if data.role not in _STAFF_ROLES:
        raise HTTPException(status_code=400, detail=f"Rol inválido. Opciones: {', '.join(_STAFF_ROLES)}")

    email = data.email.lower().strip()

    # Check no existing active user with same email in tenant.
    # Inactive staff members can be re-invited to reactivate their access.
    existing = (await db.execute(
        select(User).where(User.email == email, User.tenant_id == ctx.tenant_id)
    )).scalar_one_or_none()
    can_reinvite_existing_staff = bool(
        existing
        and not existing.is_active
        and existing.role in {UserRole.ADMIN, UserRole.RECEPTION, UserRole.TRAINER, UserRole.MARKETING}
    )
    if existing and not can_reinvite_existing_staff:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo en esta cuenta.")

    # Rate-limit invitations: max 20 per hour per tenant
    redis = await _get_redis()
    rate_key = f"staff_invite_rate:{ctx.tenant_id}"
    meta_key = f"staff_invite_meta:{ctx.tenant_id}:{email}"
    list_key = f"staff_invite_list:{ctx.tenant_id}"
    pending_key = f"staff_invite_pending:{ctx.tenant_id}:{email}"
    count = await redis.incr(rate_key)
    if count == 1:
        await redis.expire(rate_key, 3600)
    if count > 20:
        await redis.aclose()
        raise HTTPException(status_code=429, detail="Demasiadas invitaciones enviadas. Intenta en una hora.")

    existing_invitation_raw = await redis.get(meta_key)
    if existing_invitation_raw and not data.replace_pending:
        await redis.aclose()
        raise HTTPException(status_code=409, detail="Ya existe una invitación pendiente para ese correo.")
    if existing_invitation_raw:
        existing_invitation = json.loads(existing_invitation_raw)
        await _mark_staff_invitation_status(redis, existing_invitation.get("token_hash"), "invalidated")
    else:
        await redis.delete(pending_key)

    tenant = ctx.tenant
    gym_name = tenant.name if tenant else "el gimnasio"
    invited_by = current_user.full_name

    token = create_staff_invitation_token(
        email=email,
        tenant_id=str(ctx.tenant_id),
        role=data.role,
        first_name=data.first_name,
        last_name=data.last_name,
        invited_by=invited_by,
    )

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    invite_url = f"{settings.FRONTEND_URL}/accept-invitation?token={token}"
    role_label = _ROLE_LABELS.get(data.role, data.role)

    # Store full metadata so we can list and cancel invitations (72h TTL)
    meta = json.dumps({
        "email": email,
        "first_name": data.first_name,
        "last_name": data.last_name,
        "role": data.role,
        "role_label": role_label,
        "invited_by": invited_by,
        "invited_at": datetime.now(timezone.utc).isoformat(),
        "token_hash": token_hash,
    })

    await redis.set(meta_key, meta, ex=_STAFF_INVITATION_TTL)
    await redis.set(pending_key, token_hash, ex=_STAFF_INVITATION_TTL)
    await redis.sadd(list_key, email)
    await redis.expire(list_key, _STAFF_INVITATION_TTL)
    await redis.aclose()

    await email_service.send_staff_invitation(
        to_email=email,
        first_name=data.first_name,
        gym_name=gym_name,
        invite_url=invite_url,
        role_label=role_label,
        invited_by=invited_by,
    )

    replaced_pending = bool(existing_invitation_raw)
    reactivates_existing_user = bool(can_reinvite_existing_staff)
    detail = (
        f"Nueva invitación enviada a {email}. La invitación anterior fue invalidada."
        if replaced_pending
        else (
            f"Invitación enviada a {email} para reactivar su acceso."
            if reactivates_existing_user
            else f"Invitación enviada a {email}."
        )
    )
    return {
        "detail": detail,
        "email": email,
        "role": data.role,
        "replaced_pending": replaced_pending,
        "reactivates_existing_user": reactivates_existing_user,
    }


@staff_router.get("/invitations")
async def list_pending_invitations(
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """List all pending (not yet accepted) staff invitations."""
    redis = await _get_redis()
    list_key = f"staff_invite_list:{ctx.tenant_id}"
    emails = await redis.smembers(list_key)

    invitations = []
    stale_emails = []
    for email in emails:
        meta_key = f"staff_invite_meta:{ctx.tenant_id}:{email}"
        raw = await redis.get(meta_key)
        if raw:
            data = json.loads(raw)
            ttl = await redis.ttl(meta_key)
            data["expires_in_hours"] = max(0, round(ttl / 3600, 1)) if ttl > 0 else 0
            invitations.append(data)
        else:
            stale_emails.append(email)

    # Clean stale entries from set
    if stale_emails:
        await redis.srem(list_key, *stale_emails)

    await redis.aclose()
    invitations.sort(key=lambda x: x.get("invited_at", ""), reverse=True)
    return invitations


@staff_router.delete("/invitations/{email}")
async def cancel_invitation(
    email: str,
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Cancel a pending staff invitation."""
    email = email.lower().strip()
    redis = await _get_redis()
    meta_key = f"staff_invite_meta:{ctx.tenant_id}:{email}"
    list_key = f"staff_invite_list:{ctx.tenant_id}"
    pending_key = f"staff_invite_pending:{ctx.tenant_id}:{email}"

    raw = await redis.get(meta_key)
    if not raw:
        await redis.aclose()
        raise HTTPException(status_code=404, detail="No hay invitación pendiente para ese correo.")

    meta = json.loads(raw)
    token_hash = meta.get("token_hash")

    # Burn the token so the link stops working
    await _mark_staff_invitation_status(redis, token_hash, "invalidated")

    await redis.delete(meta_key)
    await redis.delete(pending_key)
    await redis.srem(list_key, email)
    await redis.aclose()
    return {"detail": f"Invitación cancelada para {email}."}


@staff_router.patch("/{staff_id}")
async def update_staff(
    staff_id: UUID,
    data: StaffUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    """Update a staff member's role or info."""
    staff = (await db.execute(
        select(User).where(User.id == staff_id, User.tenant_id == ctx.tenant_id, User.role != UserRole.CLIENT)
    )).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Miembro del equipo no encontrado.")

    # Owners cannot be demoted by admins
    if staff.role == UserRole.OWNER and getattr(current_user.role, "value", str(current_user.role)) != "owner":
        raise HTTPException(status_code=403, detail="Solo el propietario puede modificar su propio rol.")

    role_before = staff.role.value if hasattr(staff.role, "value") else str(staff.role)
    role_changed = False

    if data.role is not None:
        if data.role not in _STAFF_ROLES and data.role != "owner":
            raise HTTPException(status_code=400, detail=f"Rol inválido.")
        if staff.role != UserRole(data.role):
            role_changed = True
        staff.role = UserRole(data.role)
    if data.first_name is not None:
        staff.first_name = data.first_name
    if data.last_name is not None:
        staff.last_name = data.last_name
    if data.is_active is not None:
        staff.is_active = data.is_active

    await db.flush()

    if role_changed:
        from app.services import audit_service
        await audit_service.log_audit(
            db,
            action="role_change",
            actor=current_user,
            entity_type="user",
            entity_id=str(staff.id),
            details={"from": role_before, "to": staff.role.value, "target_email": staff.email},
            request=request,
        )

    return {"id": str(staff.id), "full_name": staff.full_name, "role": staff.role.value, "email": staff.email, "is_active": staff.is_active}


@staff_router.delete("/{staff_id}", status_code=204)
async def deactivate_staff(
    staff_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    """Deactivate (soft-delete) a staff member."""
    staff = (await db.execute(
        select(User).where(User.id == staff_id, User.tenant_id == ctx.tenant_id, User.role != UserRole.CLIENT)
    )).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Miembro del equipo no encontrado.")
    if str(staff.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta.")
    staff.is_active = False
    await db.flush()


@staff_router.delete("/{staff_id}/hard-delete", status_code=204)
async def hard_delete_staff(
    staff_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user=Depends(require_roles("owner", "admin")),
):
    staff = (await db.execute(
        select(User).where(
            User.id == staff_id,
            User.tenant_id == ctx.tenant_id,
            User.role != UserRole.CLIENT,
        )
    )).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Miembro del equipo no encontrado.")

    await purge_user_account(db, user=staff, actor=current_user, tenant_id=ctx.tenant_id)


# ─── Programs Router ──────────────────────────────────────────────────────────

@programs_router.get("/exercise-library", response_model=list[ProgramExerciseLibraryItemResponse])
async def list_program_exercise_library(
    tenant: Tenant = Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    return _get_program_exercise_library(tenant)


@programs_router.post("/exercise-library", response_model=ProgramExerciseLibraryItemResponse, status_code=201)
async def create_program_exercise_library_item(
    data: ProgramExerciseLibraryItemCreateRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    items = _get_program_exercise_library(tenant)
    name = _normalize_program_exercise_value(data.name)
    group = _normalize_program_exercise_value(data.group)
    duplicate_key = f"{group.lower()}::{name.lower()}"

    if any(f"{item['group'].lower()}::{item['name'].lower()}" == duplicate_key for item in items):
        raise HTTPException(status_code=400, detail="Ese ejercicio ya existe en la biblioteca")

    item = {
        "id": str(uuid4()),
        "name": name,
        "group": group,
    }
    items.append(item)
    _save_program_exercise_library(tenant, items)
    await db.flush()
    return item


@programs_router.delete("/exercise-library/{exercise_id}", status_code=204)
async def delete_program_exercise_library_item(
    exercise_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    items = _get_program_exercise_library(tenant)
    filtered_items = [item for item in items if item["id"] != exercise_id]
    if len(filtered_items) == len(items):
        raise HTTPException(status_code=404, detail="Ejercicio no encontrado")

    _save_program_exercise_library(tenant, filtered_items)
    await db.flush()
    return Response(status_code=204)


@programs_router.get("", response_model=PaginatedResponse)
async def list_programs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    active_only: bool = False,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    query = select(TrainingProgram).where(TrainingProgram.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(TrainingProgram).where(TrainingProgram.tenant_id == ctx.tenant_id)
    if active_only:
        query = query.where(TrainingProgram.is_active == True)
        count_query = count_query.where(TrainingProgram.is_active == True)

    total = (await db.execute(count_query)).scalar() or 0
    programs = (
        await db.execute(
            query.order_by(TrainingProgram.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
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
    enrollment_counts = await _get_program_enrollment_counts(db, ctx.tenant_id, program_ids)
    linked_class_counts = await _get_program_linked_class_counts(db, ctx.tenant_id, program_ids)

    return PaginatedResponse(
        items=[
            _program_payload(
                program,
                trainers.get(program.trainer_id),
                enrolled_count=enrollment_counts.get(program.id, 0),
                linked_class_count=linked_class_counts.get(program.id, 0),
            )
            for program in programs
        ],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@programs_router.post("", response_model=TrainingProgramResponse, status_code=201)
async def create_program(
    data: TrainingProgramCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    trainer_id = data.trainer_id or await _get_default_program_trainer_id(db, ctx.tenant_id)
    schedule_payload = [entry.model_dump(mode="json", exclude_none=True) for entry in data.schedule]
    program = TrainingProgram(
        tenant_id=ctx.tenant_id,
        name=data.name,
        description=data.description,
        trainer_id=trainer_id,
        program_type=data.program_type,
        duration_weeks=data.duration_weeks,
        schedule_json=json.dumps(schedule_payload),
        is_active=data.is_active,
    )
    db.add(program)
    await db.flush()
    await db.refresh(program)
    trainer = await db.get(User, program.trainer_id) if program.trainer_id else None
    return _program_payload(program, trainer, enrolled_count=0)


@programs_router.patch("/{program_id}", response_model=TrainingProgramResponse)
async def update_program(
    program_id: UUID,
    data: TrainingProgramUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    program = await db.get(TrainingProgram, program_id)
    if not program or program.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Programa no encontrado")

    payload = data.model_dump(exclude_unset=True, mode="json")
    if "schedule" in payload:
        payload["schedule_json"] = json.dumps(payload.pop("schedule"))
    for field, value in payload.items():
        setattr(program, field, value)

    await db.flush()
    await db.refresh(program)
    trainer = await db.get(User, program.trainer_id) if program.trainer_id else None
    enrolled_count = (
        await db.execute(
            select(func.count())
            .select_from(TrainingProgramEnrollment)
            .where(
                TrainingProgramEnrollment.tenant_id == ctx.tenant_id,
                TrainingProgramEnrollment.program_id == program.id,
            )
        )
    ).scalar() or 0
    linked_class_count = (
        await db.execute(
            select(func.count())
            .select_from(GymClass)
            .where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.program_id == program.id,
            )
        )
    ).scalar() or 0
    return _program_payload(program, trainer, enrolled_count=enrolled_count, linked_class_count=linked_class_count)


@programs_router.delete("/{program_id}", status_code=204)
async def delete_program(
    program_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    program = await db.get(TrainingProgram, program_id)
    if not program or program.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Programa no encontrado")

    linked_class_ids = (
        await db.execute(
            select(GymClass.id).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.program_id == program.id,
            )
        )
    ).scalars().all()

    if linked_class_ids:
        # Preserve historical check-ins while removing the generated classes.
        await db.execute(
            update(CheckIn)
            .where(
                CheckIn.tenant_id == ctx.tenant_id,
                CheckIn.gym_class_id.in_(linked_class_ids),
            )
            .values(gym_class_id=None)
        )
        await db.execute(
            delete(GymClass).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.program_id == program.id,
            )
        )
    await db.execute(
        delete(TrainingProgramEnrollment).where(
            TrainingProgramEnrollment.tenant_id == ctx.tenant_id,
            TrainingProgramEnrollment.program_id == program.id,
        )
    )

    await db.delete(program)
    await db.flush()
    return Response(status_code=204)


@programs_router.get("/{program_id}/enrollments", response_model=list[TrainingProgramEnrollmentResponse])
async def list_program_enrollments(
    program_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    program = await db.get(TrainingProgram, program_id)
    if not program or program.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Programa no encontrado")

    rows = await db.execute(
        select(TrainingProgramEnrollment, User)
        .join(User, User.id == TrainingProgramEnrollment.user_id)
        .where(
            TrainingProgramEnrollment.tenant_id == ctx.tenant_id,
            TrainingProgramEnrollment.program_id == program_id,
        )
        .order_by(User.first_name.asc(), User.last_name.asc(), TrainingProgramEnrollment.created_at.desc())
    )
    return [
        _program_enrollment_payload(enrollment, user)
        for enrollment, user in rows.all()
    ]


@programs_router.get("/{program_id}/classes", response_model=list[GymClassResponse])
async def list_program_classes(
    program_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    program = await db.get(TrainingProgram, program_id)
    if not program or program.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Programa no encontrado")

    classes = (
        await db.execute(
            select(GymClass)
            .where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.program_id == program_id,
            )
            .order_by(GymClass.start_time.asc())
        )
    ).scalars().all()

    return await build_gym_class_responses(db, classes)


@programs_router.post("/{program_id}/generate-classes", response_model=list[GymClassResponse], status_code=201)
async def generate_program_classes(
    program_id: UUID,
    data: GenerateClassesRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    program = await db.get(TrainingProgram, program_id)
    if not program or program.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Programa no encontrado")

    schedule = _loads_list(program.schedule_json)
    if not schedule:
        raise HTTPException(status_code=400, detail="El programa no tiene días definidos en el horario")

    WEEKDAY_MAP = {
        "lunes": 0, "martes": 1, "miércoles": 2, "miercoles": 2,
        "jueves": 3, "viernes": 4, "sábado": 5, "sabado": 5, "domingo": 6,
    }

    try:
        hour, minute = map(int, data.class_time.split(":"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Hora inválida")

    planned_instances: list[dict[str, Any]] = []
    seen_start_times: set[datetime] = set()

    for week in range(data.weeks):
        week_start = data.start_date + timedelta(weeks=week)
        week_monday = week_start - timedelta(days=week_start.weekday())
        for day_entry in schedule:
            day_name = str(day_entry.get("day", "")).strip().lower()
            target_weekday = WEEKDAY_MAP.get(day_name)
            if target_weekday is None:
                continue

            class_date = week_monday + timedelta(days=target_weekday)
            # class_time is in the user's local timezone; convert to UTC using
            # utc_offset_minutes (JS getTimezoneOffset value, e.g. 180 for UTC-3).
            local_dt = datetime(class_date.year, class_date.month, class_date.day, hour, minute)
            start_dt = (local_dt + timedelta(minutes=data.utc_offset_minutes)).replace(tzinfo=timezone.utc)
            end_dt = start_dt + timedelta(minutes=data.duration_minutes)
            focus = str(day_entry.get("focus", "")).strip() or None

            day_cfg = day_entry.get("class_config") if isinstance(day_entry.get("class_config"), dict) else {}
            resolved_branch_id = _resolve_program_day_config_value(day_cfg, "branch_id", data.branch_id)
            resolved_instructor_id = _resolve_program_day_config_value(day_cfg, "instructor_id", data.instructor_id)
            resolved_modality = _resolve_program_day_config_value(day_cfg, "modality", data.modality)
            resolved_max_capacity = _resolve_program_day_config_value(day_cfg, "max_capacity", data.max_capacity)
            resolved_online_link = _resolve_program_day_config_value(day_cfg, "online_link", data.online_link)
            resolved_deadline = _resolve_program_day_config_value(
                day_cfg,
                "cancellation_deadline_hours",
                data.cancellation_deadline_hours,
            )
            resolved_restricted_plan_id = _resolve_program_day_config_value(
                day_cfg,
                "restricted_plan_id",
                data.restricted_plan_id,
            )
            resolved_color = _resolve_program_day_config_value(day_cfg, "color", data.color)
            resolved_class_type = _resolve_program_day_config_value(
                day_cfg,
                "class_type",
                data.class_type if data.class_type is not None else program.program_type,
            )

            if resolved_modality is None:
                resolved_modality = data.modality
            if resolved_max_capacity is None:
                resolved_max_capacity = data.max_capacity
            if resolved_deadline is None:
                resolved_deadline = data.cancellation_deadline_hours

            if start_dt in seen_start_times:
                raise HTTPException(
                    status_code=400,
                    detail="El horario del programa produce clases duplicadas en la misma fecha y hora. Revisa los días configurados antes de generar.",
                )
            seen_start_times.add(start_dt)

            planned_instances.append({
                "description": focus,
                "class_type": resolved_class_type,
                "color": resolved_color,
                "modality": resolved_modality,
                "branch_id": resolved_branch_id,
                "instructor_id": resolved_instructor_id,
                "online_link": resolved_online_link,
                "cancellation_deadline_hours": resolved_deadline,
                "restricted_plan_id": resolved_restricted_plan_id,
                "start_time": start_dt,
                "end_time": end_dt,
                "max_capacity": resolved_max_capacity,
            })

    if not planned_instances:
        raise HTTPException(status_code=400, detail="No se pudieron generar clases con los días del programa")

    planned_instances.sort(key=lambda item: item["start_time"])
    planned_start_times = [item["start_time"] for item in planned_instances]

    existing_classes = (
        await db.execute(
            select(GymClass)
            .where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.program_id == program_id,
                GymClass.status != ClassStatus.CANCELLED,
                GymClass.start_time.in_(planned_start_times),
            )
            .order_by(GymClass.start_time.asc())
        )
    ).scalars().all()
    if existing_classes:
        tz_name = ctx.tenant.timezone if ctx.tenant and ctx.tenant.timezone else "UTC"
        try:
            zone = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            zone = ZoneInfo("UTC")

        def _local(dt: datetime) -> str:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(zone).strftime("%d/%m/%Y %H:%M")

        first_existing = _local(existing_classes[0].start_time)
        last_existing = _local(existing_classes[-1].start_time)
        if len(existing_classes) == len(planned_instances):
            detail = (
                f"Ya existe una tanda activa de clases para este programa entre {first_existing} y {last_existing}. "
                "Revisa las clases vinculadas antes de generar nuevamente."
            )
        else:
            detail = (
                f"Ya existen {len(existing_classes)} clase(s) activas de este programa dentro del rango solicitado "
                f"({first_existing} a {last_existing}). Ajusta el rango o elimina la tanda anterior antes de generar."
            )
        raise HTTPException(status_code=400, detail=detail)

    recurrence_group_id = uuid4()
    created_classes: list[GymClass] = []
    for instance in planned_instances:
        gym_class = GymClass(
            tenant_id=ctx.tenant_id,
            name=program.name,
            description=instance["description"],
            class_type=instance["class_type"],
            color=instance["color"],
            modality=instance["modality"],
            branch_id=instance["branch_id"],
            instructor_id=instance["instructor_id"],
            online_link=instance["online_link"],
            cancellation_deadline_hours=instance["cancellation_deadline_hours"],
            restricted_plan_id=instance["restricted_plan_id"],
            start_time=instance["start_time"],
            end_time=instance["end_time"],
            max_capacity=instance["max_capacity"],
            program_id=program_id,
            recurrence_group_id=recurrence_group_id,
            repeat_type="weekly",
        )
        db.add(gym_class)
        created_classes.append(gym_class)

    await db.flush()
    for gc in created_classes:
        await db.refresh(gc)

    return await build_gym_class_responses(db, created_classes)


@settings_router.get("", response_model=TenantSettingsResponse)
async def get_tenant_settings(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("owner", "admin")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    features = _feature_map(tenant)
    support_email, support_phone = await resolve_tenant_support_contacts(db, tenant)
    primary_color = coerce_brand_color(tenant.primary_color, DEFAULT_PRIMARY_COLOR)
    secondary_color = coerce_brand_color(tenant.secondary_color, DEFAULT_SECONDARY_COLOR)
    try:
        custom_domain = normalize_custom_domain(tenant.custom_domain)
    except ValueError:
        custom_domain = tenant.custom_domain

    return TenantSettingsResponse(
        slug=tenant.slug,
        gym_name=tenant.name,
        email=tenant.email,
        phone=tenant.phone,
        city=tenant.city,
        address=tenant.address,
        primary_color=primary_color,
        secondary_color=secondary_color,
        logo_url=tenant.logo_url,
        custom_domain=custom_domain,
        billing_email=str(features.get("billing_email", tenant.email)),
        support_email=support_email,
        support_phone=support_phone,
        public_api_key=str(features.get("public_api_key", f"nexo_live_{tenant.slug.replace('-', '_')}")),
        marketplace_headline=str(features.get("marketplace_headline", f"{tenant.name}: planes, clases y reservas online")),
        marketplace_description=str(features.get("marketplace_description", "Compra tu plan, reserva tus clases y administra tu membresia en un solo lugar.")),
        reminder_emails=bool(features.get("reminder_emails", True)),
        reminder_whatsapp=bool(features.get("reminder_whatsapp", True)),
        staff_can_edit_plans=bool(features.get("staff_can_edit_plans", False)),
        two_factor_required=bool(features.get("two_factor_required", False)),
        public_checkout_enabled=bool(features.get("public_checkout_enabled", True)),
        branding={
            "logo_url": tenant.logo_url,
            "primary_color": primary_color,
            "secondary_color": secondary_color,
            "custom_domain": custom_domain,
            "support_email": support_email,
            "support_phone": support_phone,
            "marketplace_headline": str(features.get("marketplace_headline", "")) or None,
            "marketplace_description": str(features.get("marketplace_description", "")) or None,
        },
    )


@settings_router.patch("", response_model=TenantSettingsResponse)
async def update_tenant_settings(
    data: TenantSettingsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    payload = data.model_dump(exclude_unset=True)
    color_labels = {
        "primary_color": "color principal",
        "secondary_color": "color secundario",
    }
    for field, label in color_labels.items():
        if field not in payload:
            continue
        try:
            payload[field] = normalize_brand_color(
                payload[field],
                field_label=label,
                default=DEFAULT_PRIMARY_COLOR if field == "primary_color" else DEFAULT_SECONDARY_COLOR,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    if "custom_domain" in payload:
        try:
            payload["custom_domain"] = normalize_custom_domain(payload["custom_domain"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        if payload["custom_domain"]:
            await _ensure_custom_domain_is_available(
                db,
                candidate_domain=payload["custom_domain"],
                tenant_id=tenant.id,
            )

    tenant_field_map = {
        "gym_name": "name",
        "email": "email",
        "phone": "phone",
        "city": "city",
        "address": "address",
        "primary_color": "primary_color",
        "secondary_color": "secondary_color",
        "logo_url": "logo_url",
        "custom_domain": "custom_domain",
    }
    feature_updates: dict[str, Any] = {}

    for field, value in payload.items():
        tenant_field = tenant_field_map.get(field)
        if tenant_field:
            setattr(tenant, tenant_field, value)
        else:
            feature_updates[field] = value

    if feature_updates:
        _save_feature_map(tenant, feature_updates)

    await db.flush()
    return await get_tenant_settings(tenant=tenant, db=db)


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

    # ── POS data ──────────────────────────────────────────────────────────────
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

    # POS revenue buckets (same month_keys)
    pos_revenue_buckets: dict[str, float] = {key: 0.0 for key in month_keys}
    for tx in pos_txs:
        key = tx.sold_at.strftime("%b")
        if key in pos_revenue_buckets:
            pos_revenue_buckets[key] += float(tx.total)

    # Top 5 products by revenue
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

    # ── Expense data ──────────────────────────────────────────────────────────
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

    # Expense buckets per period
    expense_buckets: dict[str, float] = {key: 0.0 for key in month_keys}
    for exp in expenses:
        key = exp.expense_date.strftime("%b")
        if key in expense_buckets:
            expense_buckets[key] += float(exp.amount)

    # ── P&L consolidado ───────────────────────────────────────────────────────
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
        # POS
        pos_revenue=pos_revenue,
        pos_revenue_series=[ReportSeriesPoint(label=l, value=v) for l, v in pos_revenue_buckets.items()],
        pos_cogs=pos_cogs,
        pos_gross_profit=pos_gross_profit,
        pos_gross_margin_pct=pos_gross_margin_pct,
        top_products=top_products,
        # Gastos
        total_expenses=total_expenses,
        expenses_by_category=expenses_by_category,
        expense_series=[ReportSeriesPoint(label=l, value=v) for l, v in expense_buckets.items()],
        # P&L
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

    # Load classes in range
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

    # Count confirmed+attended reservations per class (for occupancy denominator)
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

    # Attendance source of truth: attended reservations per class
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

    # Legacy fallback: checkins without reservation_id link (pre-migration records)
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

    # Aggregate by class name (since same class recurs)
    class_stats: dict[str, dict] = {}
    for c in classes:
        key = c.name
        if key not in class_stats:
            class_stats[key] = {"name": key, "sessions": 0, "total_capacity": 0, "total_reservations": 0, "total_attended": 0}
        class_stats[key]["sessions"] += 1
        class_stats[key]["total_capacity"] += c.max_capacity or 0
        class_stats[key]["total_reservations"] += res_by_class.get(c.id, 0)
        # Attendance = attended reservations + legacy unlinked checkins
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

    # Instructor rankings
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
