"""Shared helpers and constants for the operations sub-routers."""

import json
import os
from pathlib import Path

from app.models.business import BodyMeasurement, PersonalRecord, PromoCode
from app.schemas.platform import (
    BodyMeasurementResponse,
    PersonalRecordResponse,
    PromoCodeResponse,
)


# Uploads root (shared with upload, feedback, progress-photos handlers).
_UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", "uploads"))

# Image magic bytes (shared with upload + progress-photo validators).
_PNG_MAGIC = b"\x89PNG"


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
