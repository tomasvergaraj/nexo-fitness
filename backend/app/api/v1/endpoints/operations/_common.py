"""Shared helpers and constants for the operations sub-routers."""

import json
import os
from pathlib import Path
from typing import Any, Optional
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import (
    BodyMeasurement,
    Membership,
    Notification,
    PersonalRecord,
    Plan,
    PromoCode,
    SupportInteraction,
)
from app.models.business import Payment as _Payment  # alias to avoid type confusion
from app.models.user import User
from app.schemas.platform import (
    BodyMeasurementResponse,
    MembershipResponse,
    NotificationDispatchResponse,
    NotificationResponse,
    PersonalRecordResponse,
    PromoCodeResponse,
    PushDeliveryResponse,
    SupportInteractionResponse,
)
from app.services.membership_sale_service import membership_status_value
from app.services.push_notification_service import NotificationDispatchResult


# Uploads root (shared with upload, feedback, progress-photos handlers).
_UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", "uploads"))

# Image magic bytes / limits (shared across upload, feedback, progress-photos).
_PNG_MAGIC = b"\x89PNG"
_JPEG_MAGIC = b"\xff\xd8\xff"
_WEBP_RIFF = b"RIFF"
_WEBP_ID = b"WEBP"
_PHOTO_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_PHOTO_BYTES = 15 * 1024 * 1024  # 15 MB raw input
_MAX_PHOTO_BYTES_COMPRESSED = 1 * 1024 * 1024
_MAX_PHOTOS_PER_USER = 30
_PHOTO_MAX_SIDE = 1920  # px, longest side after resize


def _compress_photo(raw: bytes) -> bytes:
    """Resize to max 1920px on longest side, re-encode as JPEG at 82% quality."""
    import io
    from PIL import Image, UnidentifiedImageError

    try:
        img = Image.open(io.BytesIO(raw))
    except UnidentifiedImageError:
        raise ValueError("El archivo no es una imagen válida.")

    img = img.convert("RGB")
    img.thumbnail((_PHOTO_MAX_SIDE, _PHOTO_MAX_SIDE), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True)
    return buf.getvalue()


def _loads_dict(raw_value: Optional[str]) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _loads_list(raw_value: Optional[str]) -> list[Any]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _build_upload_url(request: Request, file_path: str | None) -> str | None:
    if not file_path:
        return None
    return f"{str(request.base_url).rstrip('/')}{file_path}"


def _measurement_to_response(m: BodyMeasurement) -> BodyMeasurementResponse:
    return BodyMeasurementResponse(
        id=m.id,
        user_id=m.user_id,
        tenant_id=m.tenant_id,
        recorded_at=m.recorded_at,
        weight_kg=m.weight_kg,
        body_fat_pct=m.body_fat_pct,
        muscle_mass_kg=m.muscle_mass_kg,
        chest_cm=m.chest_cm,
        waist_cm=m.waist_cm,
        hip_cm=m.hip_cm,
        arm_cm=m.arm_cm,
        thigh_cm=m.thigh_cm,
        notes=m.notes,
        created_at=m.created_at,
    )


def _pr_to_response(pr: PersonalRecord) -> PersonalRecordResponse:
    return PersonalRecordResponse(
        id=pr.id,
        user_id=pr.user_id,
        tenant_id=pr.tenant_id,
        exercise_name=pr.exercise_name,
        record_value=pr.record_value,
        unit=pr.unit,
        recorded_at=pr.recorded_at,
        notes=pr.notes,
        created_at=pr.created_at,
    )


def _promo_to_response(promo: PromoCode) -> PromoCodeResponse:
    return PromoCodeResponse(
        id=promo.id,
        tenant_id=promo.tenant_id,
        code=promo.code,
        name=promo.name,
        description=promo.description,
        discount_type=promo.discount_type,
        discount_value=promo.discount_value,
        max_uses=promo.max_uses,
        uses_count=promo.uses_count,
        expires_at=promo.expires_at,
        is_active=promo.is_active,
        plan_ids=json.loads(promo.plan_ids) if promo.plan_ids else None,
        created_at=promo.created_at,
        updated_at=promo.updated_at,
    )


def _membership_payload(
    membership: Membership,
    user: Optional[User],
    plan: Optional[Plan],
    payment: Optional[_Payment] = None,
) -> MembershipResponse:
    return MembershipResponse(
        id=membership.id,
        user_id=membership.user_id,
        plan_id=membership.plan_id,
        status=membership_status_value(membership.status) or "pending",
        starts_at=membership.starts_at,
        expires_at=membership.expires_at,
        auto_renew=membership.auto_renew,
        frozen_until=membership.frozen_until,
        notes=membership.notes,
        stripe_subscription_id=membership.stripe_subscription_id,
        previous_membership_id=membership.previous_membership_id,
        sale_source=membership.sale_source,
        payment_id=payment.id if payment else None,
        payment_amount=payment.amount if payment else None,
        payment_currency=payment.currency if payment else None,
        payment_method=membership_status_value(payment.method) if payment else None,
        payment_status=membership_status_value(payment.status) if payment else None,
        paid_at=payment.paid_at if payment else None,
        created_at=membership.created_at,
        user_name=user.full_name if user else None,
        plan_name=plan.name if plan else None,
    )


def _support_payload(
    interaction: SupportInteraction,
    client: Optional[User],
    handler: Optional[User],
) -> SupportInteractionResponse:
    return SupportInteractionResponse(
        id=interaction.id,
        user_id=interaction.user_id,
        channel=str(interaction.channel.value if hasattr(interaction.channel, "value") else interaction.channel),
        subject=interaction.subject,
        notes=interaction.notes,
        resolved=interaction.resolved,
        handled_by=interaction.handled_by,
        created_at=interaction.created_at,
        client_name=client.full_name if client else None,
        handler_name=handler.full_name if handler else None,
    )


def _notification_payload(notification: Notification) -> NotificationResponse:
    return NotificationResponse.model_validate(notification)


def _notification_dispatch_payload(result: NotificationDispatchResult) -> NotificationDispatchResponse:
    return NotificationDispatchResponse(
        notification=_notification_payload(result.notification),
        push_deliveries=[
            PushDeliveryResponse(
                subscription_id=delivery.subscription_id,
                provider=delivery.provider,
                delivery_target=delivery.delivery_target,
                expo_push_token=delivery.expo_push_token,
                status=delivery.status,
                is_active=delivery.is_active,
                ticket_id=delivery.ticket_id,
                message=delivery.message,
                error=delivery.error,
                receipt_status=delivery.receipt_status,
                receipt_message=delivery.receipt_message,
                receipt_error=delivery.receipt_error,
                receipt_checked_at=delivery.receipt_checked_at,
            )
            for delivery in result.deliveries
        ],
    )


async def _get_support_related_users(
    db: AsyncSession,
    interactions: list[SupportInteraction],
) -> dict[UUID, User]:
    related_ids = [value for item in interactions for value in (item.user_id, item.handled_by) if value]
    if not related_ids:
        return {}

    result = await db.execute(select(User).where(User.id.in_(related_ids)))
    return {user.id: user for user in result.scalars().all()}
