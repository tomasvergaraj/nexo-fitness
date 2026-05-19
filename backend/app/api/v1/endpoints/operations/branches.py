"""Branches endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import TenantContext, get_tenant_context, require_roles
from app.models.business import Branch
from app.schemas.business import BranchCreate, BranchResponse, BranchUpdate
from app.services.tenant_quota_service import assert_can_create_branch

branches_router = APIRouter(prefix="/branches", tags=["Branches"])


@branches_router.get("", response_model=list[BranchResponse])
async def list_branches(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    result = await db.execute(
        select(Branch).where(Branch.tenant_id == ctx.tenant_id).order_by(Branch.created_at.asc())
    )
    return [BranchResponse.model_validate(branch) for branch in result.scalars().all()]


@branches_router.post("", response_model=BranchResponse, status_code=201)
async def create_branch(
    data: BranchCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    if not ctx.tenant:
        raise HTTPException(status_code=403, detail="No hay tenant activo para crear sucursales")

    await assert_can_create_branch(db, ctx.tenant)
    branch = Branch(tenant_id=ctx.tenant_id, **data.model_dump())
    db.add(branch)
    await db.flush()
    await db.refresh(branch)
    return BranchResponse.model_validate(branch)


@branches_router.patch("/{branch_id}", response_model=BranchResponse)
async def update_branch(
    branch_id: UUID,
    data: BranchUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    branch = await db.get(Branch, branch_id)
    if not branch or branch.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Sede no encontrada")

    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("is_active") is True and not branch.is_active:
        if not ctx.tenant:
            raise HTTPException(status_code=403, detail="No hay tenant activo para reactivar sucursales")
        await assert_can_create_branch(db, ctx.tenant)

    for field, value in update_data.items():
        setattr(branch, field, value)

    await db.flush()
    await db.refresh(branch)
    return BranchResponse.model_validate(branch)
