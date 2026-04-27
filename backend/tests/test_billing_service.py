from datetime import datetime, timedelta, timezone

import pytest

from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.models.user import User, UserRole
from app.services.billing_service import (
    BillingService,
    activate_tenant_subscription,
    evaluate_tenant_access,
    get_effective_plan_for_tenant,
    get_public_saas_plans,
    set_tenant_feature_flags,
)
from app.services.saas_plan_service import plan_to_feature_flags


def make_tenant(**overrides) -> Tenant:
    tenant = Tenant(
        name="Nexo SaaS",
        slug="nexo-saas",
        email="owner@nexo.cl",
        currency="CLP",
        timezone="America/Santiago",
        license_type=LicenseType.MONTHLY,
        status=TenantStatus.TRIAL,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(tenant, key, value)
    return tenant


def make_owner(email: str, first_name: str = "Nora", last_name: str = "Owner") -> User:
    return User(
        email=email,
        hashed_password="hashed",
        first_name=first_name,
        last_name=last_name,
        role=UserRole.OWNER,
        is_active=True,
        is_verified=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


class FakeScalarSequence:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class FakeResult:
    def __init__(self, *, items=None, scalar_value=None):
        self._items = list(items or [])
        self._scalar_value = scalar_value

    def scalars(self):
        return FakeScalarSequence(self._items)

    def scalar(self):
        return self._scalar_value


class FakeBillingSession:
    def __init__(self, tenants: list[Tenant]):
        self.tenants = list(tenants)

    async def execute(self, statement):
        sql = str(statement)
        params = statement.compile().params
        items = list(self.tenants)
        search_like = next((value for value in params.values() if isinstance(value, str) and "%" in value), None)
        if search_like:
            term = search_like.strip("%").lower()
            items = [
                tenant
                for tenant in items
                if term in " ".join(
                    part
                    for part in [
                        tenant.name,
                        tenant.slug,
                        tenant.email,
                        *(user.full_name for user in getattr(tenant, "users", []) if user.role == UserRole.OWNER),
                        *(user.email for user in getattr(tenant, "users", []) if user.role == UserRole.OWNER),
                    ]
                    if part
                ).lower()
            ]

        if "count(" in sql.lower():
            return FakeResult(scalar_value=len(items))

        items.sort(key=lambda tenant: tenant.created_at, reverse=True)
        return FakeResult(items=items)


def test_public_saas_plans_include_all_public_catalog_plans() -> None:
    plans = get_public_saas_plans()
    plan_keys = {plan.key for plan in plans}

    assert plan_keys == {"monthly", "quarterly", "semi_annual", "annual"}
    assert all(plan.trial_days >= 0 for plan in plans)


def test_evaluate_tenant_access_flags_expired_trial() -> None:
    tenant = make_tenant(
        status=TenantStatus.TRIAL,
        trial_ends_at=datetime.now(timezone.utc) - timedelta(days=1),
    )

    access_state = evaluate_tenant_access(tenant)

    assert not access_state.allow_access
    assert access_state.status_to_apply == TenantStatus.EXPIRED
    assert access_state.deactivate is True


def test_activate_tenant_subscription_sets_expiration_and_limits() -> None:
    tenant = make_tenant()
    plan = next(plan for plan in get_public_saas_plans() if plan.key == "annual")

    activate_tenant_subscription(tenant, plan, now=datetime(2026, 1, 1, tzinfo=timezone.utc))

    assert tenant.status == TenantStatus.ACTIVE
    assert tenant.is_active is True
    assert tenant.license_type == LicenseType.ANNUAL
    assert tenant.trial_ends_at is None
    assert tenant.license_expires_at == datetime(2027, 1, 1, tzinfo=timezone.utc)
    assert tenant.max_members == plan.max_members
    assert tenant.max_branches == plan.max_branches


@pytest.mark.parametrize(
    ("plan_key", "license_type", "expected_expiration"),
    [
        ("monthly", LicenseType.MONTHLY, datetime(2026, 1, 31, tzinfo=timezone.utc)),
        ("quarterly", LicenseType.QUARTERLY, datetime(2026, 4, 1, tzinfo=timezone.utc)),
        ("semi_annual", LicenseType.SEMI_ANNUAL, datetime(2026, 6, 30, tzinfo=timezone.utc)),
        ("annual", LicenseType.ANNUAL, datetime(2026, 12, 31, tzinfo=timezone.utc)),
    ],
)
def test_activate_tenant_subscription_uses_starts_at_for_expiration(
    plan_key: str,
    license_type: LicenseType,
    expected_expiration: datetime,
) -> None:
    tenant = make_tenant(status=TenantStatus.EXPIRED, is_active=False, trial_ends_at=None)
    plan = next(plan for plan in get_public_saas_plans() if plan.key == plan_key)

    activate_tenant_subscription(
        tenant,
        plan,
        starts_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )

    assert tenant.status == TenantStatus.ACTIVE
    assert tenant.is_active is True
    assert tenant.license_type == license_type
    assert tenant.license_expires_at == expected_expiration


def test_plan_feature_flags_store_snapshot_fields() -> None:
    plan = next(plan for plan in get_public_saas_plans() if plan.key == "monthly")

    flags = plan_to_feature_flags(plan)

    assert flags["saas_plan_key"] == plan.key
    assert flags["saas_plan_name"] == plan.name
    assert flags["max_members"] == plan.max_members
    assert flags["max_branches"] == plan.max_branches


def test_manual_tenant_plan_falls_back_without_checkout() -> None:
    tenant = make_tenant(license_type=LicenseType.PERPETUAL, status=TenantStatus.ACTIVE)
    set_tenant_feature_flags(tenant, {"saas_features": ["Sucursal unica", "Soporte manual"]})

    plan = get_effective_plan_for_tenant(tenant)

    assert plan.key == "perpetual"
    assert plan.checkout_enabled is False
    assert "Soporte manual" in plan.features


@pytest.mark.asyncio
async def test_list_tenants_for_admin_filters_by_search(monkeypatch: pytest.MonkeyPatch) -> None:
    north = make_tenant(name="Gym Norte", slug="gym-norte", email="norte@gym.test")
    north.users = [make_owner("owner-norte@gym.test", first_name="Nora", last_name="North")]
    south = make_tenant(name="Gym Sur", slug="gym-sur", email="sur@gym.test")
    south.users = [make_owner("owner-sur@gym.test", first_name="Santiago", last_name="South")]
    session = FakeBillingSession([north, south])

    async def fake_describe(_db, tenant: Tenant):
        owner = tenant.users[0]
        return {
            "tenant_id": tenant.id,
            "tenant_name": tenant.name,
            "tenant_slug": tenant.slug,
            "status": tenant.status.value,
            "license_type": tenant.license_type.value,
            "plan_key": "monthly",
            "plan_name": "Mensual",
            "currency": tenant.currency,
            "trial_ends_at": tenant.trial_ends_at,
            "license_expires_at": tenant.license_expires_at,
            "stripe_customer_id": None,
            "stripe_subscription_id": None,
            "checkout_enabled": True,
            "is_active": tenant.is_active,
            "max_members": tenant.max_members,
            "max_branches": tenant.max_branches,
            "usage_active_clients": 0,
            "usage_active_branches": 0,
            "remaining_client_slots": 0,
            "remaining_branch_slots": 0,
            "over_client_limit": False,
            "over_branch_limit": False,
            "features": [],
            "owner_email": owner.email,
            "owner_name": owner.full_name,
            "owner_user_id": None,
            "created_at": tenant.created_at,
        }

    monkeypatch.setattr(BillingService, "describe_tenant_billing", staticmethod(fake_describe))

    result = await BillingService.list_tenants_for_admin(session, page=1, per_page=20, search="nora")

    assert result["total"] == 1
    assert result["items"][0]["tenant_name"] == "Gym Norte"
