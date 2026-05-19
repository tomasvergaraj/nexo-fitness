"""Integration-style tests para endpoints livianos del dashboard.

Cubren edge case: tenant nuevo sin datos llama los endpoints desde el
sidebar al primer login → no debe crashear y debe retornar zeros / items
con done=False.

Patrón sin TestClient: invocación directa con FakeAsyncSession que retorna
resultados vacíos para cualquier query.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.api.v1.endpoints.dashboard import (
    get_onboarding_checklist,
    get_sidebar_counters,
)
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
    async def execute(self, _statement):
        return _EmptyResult()


def _make_tenant(**overrides) -> Tenant:
    tenant = Tenant(
        id=uuid4(),
        name="Gym Test",
        slug=f"gym-{uuid4().hex[:8]}",
        email="owner@gym.test",
        timezone="America/Santiago",
        currency="CLP",
        license_type=LicenseType.MONTHLY,
        status=TenantStatus.TRIAL,
        is_active=True,
        logo_url=None,
        primary_color="#06b6d4",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(tenant, key, value)
    return tenant


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


# ─── sidebar-counters ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sidebar_counters_empty_db_returns_zeros():
    tenant = _make_tenant()
    owner = _make_owner(tenant.id)
    ctx = TenantContext(tenant=tenant, user=owner)
    session = FakeAsyncSession()

    counters = await get_sidebar_counters(db=session, ctx=ctx)

    assert counters.classes_today == 0
    assert counters.clients_expiring_soon == 0
    assert counters.marketing_scheduled == 0


# ─── onboarding-checklist ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_onboarding_checklist_fresh_tenant_all_pending():
    """Tenant TRIAL sin logo ni datos → todos los items pendientes."""
    tenant = _make_tenant(status=TenantStatus.TRIAL, logo_url=None)
    owner = _make_owner(tenant.id)
    ctx = TenantContext(tenant=tenant, user=owner)
    session = FakeAsyncSession()

    checklist = await get_onboarding_checklist(db=session, ctx=ctx)

    assert checklist.total == 6
    assert checklist.completed_count == 0
    assert checklist.all_done is False
    keys = {item.key for item in checklist.items}
    assert keys == {"branch", "plan", "class", "client", "branding", "subscription"}
    assert all(item.done is False for item in checklist.items)


@pytest.mark.asyncio
async def test_onboarding_checklist_active_tenant_with_logo_marks_two_done():
    """Tenant ACTIVE con logo → subscription + branding completados."""
    tenant = _make_tenant(
        status=TenantStatus.ACTIVE,
        logo_url="https://cdn.example/logo.png",
    )
    owner = _make_owner(tenant.id)
    ctx = TenantContext(tenant=tenant, user=owner)
    session = FakeAsyncSession()

    checklist = await get_onboarding_checklist(db=session, ctx=ctx)

    done = {item.key for item in checklist.items if item.done}
    assert done == {"branding", "subscription"}
    assert checklist.completed_count == 2
    assert checklist.all_done is False


@pytest.mark.asyncio
async def test_onboarding_checklist_items_have_action_urls():
    tenant = _make_tenant()
    owner = _make_owner(tenant.id)
    ctx = TenantContext(tenant=tenant, user=owner)
    session = FakeAsyncSession()

    checklist = await get_onboarding_checklist(db=session, ctx=ctx)

    for item in checklist.items:
        assert item.action_url.startswith("/")
        assert item.label
        assert item.description
