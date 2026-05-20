"""Feedback submissions router (owner-side)."""

import asyncio
from typing import Optional
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_tenant_context,
    require_roles,
)
from app.integrations.email.email_service import email_service
from app.models.business import FeedbackSubmission
from app.models.user import User
from app.schemas.platform import FeedbackSubmissionResponse

from ._common import (
    _JPEG_MAGIC,
    _MAX_PHOTO_BYTES,
    _PHOTO_ALLOWED_TYPES,
    _PNG_MAGIC,
    _UPLOADS_ROOT,
    _WEBP_ID,
    _WEBP_RIFF,
    _build_upload_url,
    _compress_photo,
)


feedback_router = APIRouter(prefix="/feedback/submissions", tags=["Feedback"])

settings = get_settings()
logger = structlog.get_logger()

_FEEDBACK_CATEGORY_LABELS: dict[str, str] = {
    "suggestion": "Sugerencia",
    "improvement": "Solicitud de mejora",
    "problem": "Problema",
    "other": "Otro",
}
_MAX_FEEDBACK_MESSAGE_CHARS = 5000


def _feedback_payload(
    submission: FeedbackSubmission,
    request: Request,
    creator: Optional[User],
) -> FeedbackSubmissionResponse:
    return FeedbackSubmissionResponse(
        id=submission.id,
        category=str(submission.category.value if hasattr(submission.category, "value") else submission.category),
        message=submission.message,
        image_url=_build_upload_url(request, submission.image_path),
        created_at=submission.created_at,
        created_by=submission.created_by,
        created_by_name=creator.full_name if creator else None,
    )


async def _get_feedback_related_users(
    db: AsyncSession,
    submissions: list[FeedbackSubmission],
) -> dict[UUID, User]:
    related_ids = [item.created_by for item in submissions if item.created_by]
    if not related_ids:
        return {}

    result = await db.execute(select(User).where(User.id.in_(related_ids)))
    return {user.id: user for user in result.scalars().all()}


def _normalize_feedback_category(category: str) -> str:
    normalized = category.strip().lower()
    if normalized not in _FEEDBACK_CATEGORY_LABELS:
        raise HTTPException(
            status_code=400,
            detail="La categoría debe ser suggestion, improvement, problem o other.",
        )
    return normalized


def _normalize_feedback_message(message: str) -> str:
    normalized = message.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío.")
    if len(normalized) > _MAX_FEEDBACK_MESSAGE_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"El mensaje supera el límite de {_MAX_FEEDBACK_MESSAGE_CHARS} caracteres.",
        )
    return normalized


async def _store_feedback_image(
    *,
    file: UploadFile,
    tenant_id: UUID,
) -> str:
    content_type = file.content_type or ""
    if content_type not in _PHOTO_ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Solo se aceptan imágenes JPEG, PNG o WebP.")

    raw = await file.read()
    if len(raw) > _MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="La imagen supera el tamaño máximo de 15 MB.")

    is_valid_image = (
        raw[:3] == _JPEG_MAGIC
        or raw[:4] == _PNG_MAGIC
        or (len(raw) >= 12 and raw[:4] == _WEBP_RIFF and raw[8:12] == _WEBP_ID)
    )
    if not is_valid_image:
        raise HTTPException(status_code=400, detail="El archivo no es una imagen válida.")

    try:
        data = await asyncio.to_thread(_compress_photo, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    feedback_dir = _UPLOADS_ROOT / "feedback" / str(tenant_id)
    feedback_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid4().hex}.jpg"
    dest = feedback_dir / filename
    dest.write_bytes(data)

    return f"/uploads/feedback/{tenant_id}/{filename}"


def _resolve_feedback_recipient_email() -> str:
    return settings.FEEDBACK_TO_EMAIL.strip() or settings.SUPERADMIN_EMAIL.strip()


def _is_missing_feedback_table_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "feedback_submissions" in message and ("does not exist" in message or "undefinedtableerror" in message)


def _raise_feedback_unavailable() -> None:
    raise HTTPException(
        status_code=503,
        detail="El módulo Feedback aún no está disponible en esta instalación porque falta ejecutar la migración de base de datos.",
    )


async def _send_feedback_submission_notification(
    *,
    request: Request,
    submission: FeedbackSubmission,
    tenant_name: str,
    creator: User | None,
) -> None:
    recipient_email = _resolve_feedback_recipient_email()
    if not recipient_email:
        return

    category_key = str(submission.category.value if hasattr(submission.category, "value") else submission.category)
    category_label = _FEEDBACK_CATEGORY_LABELS.get(category_key, category_key)
    creator_name = creator.full_name if creator and creator.full_name else "Equipo del gimnasio"
    creator_email = creator.email if creator else None
    image_url = _build_upload_url(request, submission.image_path)

    try:
        sent = await email_service.send_feedback_submission(
            to_email=recipient_email,
            gym_name=tenant_name,
            author_name=creator_name,
            author_email=creator_email,
            category_label=category_label,
            message=submission.message,
            image_url=image_url,
        )
        if not sent:
            logger.warning(
                "feedback_email_not_sent",
                tenant_name=tenant_name,
                submission_id=str(submission.id),
                recipient=recipient_email,
            )
    except Exception as exc:
        logger.warning(
            "feedback_email_failed",
            tenant_name=tenant_name,
            submission_id=str(submission.id),
            recipient=recipient_email,
            exc_info=exc,
        )


@feedback_router.get("", response_model=list[FeedbackSubmissionResponse])
async def list_feedback_submissions(
    request: Request,
    limit: int = Query(12, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    if ctx.tenant_id is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    try:
        submissions = (
            await db.execute(
                select(FeedbackSubmission)
                .where(FeedbackSubmission.tenant_id == ctx.tenant_id)
                .order_by(FeedbackSubmission.created_at.desc())
                .limit(limit)
            )
        ).scalars().all()
    except ProgrammingError as exc:
        if _is_missing_feedback_table_error(exc):
            _raise_feedback_unavailable()
        raise

    related_users = await _get_feedback_related_users(db, submissions)
    return [
        _feedback_payload(item, request, related_users.get(item.created_by))
        for item in submissions
    ]


@feedback_router.post("", response_model=FeedbackSubmissionResponse, status_code=201)
async def create_feedback_submission(
    request: Request,
    category: str = Form(...),
    message: str = Form(...),
    image: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(require_roles("owner", "admin", "reception")),
):
    if ctx.tenant_id is None or ctx.tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    normalized_category = _normalize_feedback_category(category)
    normalized_message = _normalize_feedback_message(message)
    image_path = await _store_feedback_image(file=image, tenant_id=ctx.tenant_id) if image is not None else None

    submission = FeedbackSubmission(
        tenant_id=ctx.tenant_id,
        created_by=current_user.id,
        category=normalized_category,
        message=normalized_message,
        image_path=image_path,
    )
    db.add(submission)
    try:
        await db.flush()
    except ProgrammingError as exc:
        if _is_missing_feedback_table_error(exc):
            _raise_feedback_unavailable()
        raise
    await db.refresh(submission)

    await _send_feedback_submission_notification(
        request=request,
        submission=submission,
        tenant_name=ctx.tenant.name,
        creator=current_user,
    )

    return _feedback_payload(submission, request, current_user)
