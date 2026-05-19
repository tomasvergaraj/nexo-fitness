"""Tests para resolve_bulk_reassign_classes — validaciones de input.

Cubre los 3 caminos de error del helper antes de tocar lógica de fechas o
queries de GymClass. Sin TestClient: invocación directa.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.dependencies import TenantContext
from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.models.user import User, UserRole
from app.schemas.business import BulkReassignInstructorRequest
from app.services.class_bulk_service import resolve_bulk_reassign_classes


class _EmptyScalarSequence:
    def all(self):
        return []


class _Result:
    def __init__(self, scalar_value=None, items=None):
        self._scalar = scalar_value
        self._items = items or []

    def scalars(self):
        return _EmptyScalarSequence()

    def scalar(self):
        return self._scalar

    def scalar_one_or_none(self):
        return self._scalar

    def all(self):
        return list(self._items)


class FakeSession:
    """Session que devuelve un User configurable para el lookup de target,
    y vacío para el resto."""

    def __init__(self, target_user: User | None = None):
        self._target = target_user
        self._call_count = 0

    async def execute(self, _statement):
        self._call_count += 1
        # Primera execute: lookup del target instructor
        if self._call_count == 1:
            return _Result(scalar_value=self._target)
        # Resto: empty
        return _Result(items=[])


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


def _make_user(tenant_id, role: UserRole = UserRole.TRAINER, *, is_active=True) -> User:
    return User(
        id=uuid4(),
        tenant_id=tenant_id,
        email=f"trainer-{uuid4().hex[:6]}@gym.test",
        first_name="Trainer",
        last_name="X",
        role=role,
        is_active=is_active,
        is_verified=True,
        is_superadmin=False,
        created_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_reassign_rejects_same_instructor_origin_and_target():
    tenant = _make_tenant()
    owner = _make_user(tenant.id, role=UserRole.OWNER)
    ctx = TenantContext(tenant=tenant, user=owner)
    same_id = uuid4()

    req = BulkReassignInstructorRequest(
        from_instructor_id=same_id,
        to_instructor_id=same_id,
    )

    with pytest.raises(HTTPException) as exc:
        await resolve_bulk_reassign_classes(FakeSession(), ctx, req)

    assert exc.value.status_code == 400
    assert "distintos" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_reassign_returns_404_when_target_not_found():
    tenant = _make_tenant()
    owner = _make_user(tenant.id, role=UserRole.OWNER)
    ctx = TenantContext(tenant=tenant, user=owner)

    req = BulkReassignInstructorRequest(
        from_instructor_id=uuid4(),
        to_instructor_id=uuid4(),
    )

    with pytest.raises(HTTPException) as exc:
        # FakeSession con target_user=None → scalar_one_or_none() devuelve None
        await resolve_bulk_reassign_classes(FakeSession(target_user=None), ctx, req)

    assert exc.value.status_code == 404
    assert "instructor destino" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_reassign_rejects_inverted_date_range():
    tenant = _make_tenant()
    owner = _make_user(tenant.id, role=UserRole.OWNER)
    target = _make_user(tenant.id, role=UserRole.TRAINER)
    ctx = TenantContext(tenant=tenant, user=owner)

    req = BulkReassignInstructorRequest(
        from_instructor_id=uuid4(),
        to_instructor_id=target.id,
        date_from=date(2026, 6, 30),
        date_to=date(2026, 6, 1),
    )

    with pytest.raises(HTTPException) as exc:
        await resolve_bulk_reassign_classes(FakeSession(target_user=target), ctx, req)

    assert exc.value.status_code == 400
    assert "date_to" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_reassign_returns_empty_when_no_matching_classes():
    """Target válido + DB sin clases del from_instructor → tuple ([], target)."""
    tenant = _make_tenant()
    owner = _make_user(tenant.id, role=UserRole.OWNER)
    target = _make_user(tenant.id, role=UserRole.TRAINER)
    ctx = TenantContext(tenant=tenant, user=owner)

    req = BulkReassignInstructorRequest(
        from_instructor_id=uuid4(),
        to_instructor_id=target.id,
    )

    classes, returned_target = await resolve_bulk_reassign_classes(
        FakeSession(target_user=target), ctx, req
    )

    assert classes == []
    assert returned_target.id == target.id
