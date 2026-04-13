from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.core.exceptions import PlanLimitReachedError
from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.services.tenant_quota_service import (
    assert_can_create_branch_from_snapshot,
    assert_can_create_client_from_snapshot,
    build_tenant_usage_snapshot,
    get_tenant_usage_snapshot,
)


class DummyScalarResult:
    def __init__(self, value: int) -> None:
        self.value = value

    def scalar(self) -> int:
        return self.value


class DummyDb:
    def __init__(self, tenant: Tenant, *, active_clients: int, active_branches: int) -> None:
        self.tenant = tenant
        self.active_clients = active_clients
        self.active_branches = active_branches

    async def get(self, model, ident):  # noqa: ANN001
        return self.tenant

    async def execute(self, query):  # noqa: ANN001
        sql = str(query)
        if "FROM users" in sql:
            return DummyScalarResult(self.active_clients)
        if "FROM branches" in sql:
            return DummyScalarResult(self.active_branches)
        raise AssertionError(f"Unexpected query: {sql}")


def make_tenant(**overrides) -> Tenant:
    tenant = Tenant(
        id=uuid.uuid4(),
        name="Nexo SaaS",
        slug="nexo-saas",
        email="owner@nexo.cl",
        currency="CLP",
        timezone="America/Santiago",
        license_type=LicenseType.MONTHLY,
        status=TenantStatus.ACTIVE,
        is_active=True,
        max_members=500,
        max_branches=3,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(tenant, key, value)
    return tenant


@pytest.mark.asyncio
async def test_get_tenant_usage_snapshot_reads_active_counts() -> None:
    tenant = make_tenant()
    db = DummyDb(tenant, active_clients=128, active_branches=2)

    snapshot = await get_tenant_usage_snapshot(db, tenant.id, tenant=tenant)

    assert snapshot.active_clients == 128
    assert snapshot.active_branches == 2
    assert snapshot.remaining_client_slots == 372
    assert snapshot.remaining_branch_slots == 1
    assert snapshot.over_client_limit is False
    assert snapshot.over_branch_limit is False


def test_build_tenant_usage_snapshot_marks_over_limit_after_downgrade() -> None:
    tenant = make_tenant(max_members=500, max_branches=3)

    snapshot = build_tenant_usage_snapshot(tenant, active_clients=800, active_branches=5)

    assert snapshot.over_client_limit is True
    assert snapshot.over_branch_limit is True
    assert snapshot.remaining_client_slots == 0
    assert snapshot.remaining_branch_slots == 0


def test_assert_can_create_client_from_snapshot_rejects_full_plan() -> None:
    tenant = make_tenant()
    snapshot = build_tenant_usage_snapshot(tenant, active_clients=500, active_branches=2)

    with pytest.raises(PlanLimitReachedError, match="clientes activos") as exc_info:
        assert_can_create_client_from_snapshot(snapshot)

    assert exc_info.value.resource == "clients"
    assert exc_info.value.current_usage == 500
    assert exc_info.value.limit == 500
    assert exc_info.value.plan_key == "monthly"


def test_assert_can_create_branch_from_snapshot_rejects_full_plan() -> None:
    tenant = make_tenant()
    snapshot = build_tenant_usage_snapshot(tenant, active_clients=120, active_branches=3)

    with pytest.raises(PlanLimitReachedError, match="sucursales activas") as exc_info:
        assert_can_create_branch_from_snapshot(snapshot)

    assert exc_info.value.resource == "branches"
    assert exc_info.value.current_usage == 3
    assert exc_info.value.limit == 3
    assert exc_info.value.plan_key == "monthly"
