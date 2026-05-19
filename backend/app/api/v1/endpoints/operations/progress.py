"""Progress (body measurements) — owner view of any client's measurements."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_tenant, require_roles
from app.models.business import BodyMeasurement
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.platform import BodyMeasurementResponse

from ._common import _measurement_to_response

progress_router = APIRouter(prefix="/progress", tags=["Progress"])


@progress_router.get("/{user_id}", response_model=list[BodyMeasurementResponse])
async def owner_list_measurements(
    user_id: UUID,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.TRAINER)),
    db: AsyncSession = Depends(get_db),
) -> list[BodyMeasurementResponse]:
    result = await db.execute(
        select(BodyMeasurement)
        .where(BodyMeasurement.user_id == user_id, BodyMeasurement.tenant_id == tenant.id)
        .order_by(BodyMeasurement.recorded_at.desc())
    )
    return [_measurement_to_response(m) for m in result.scalars().all()]
