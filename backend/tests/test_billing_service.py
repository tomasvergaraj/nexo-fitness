from datetime import datetime, timedelta, timezone

from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.services.billing_service import (
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
