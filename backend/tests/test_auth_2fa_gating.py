"""Tests for AuthService._requires_2fa decision logic."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from app.models.tenant import Tenant, TenantStatus
from app.models.user import User, UserRole
from app.services.auth_service import AuthService


def make_user(**overrides) -> User:
    defaults = dict(
        id=uuid4(),
        tenant_id=uuid4(),
        email="staff@gym.cl",
        hashed_password="$2b$12$placeholder",
        first_name="Ana",
        last_name="Pérez",
        role=UserRole.OWNER,
        is_active=True,
        is_verified=True,
        is_superadmin=False,
        two_factor_enabled=False,
        two_factor_secret=None,
        two_factor_verified_at=None,
        backup_codes=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return User(**defaults)


def make_tenant(*, two_factor_required: bool = False) -> Tenant:
    return Tenant(
        id=uuid4(),
        name="Mi Gimnasio",
        slug="mi-gym",
        email="contact@mi-gym.cl",
        status=TenantStatus.ACTIVE,
        is_active=True,
        features=json.dumps({"two_factor_required": two_factor_required}) if two_factor_required else None,
    )


def test_no_2fa_when_user_disabled_and_tenant_not_required() -> None:
    user = make_user(two_factor_enabled=False)
    tenant = make_tenant(two_factor_required=False)
    requires_verify, requires_setup = AuthService._requires_2fa(user, tenant)
    assert requires_verify is False
    assert requires_setup is False


def test_verify_required_when_user_has_2fa_enabled() -> None:
    user = make_user(two_factor_enabled=True)
    tenant = make_tenant(two_factor_required=False)
    requires_verify, requires_setup = AuthService._requires_2fa(user, tenant)
    assert requires_verify is True
    assert requires_setup is False


def test_setup_forced_for_staff_when_tenant_requires() -> None:
    for role in (UserRole.OWNER, UserRole.ADMIN, UserRole.RECEPTION, UserRole.TRAINER, UserRole.MARKETING):
        user = make_user(role=role, two_factor_enabled=False)
        tenant = make_tenant(two_factor_required=True)
        requires_verify, requires_setup = AuthService._requires_2fa(user, tenant)
        assert requires_verify is False, f"role={role}"
        assert requires_setup is True, f"role={role}"


def test_setup_NOT_forced_for_clients() -> None:
    user = make_user(role=UserRole.CLIENT, two_factor_enabled=False)
    tenant = make_tenant(two_factor_required=True)
    requires_verify, requires_setup = AuthService._requires_2fa(user, tenant)
    assert requires_verify is False
    assert requires_setup is False


def test_user_2fa_takes_precedence_over_setup_flag() -> None:
    """If user already has 2FA enabled, even with tenant flag they go to verify, not setup."""
    user = make_user(role=UserRole.ADMIN, two_factor_enabled=True)
    tenant = make_tenant(two_factor_required=True)
    requires_verify, requires_setup = AuthService._requires_2fa(user, tenant)
    assert requires_verify is True
    assert requires_setup is False


def test_superadmin_without_2fa_skips_gating() -> None:
    user = make_user(is_superadmin=True, two_factor_enabled=False)
    requires_verify, requires_setup = AuthService._requires_2fa(user, None)
    assert requires_verify is False
    assert requires_setup is False


def test_superadmin_with_2fa_still_requires_verify() -> None:
    user = make_user(is_superadmin=True, two_factor_enabled=True)
    requires_verify, requires_setup = AuthService._requires_2fa(user, None)
    assert requires_verify is True
    assert requires_setup is False


def test_no_tenant_means_no_setup_force() -> None:
    user = make_user(role=UserRole.ADMIN, two_factor_enabled=False, tenant_id=None)
    requires_verify, requires_setup = AuthService._requires_2fa(user, None)
    assert requires_verify is False
    assert requires_setup is False


def test_tenant_features_malformed_falls_back_safely() -> None:
    user = make_user(role=UserRole.ADMIN, two_factor_enabled=False)
    tenant = Tenant(
        id=uuid4(), name="Gym", slug="gym", email="x@y.cl",
        status=TenantStatus.ACTIVE, is_active=True,
        features="{not valid json",
    )
    requires_verify, requires_setup = AuthService._requires_2fa(user, tenant)
    assert requires_verify is False
    assert requires_setup is False
