"""Helpers for validating class branch assignments and enriching class responses."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Branch, GymClass
from app.models.user import User
from app.schemas.business import GymClassResponse

SUPPORTED_CLASS_MODALITIES = {"in_person", "online", "hybrid"}
MODALITIES_REQUIRING_BRANCH = {"in_person", "hybrid"}


def normalize_class_modality(raw_modality: str) -> str:
    source_value = raw_modality.value if hasattr(raw_modality, "value") else raw_modality
    modality = str(source_value or "").strip().lower()
    if modality not in SUPPORTED_CLASS_MODALITIES:
        raise HTTPException(status_code=400, detail="Modalidad de clase no válida.")
    return modality


def modality_requires_branch(modality: str) -> bool:
    return normalize_class_modality(modality) in MODALITIES_REQUIRING_BRANCH


async def validate_branch_assignment(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    modality: str,
    branch_id: Optional[UUID],
) -> Optional[Branch]:
    normalized_modality = normalize_class_modality(modality)

    if branch_id is None:
        if normalized_modality in MODALITIES_REQUIRING_BRANCH:
            raise HTTPException(
                status_code=400,
                detail="Las clases presenciales o híbridas requieren una sede activa.",
            )
        return None

    branch = (
        await db.execute(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()

    if not branch:
        raise HTTPException(status_code=404, detail="La sede seleccionada no existe para esta cuenta.")
    if not branch.is_active:
        raise HTTPException(status_code=400, detail="La sede seleccionada está inactiva.")

    return branch


async def build_gym_class_responses(
    db: AsyncSession,
    classes: Sequence[GymClass],
) -> list[GymClassResponse]:
    instructor_ids = list({gym_class.instructor_id for gym_class in classes if gym_class.instructor_id})
    branch_ids = list({gym_class.branch_id for gym_class in classes if gym_class.branch_id})

    instructors_by_id: dict[UUID, str] = {}
    if instructor_ids:
        instructor_rows = await db.execute(select(User).where(User.id.in_(instructor_ids)))
        for instructor in instructor_rows.scalars().all():
            instructors_by_id[instructor.id] = instructor.full_name

    branches_by_id: dict[UUID, str] = {}
    if branch_ids:
        branch_rows = await db.execute(select(Branch).where(Branch.id.in_(branch_ids)))
        for branch in branch_rows.scalars().all():
            branches_by_id[branch.id] = branch.name

    items: list[GymClassResponse] = []
    for gym_class in classes:
        payload = GymClassResponse.model_validate(gym_class)
        if gym_class.instructor_id:
            payload.instructor_name = instructors_by_id.get(gym_class.instructor_id)
        if gym_class.branch_id:
            payload.branch_name = branches_by_id.get(gym_class.branch_id)
        items.append(payload)
    return items


async def build_gym_class_response(db: AsyncSession, gym_class: GymClass) -> GymClassResponse:
    responses = await build_gym_class_responses(db, [gym_class])
    return responses[0]
