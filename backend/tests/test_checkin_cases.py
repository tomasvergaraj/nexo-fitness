from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.api.v1.endpoints.classes import _detect_qr_frequency_case, _tenant_local_day_bounds
from app.models.business import CheckIn, CheckInInvestigationCase
from app.models.tenant import LicenseType, Tenant, TenantStatus


class DummyResult:
    def __init__(self, value):  # noqa: ANN001
        self.value = value

    def scalar(self):  # noqa: ANN201
        return self.value

    def scalar_one_or_none(self):  # noqa: ANN201
        return self.value


class DummyDb:
    def __init__(self, *results):  # noqa: ANN002
        self.results = list(results)
        self.added: list[object] = []
        self.flush_called = False

    async def execute(self, query):  # noqa: ANN001
        return DummyResult(self.results.pop(0))

    def add(self, obj):  # noqa: ANN001
        self.added.append(obj)

    async def flush(self) -> None:
        self.flush_called = True


def make_tenant(**overrides) -> Tenant:
    tenant = Tenant(
        id=uuid4(),
        name="Nexo Gym",
        slug="nexo-gym",
        email="owner@nexogym.cl",
        currency="CLP",
        timezone="America/Santiago",
        license_type=LicenseType.MONTHLY,
        status=TenantStatus.ACTIVE,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(tenant, key, value)
    return tenant


def make_checkin(tenant_id, user_id, **overrides) -> CheckIn:  # noqa: ANN001
    checkin = CheckIn(
        id=uuid4(),
        tenant_id=tenant_id,
        user_id=user_id,
        check_type="qr",
        checked_in_at=datetime(2026, 4, 22, 14, 30, tzinfo=timezone.utc),
    )
    for key, value in overrides.items():
        setattr(checkin, key, value)
    return checkin


@pytest.mark.asyncio
async def test_detect_qr_frequency_case_creates_case_when_daily_threshold_is_met() -> None:
    tenant = make_tenant()
    user_id = uuid4()
    checkin = make_checkin(tenant.id, user_id)
    db = DummyDb(5, 2, None)
    ctx = SimpleNamespace(tenant=tenant, tenant_id=tenant.id)

    case = await _detect_qr_frequency_case(db, ctx, checkin)

    assert case is not None
    assert case.user_id == user_id
    assert case.status == "open"
    assert case.daily_qr_count == 5
    assert case.window_qr_count == 2
    assert case.local_day.isoformat() == "2026-04-22"
    assert db.added == [case]
    assert db.flush_called is True


@pytest.mark.asyncio
async def test_detect_qr_frequency_case_returns_none_below_thresholds() -> None:
    tenant = make_tenant()
    checkin = make_checkin(tenant.id, uuid4())
    db = DummyDb(4, 2)
    ctx = SimpleNamespace(tenant=tenant, tenant_id=tenant.id)

    case = await _detect_qr_frequency_case(db, ctx, checkin)

    assert case is None
    assert db.added == []
    assert db.flush_called is False


@pytest.mark.asyncio
async def test_detect_qr_frequency_case_reopens_dismissed_case() -> None:
    tenant = make_tenant()
    user_id = uuid4()
    checkin = make_checkin(tenant.id, user_id)
    existing_case = CheckInInvestigationCase(
        id=uuid4(),
        tenant_id=tenant.id,
        user_id=user_id,
        trigger_checkin_id=uuid4(),
        status="dismissed",
        rule_code="qr_frequency",
        local_day=checkin.checked_in_at.date(),
        first_triggered_at=datetime(2026, 4, 22, 13, 0, tzinfo=timezone.utc),
        last_triggered_at=datetime(2026, 4, 22, 13, 0, tzinfo=timezone.utc),
        daily_qr_count=5,
        window_qr_count=3,
        review_notes="Descartado inicialmente",
        reviewed_by=uuid4(),
        reviewed_at=datetime(2026, 4, 22, 13, 10, tzinfo=timezone.utc),
    )
    db = DummyDb(6, 3, existing_case)
    ctx = SimpleNamespace(tenant=tenant, tenant_id=tenant.id)

    case = await _detect_qr_frequency_case(db, ctx, checkin)

    assert case is existing_case
    assert case.status == "open"
    assert case.daily_qr_count == 6
    assert case.window_qr_count == 3
    assert case.reviewed_by is None
    assert case.reviewed_at is None
    assert db.flush_called is True


def test_tenant_local_day_bounds_returns_utc_boundaries() -> None:
    zone_bounds = _tenant_local_day_bounds(datetime(2026, 4, 22, tzinfo=timezone.utc).date(), ZoneInfo("America/Santiago"))
    assert zone_bounds[0].tzinfo == timezone.utc
    assert zone_bounds[1].tzinfo == timezone.utc
