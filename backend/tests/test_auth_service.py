from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import hash_password, verify_password
from app.core.exceptions import ActionRequiredError
from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.models.user import User, UserRole
from app.services.auth_service import AuthService


class DummyDb:
    def __init__(self, tenant: Tenant | None) -> None:
        self.tenant = tenant
        self.flushed = False

    async def get(self, model, ident):  # noqa: ANN001
        return self.tenant

    async def flush(self) -> None:
        self.flushed = True


def make_tenant(**overrides) -> Tenant:
    tenant = Tenant(
        id=uuid.uuid4(),
        name="Nexo Gym",
        slug="nexogym",
        email="owner@nexogym.cl",
        currency="CLP",
        timezone="America/Santiago",
        license_type=LicenseType.MONTHLY,
        status=TenantStatus.TRIAL,
        is_active=True,
        trial_ends_at=datetime.now(timezone.utc) + timedelta(days=7),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(tenant, key, value)
    return tenant


def make_user(tenant_id) -> User:  # noqa: ANN001
    return User(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        email="owner@nexogym.cl",
        hashed_password="hashed",
        first_name="Owner",
        last_name="User",
        role=UserRole.OWNER,
        is_active=True,
        is_verified=True,
    )


@pytest.mark.asyncio
async def test_ensure_user_tenant_access_rejects_expired_trial() -> None:
    tenant = make_tenant(
        status=TenantStatus.TRIAL,
        trial_ends_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    user = make_user(tenant.id)
    db = DummyDb(tenant)

    with pytest.raises(ActionRequiredError, match="Tu período de prueba venció") as exc_info:
        await AuthService._ensure_user_tenant_access(db, user)

    assert exc_info.value.billing_status == TenantStatus.EXPIRED.value
    assert tenant.status == TenantStatus.EXPIRED
    assert tenant.is_active is False
    assert db.flushed is True


@pytest.mark.asyncio
async def test_ensure_user_tenant_access_allows_active_tenant() -> None:
    tenant = make_tenant(status=TenantStatus.ACTIVE, trial_ends_at=None)
    user = make_user(tenant.id)
    db = DummyDb(tenant)

    await AuthService._ensure_user_tenant_access(db, user)

    assert db.flushed is False


@pytest.mark.asyncio
async def test_change_password_updates_hash_and_rotates_refresh_token() -> None:
    db = DummyDb(None)
    user = User(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email="owner@nexogym.cl",
        hashed_password=hash_password("Actual123"),
        first_name="Owner",
        last_name="User",
        role=UserRole.OWNER,
        is_active=True,
        is_verified=True,
    )

    result = await AuthService.change_password(
        db,
        user,
        current_password="Actual123",
        new_password="NuevaClave123",
    )

    assert verify_password("NuevaClave123", user.hashed_password)
    assert user.password_changed_at is not None
    assert user.refresh_token == result["refresh_token"]
    assert result["access_token"]
    assert db.flushed is True


@pytest.mark.asyncio
async def test_change_password_rejects_incorrect_current_password() -> None:
    db = DummyDb(None)
    user = User(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email="owner@nexogym.cl",
        hashed_password=hash_password("Actual123"),
        first_name="Owner",
        last_name="User",
        role=UserRole.OWNER,
        is_active=True,
        is_verified=True,
    )

    with pytest.raises(ValueError, match="contraseña actual es incorrecta"):
        await AuthService.change_password(
            db,
            user,
            current_password="Incorrecta123",
            new_password="NuevaClave123",
        )

    assert verify_password("Actual123", user.hashed_password)
    assert db.flushed is False
