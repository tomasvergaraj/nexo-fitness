"""Personal Records — owner view of any client's PRs."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_tenant, require_roles
from app.models.business import PersonalRecord
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.platform import PersonalRecordResponse

from ._common import _pr_to_response

personal_records_router = APIRouter(prefix="/personal-records", tags=["Personal Records"])


@personal_records_router.get("/{user_id}", response_model=list[PersonalRecordResponse])
async def owner_list_personal_records(
    user_id: UUID,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.TRAINER)),
    db: AsyncSession = Depends(get_db),
) -> list[PersonalRecordResponse]:
    result = await db.execute(
        select(PersonalRecord)
        .where(PersonalRecord.user_id == user_id, PersonalRecord.tenant_id == tenant.id)
        .order_by(PersonalRecord.recorded_at.desc())
    )
    return [_pr_to_response(pr) for pr in result.scalars().all()]
