"""Tenant quota helpers for SaaS plan enforcement."""

from __future__ import annotations

import json
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PlanLimitReachedError
from app.models.business import Branch
from app.models.tenant import Tenant
from app.models.user import User, UserRole


@dataclass(frozen=True)
class TenantUsageSnapshot:
    tenant_id: UUID
    plan_key: str
    active_clients: int
    active_branches: int
    max_members: int
    max_branches: int
    remaining_client_slots: int
    remaining_branch_slots: int
    over_client_limit: bool
    over_branch_limit: bool


def resolve_quota_plan_key(tenant: Tenant) -> str:
    if tenant.features:
        try:
            features = json.loads(tenant.features)
        except json.JSONDecodeError:
            features = {}
        if isinstance(features, dict):
            plan_key = features.get("saas_plan_key")
            if isinstance(plan_key, str) and plan_key.strip():
                return plan_key.strip().lower()

    return tenant.license_type.value if hasattr(tenant.license_type, "value") else str(tenant.license_type)


def build_tenant_usage_snapshot(
    tenant: Tenant,
    *,
    active_clients: int,
    active_branches: int,
) -> TenantUsageSnapshot:
    max_members = int(tenant.max_members or 0)
    max_branches = int(tenant.max_branches or 0)
    remaining_client_slots = max(max_members - active_clients, 0)
    remaining_branch_slots = max(max_branches - active_branches, 0)

    return TenantUsageSnapshot(
        tenant_id=tenant.id,
        plan_key=resolve_quota_plan_key(tenant),
        active_clients=active_clients,
        active_branches=active_branches,
        max_members=max_members,
        max_branches=max_branches,
        remaining_client_slots=remaining_client_slots,
        remaining_branch_slots=remaining_branch_slots,
        over_client_limit=active_clients > max_members,
        over_branch_limit=active_branches > max_branches,
    )


async def get_tenant_usage_snapshot(
    db: AsyncSession,
    tenant_id: UUID,
    *,
    tenant: Tenant | None = None,
) -> TenantUsageSnapshot:
    resolved_tenant = tenant or await db.get(Tenant, tenant_id)
    if resolved_tenant is None:
        raise ValueError("Tenant no encontrado para evaluar cupos")

    active_clients = (
        await db.execute(
            select(func.count()).select_from(User).where(
                User.tenant_id == resolved_tenant.id,
                User.role == UserRole.CLIENT,
                User.is_active == True,
            )
        )
    ).scalar() or 0

    active_branches = (
        await db.execute(
            select(func.count()).select_from(Branch).where(
                Branch.tenant_id == resolved_tenant.id,
                Branch.is_active == True,
            )
        )
    ).scalar() or 0

    return build_tenant_usage_snapshot(
        resolved_tenant,
        active_clients=active_clients,
        active_branches=active_branches,
    )


def assert_can_create_client_from_snapshot(snapshot: TenantUsageSnapshot) -> TenantUsageSnapshot:
    if snapshot.active_clients >= snapshot.max_members:
        raise PlanLimitReachedError(
            (
                f"Tu plan {snapshot.plan_key} permite hasta {snapshot.max_members} clientes activos. "
                "Desactiva uno o mejora tu plan para seguir creando clientes."
            ),
            resource="clients",
            current_usage=snapshot.active_clients,
            limit=snapshot.max_members,
            plan_key=snapshot.plan_key,
        )

    return snapshot


def assert_can_create_branch_from_snapshot(snapshot: TenantUsageSnapshot) -> TenantUsageSnapshot:
    if snapshot.active_branches >= snapshot.max_branches:
        raise PlanLimitReachedError(
            (
                f"Tu plan {snapshot.plan_key} permite hasta {snapshot.max_branches} sucursales activas. "
                "Desactiva una o mejora tu plan para seguir creando sucursales."
            ),
            resource="branches",
            current_usage=snapshot.active_branches,
            limit=snapshot.max_branches,
            plan_key=snapshot.plan_key,
        )

    return snapshot


async def assert_can_create_client(db: AsyncSession, tenant: Tenant) -> TenantUsageSnapshot:
    snapshot = await get_tenant_usage_snapshot(db, tenant.id, tenant=tenant)
    return assert_can_create_client_from_snapshot(snapshot)


async def assert_can_create_branch(db: AsyncSession, tenant: Tenant) -> TenantUsageSnapshot:
    snapshot = await get_tenant_usage_snapshot(db, tenant.id, tenant=tenant)
    return assert_can_create_branch_from_snapshot(snapshot)
