"""Integration-style test for /retention/dashboard endpoint con DB vacía.

No usa TestClient — invoca el endpoint directamente con FakeAsyncSession y
TenantContext mockeado. Verifica la forma de la respuesta y que el endpoint
no crashea cuando no hay membresías, check-ins ni clientes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.api.v1.endpoints.retention import get_retention_dashboard
from app.core.dependencies import TenantContext
from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.models.user import User, UserRole


class _EmptyScalarSequence:
    def all(self):
        return []


class _EmptyResult:
    def scalars(self):
        return _EmptyScalarSequence()

    def scalar(self):
        return 0

    def all(self):
        return []


class FakeAsyncSession:
    """Mínimo viable: cualquier execute() devuelve resultados vacíos / count=0."""

    async def execute(self, _statement):
        return _EmptyResult()


def _make_tenant() -> Tenant:
    return Tenant(
        id=uuid4(),
        name="Gym Test",
        slug=f"gym-{uuid4().hex[:8]}",
        email="owner@gym.test",
        timezone="America/Santiago",
        currency="CLP",
        license_type=LicenseType.MONTHLY,
        status=TenantStatus.ACTIVE,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def _make_owner(tenant_id) -> User:
    return User(
        id=uuid4(),
        tenant_id=tenant_id,
        email="owner@gym.test",
        first_name="Owner",
        last_name="Test",
        role=UserRole.OWNER,
        is_active=True,
        is_verified=True,
        is_superadmin=False,
        created_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_retention_dashboard_empty_db_returns_zeros_without_crash():
    tenant = _make_tenant()
    owner = _make_owner(tenant.id)
    ctx = TenantContext(tenant=tenant, user=owner)
    session = FakeAsyncSession()

    response = await get_retention_dashboard(months=6, db=session, ctx=ctx)

    assert response.months_window == 6
    assert response.at_risk.total_active_clients == 0
    assert response.at_risk.high == 0
    assert response.at_risk.medium == 0
    assert response.at_risk.low == 0
    assert response.avg_lifetime_days is None
    assert len(response.churn_monthly) == 6
    assert all(month.churn_pct == 0.0 for month in response.churn_monthly)
    assert all(month.cancelled == 0 for month in response.churn_monthly)
    assert len(response.cohort_matrix) == 6
    assert all(row.cohort_size == 0 for row in response.cohort_matrix)


@pytest.mark.asyncio
async def test_retention_dashboard_clamps_months_window():
    """months <1 → 1, months >12 → 12."""
    tenant = _make_tenant()
    owner = _make_owner(tenant.id)
    ctx = TenantContext(tenant=tenant, user=owner)
    session = FakeAsyncSession()

    too_low = await get_retention_dashboard(months=0, db=session, ctx=ctx)
    assert too_low.months_window == 1

    too_high = await get_retention_dashboard(months=99, db=session, ctx=ctx)
    assert too_high.months_window == 12
