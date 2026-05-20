"""Training programs router: exercise library + CRUD + enrollments + class generation."""

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_current_tenant,
    get_tenant_context,
    require_roles,
)
from app.models.business import (
    CheckIn,
    ClassStatus,
    GymClass,
    TrainingProgram,
    TrainingProgramEnrollment,
)
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.business import (
    GymClassResponse,
    PaginatedResponse,
)
from app.schemas.platform import (
    ProgramExerciseLibraryItemCreateRequest,
    ProgramExerciseLibraryItemResponse,
    TrainingProgramCreateRequest,
    TrainingProgramEnrollmentResponse,
    TrainingProgramResponse,
    TrainingProgramUpdateRequest,
)
from app.services.class_service import build_gym_class_responses

from ._common import (
    _feature_map,
    _get_program_enrollment_counts,
    _get_program_linked_class_counts,
    _loads_list,
    _program_payload,
    _save_feature_map,
)


programs_router = APIRouter(prefix="/programs", tags=["Programs"])

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
