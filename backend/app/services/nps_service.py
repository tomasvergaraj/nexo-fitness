"""NPS post-clase: encuesta de satisfacción tras asistir a una clase.

Flujo: la tarea Celery `send_nps_surveys` envía un push ~24h después del
check-in en una clase. El miembro responde 0-10 desde la app. Una respuesta
por check-in (constraint único). El owner ve el NPS agregado.

Escala NPS estándar:
- Promotores: 9-10
- Pasivos:    7-8
- Detractores: 0-6
NPS = %promotores − %detractores  (rango −100 a +100)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import CheckIn, GymClass, NPSResponse

# Ventana de elegibilidad: el check-in debe tener al menos PENDING_MIN_HOURS
# (para que la clase ya haya terminado y haya pasado ~1 día) y como mucho
# PENDING_MAX_DAYS (después caduca y no se pregunta).
PENDING_MIN_HOURS = 24
PENDING_MAX_DAYS = 7


class NPSValidationError(ValueError):
    """Error de validación de una respuesta NPS (score fuera de rango, etc.)."""


def classify_score(score: int) -> str:
    if score >= 9:
        return "promoter"
    if score >= 7:
        return "passive"
    return "detractor"


async def get_pending_survey(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
) -> dict | None:
    """Devuelve la encuesta NPS pendiente más antigua del miembro, o None.

    Pendiente = check-in en una clase, entre 24h y 7 días atrás, sin respuesta.
    """
    now = datetime.now(timezone.utc)
    window_newest = now - timedelta(hours=PENDING_MIN_HOURS)
    window_oldest = now - timedelta(days=PENDING_MAX_DAYS)

    answered_subq = (
        select(NPSResponse.checkin_id)
        .where(NPSResponse.tenant_id == tenant_id, NPSResponse.checkin_id.isnot(None))
    )

    row = (
        await db.execute(
            select(CheckIn, GymClass)
            .join(GymClass, CheckIn.gym_class_id == GymClass.id)
            .where(
                CheckIn.tenant_id == tenant_id,
                CheckIn.user_id == user_id,
                CheckIn.gym_class_id.isnot(None),
                CheckIn.checked_in_at <= window_newest,
                CheckIn.checked_in_at >= window_oldest,
                CheckIn.id.notin_(answered_subq),
            )
            .order_by(CheckIn.checked_in_at.asc())
            .limit(1)
        )
    ).first()

    if row is None:
        return None

    checkin, gym_class = row
    return {
        "checkin_id": checkin.id,
        "gym_class_id": gym_class.id,
        "class_name": gym_class.name,
        "class_start_time": gym_class.start_time,
        "checked_in_at": checkin.checked_in_at,
    }


async def submit_nps(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    checkin_id: UUID,
    score: int,
    comment: str | None = None,
) -> NPSResponse:
    """Registra la respuesta NPS de un miembro para un check-in suyo.

    Valida score 0-10, que el check-in sea del miembro y no esté ya respondido.
    """
    if not isinstance(score, int) or score < 0 or score > 10:
        raise NPSValidationError("El puntaje debe estar entre 0 y 10.")

    checkin = (
        await db.execute(
            select(CheckIn).where(
                CheckIn.id == checkin_id,
                CheckIn.tenant_id == tenant_id,
                CheckIn.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if checkin is None:
        raise NPSValidationError("Check-in no encontrado.")

    existing = (
        await db.execute(
            select(NPSResponse).where(
                NPSResponse.tenant_id == tenant_id,
                NPSResponse.checkin_id == checkin_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise NPSValidationError("Ya respondiste esta encuesta.")

    clean_comment = (comment or "").strip() or None
    if clean_comment and len(clean_comment) > 1000:
        clean_comment = clean_comment[:1000]

    response = NPSResponse(
        tenant_id=tenant_id,
        user_id=user_id,
        checkin_id=checkin_id,
        gym_class_id=checkin.gym_class_id,
        score=score,
        comment=clean_comment,
    )
    db.add(response)
    await db.flush()
    await db.refresh(response)
    return response


async def get_nps_summary(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    days: int = 90,
) -> dict:
    """Resumen NPS agregado del tenant en la ventana indicada.

    Devuelve nps_score (−100..100), conteos por segmento, total y promedio.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    rows = (
        await db.execute(
            select(NPSResponse.score).where(
                NPSResponse.tenant_id == tenant_id,
                NPSResponse.created_at >= since,
            )
        )
    ).scalars().all()

    total = len(rows)
    if total == 0:
        return {
            "nps_score": None,
            "total": 0,
            "promoters": 0,
            "passives": 0,
            "detractors": 0,
            "average": None,
            "days": days,
        }

    promoters = sum(1 for s in rows if s >= 9)
    passives = sum(1 for s in rows if 7 <= s <= 8)
    detractors = sum(1 for s in rows if s <= 6)
    nps_score = round((promoters - detractors) / total * 100)
    average = round(sum(rows) / total, 1)

    return {
        "nps_score": nps_score,
        "total": total,
        "promoters": promoters,
        "passives": passives,
        "detractors": detractors,
        "average": average,
        "days": days,
    }
