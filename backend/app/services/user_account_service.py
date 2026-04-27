"""Helpers for permanently deleting user accounts safely."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import (
    AuditLog,
    Campaign,
    CheckIn,
    FeedbackSubmission,
    GymClass,
    SupportInteraction,
    TrainingProgram,
)
from app.models.pos import POSTransaction
from app.models.user import User, UserRole

_NULLABLE_USER_REFERENCE_UPDATES: tuple[tuple[type[Any], Any], ...] = (
    (GymClass, GymClass.instructor_id),
    (CheckIn, CheckIn.checked_in_by),
    (Campaign, Campaign.created_by),
    (FeedbackSubmission, FeedbackSubmission.created_by),
    (SupportInteraction, SupportInteraction.user_id),
    (SupportInteraction, SupportInteraction.handled_by),
    (AuditLog, AuditLog.user_id),
    (TrainingProgram, TrainingProgram.trainer_id),
    (POSTransaction, POSTransaction.cashier_id),
)


async def _nullify_user_references(db: AsyncSession, user_id: UUID) -> None:
    for model, column in _NULLABLE_USER_REFERENCE_UPDATES:
        await db.execute(
            update(model)
            .where(column == user_id)
            .values({column.key: None})
        )


async def _ensure_deletable_owner(db: AsyncSession, user: User) -> None:
    remaining_active_owners = (
        await db.execute(
            select(func.count())
            .select_from(User)
            .where(
                User.tenant_id == user.tenant_id,
                User.role == UserRole.OWNER,
                User.is_active == True,
                User.id != user.id,
            )
        )
    ).scalar_one()

    if remaining_active_owners < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes eliminar al último owner activo de la cuenta.",
        )


async def purge_user_account(
    db: AsyncSession,
    *,
    user: User,
    actor: User | None = None,
    tenant_id: UUID | None = None,
) -> None:
    """Permanently delete a user while preserving operational records that can outlive the account."""

    if user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede eliminar esta cuenta desde este módulo.",
        )

    if tenant_id and user.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

    if actor and actor.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes eliminar tu propia cuenta.",
        )

    if user.role == UserRole.OWNER:
        actor_role = getattr(actor.role, "value", actor.role) if actor else None
        if actor_role != "owner":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo otro owner puede eliminar una cuenta owner.",
            )
        await _ensure_deletable_owner(db, user)

    await _nullify_user_references(db, user.id)
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(refresh_token=None)
    )
    try:
        await db.execute(
            delete(User)
            .where(User.id == user.id)
            .execution_options(synchronize_session=False)
        )
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudo eliminar la cuenta porque aún tiene registros relacionados que deben resolverse primero.",
        ) from exc
