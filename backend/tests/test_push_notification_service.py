from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app.models.business import Campaign, CampaignChannel, CampaignStatus, Notification
from app.models.platform import PushSubscription
from app.models.user import UserRole
from app.services import push_notification_service
from app.services.push_notification_service import (
    _resolve_webpush_target_url,
    record_notification_engagement,
    send_notification_via_expo,
    send_notification_via_push,
)


def make_notification(**overrides) -> Notification:
    notification = Notification(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=uuid4(),
        title="Recordatorio de clase",
        message="Toca para abrir tu clase en la app.",
        type="info",
        is_read=False,
        action_url="nexofitness://agenda/class/123",
        created_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(notification, key, value)
    return notification


def make_campaign(**overrides) -> Campaign:
    campaign = Campaign(
        id=uuid4(),
        tenant_id=uuid4(),
        name="Push campaign",
        subject="Entrena hoy",
        content="Toca para volver a la app.",
        channel=CampaignChannel.EMAIL,
        status=CampaignStatus.SENT,
        notification_type="info",
        action_url="nexofitness://account/profile",
        send_push=True,
        total_recipients=1,
        total_sent=1,
        total_opened=0,
        total_clicked=0,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(campaign, key, value)
    return campaign


class DummyScalarResult:
    def __init__(self, value: int) -> None:
        self.value = value

    def scalar_one(self) -> int:
        return self.value


class DummyEngagementSession:
    def __init__(self, campaign: Campaign | None, totals: list[int]) -> None:
        self.campaign = campaign
        self.totals = totals
        self.flush_calls = 0
        self.refreshed_objects: list[object] = []

    async def get(self, model, identifier):
        if model is Campaign and self.campaign and identifier == self.campaign.id:
            return self.campaign
        return None

    async def execute(self, _statement):
        return DummyScalarResult(self.totals.pop(0))

    async def flush(self) -> None:
        self.flush_calls += 1

    async def refresh(self, obj) -> None:
        self.refreshed_objects.append(obj)


def make_subscription(token: str, **overrides) -> PushSubscription:
    subscription = PushSubscription(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=uuid4(),
        provider="expo",
        device_type="mobile",
        device_name="Pixel 8",
        expo_push_token=token,
        is_active=True,
        last_seen_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(subscription, key, value)
    return subscription


def test_resolve_webpush_target_url_maps_client_actions_to_member_routes() -> None:
    assert _resolve_webpush_target_url("nexofitness://payments", UserRole.CLIENT) == "/member?tab=payments"
    assert _resolve_webpush_target_url("?tab=agenda&class=123", UserRole.CLIENT) == "/member?tab=agenda&class=123"
    assert _resolve_webpush_target_url(None, UserRole.CLIENT) == "/member?tab=notifications"


def test_resolve_webpush_target_url_maps_owner_actions_to_panel_routes() -> None:
    assert _resolve_webpush_target_url("nexofitness://account/profile", UserRole.OWNER) == "/settings"
    assert _resolve_webpush_target_url("?tab=plans", UserRole.OWNER) == "/plans"
    assert _resolve_webpush_target_url("nexofitness://agenda/class/123", UserRole.OWNER) == "/classes"
    assert _resolve_webpush_target_url(None, UserRole.OWNER) == "/dashboard"


@pytest.mark.asyncio
async def test_send_notification_via_expo_skips_invalid_tokens_and_sends_valid_ones() -> None:
    requests: list[httpx.Request] = []
    notification = make_notification()
    invalid_subscription = make_subscription("not-an-expo-token")
    valid_subscription = make_subscription("ExpoPushToken[device-123]")

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        payload = request.read()

        assert request.url == httpx.URL("https://exp.host/--/api/v2/push/send")
        assert b"ExpoPushToken[device-123]" in payload
        assert b"nexofitness://agenda/class/123" in payload
        assert str(notification.id).encode() in payload

        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "status": "ok",
                        "id": "ticket-123",
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deliveries = await send_notification_via_expo(
            notification,
            [invalid_subscription, valid_subscription],
            http_client=client,
        )

    assert len(requests) == 1
    invalid_delivery = next(item for item in deliveries if item.subscription_id == invalid_subscription.id)
    valid_delivery = next(item for item in deliveries if item.subscription_id == valid_subscription.id)

    assert invalid_delivery.status == "error"
    assert invalid_delivery.error == "InvalidExpoPushToken"
    assert valid_delivery.status == "ok"
    assert valid_delivery.ticket_id == "ticket-123"
    assert valid_delivery.receipt_status == "pending"


@pytest.mark.asyncio
async def test_send_notification_via_expo_marks_subscription_inactive_when_device_not_registered() -> None:
    notification = make_notification()
    subscription = make_subscription("ExpoPushToken[device-456]")

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "status": "error",
                        "message": "Device no longer registered",
                        "details": {
                            "error": "DeviceNotRegistered",
                        },
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deliveries = await send_notification_via_expo(notification, [subscription], http_client=client)

    assert len(deliveries) == 1
    assert deliveries[0].status == "error"
    assert deliveries[0].error == "DeviceNotRegistered"
    assert deliveries[0].is_active is False
    assert subscription.is_active is False


@pytest.mark.asyncio
async def test_send_notification_via_expo_surfaces_transport_errors_per_subscription() -> None:
    notification = make_notification()
    subscription = make_subscription("ExpoPushToken[device-789]")

    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("Expo timeout")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deliveries = await send_notification_via_expo(notification, [subscription], http_client=client)

    assert len(deliveries) == 1
    assert deliveries[0].status == "error"
    assert deliveries[0].error == "ExpoRequestError"
    assert "Expo timeout" in (deliveries[0].message or "")


@pytest.mark.asyncio
async def test_send_notification_via_push_reports_missing_webpush_library(monkeypatch) -> None:
    notification = make_notification()
    subscription = make_subscription(
        "",
        provider="webpush",
        device_type="pwa",
        device_name="Chrome PWA",
        web_endpoint="https://push.example.test/subscription/123",
        web_p256dh_key="p256dh-key",
        web_auth_key="auth-key",
    )

    monkeypatch.setattr(push_notification_service, "webpush", None)

    deliveries = await send_notification_via_push(notification, [subscription])

    assert len(deliveries) == 1
    assert deliveries[0].provider == "webpush"
    assert deliveries[0].status == "error"
    assert deliveries[0].error == "WebPushLibraryMissing"


@pytest.mark.asyncio
async def test_send_notification_via_push_retries_webpush_after_curve_compat_patch(monkeypatch) -> None:
    notification = make_notification()
    subscription = make_subscription(
        "",
        provider="webpush",
        device_type="pwa",
        device_name="Chrome PWA",
        web_endpoint="https://push.example.test/subscription/123",
        web_p256dh_key="p256dh-key",
        web_auth_key="auth-key",
    )
    attempts = {"count": 0}

    def fake_webpush(**_kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise TypeError("curve must be an EllipticCurve instance")
        return SimpleNamespace(status_code=201)

    monkeypatch.setattr(push_notification_service, "webpush", fake_webpush)
    monkeypatch.setattr(push_notification_service, "_patch_pywebpush_curve_compatibility", lambda: True)

    deliveries = await send_notification_via_push(notification, [subscription])

    assert attempts["count"] == 2
    assert len(deliveries) == 1
    assert deliveries[0].provider == "webpush"
    assert deliveries[0].status == "ok"
    assert deliveries[0].error is None


@pytest.mark.asyncio
async def test_record_notification_engagement_marks_open_and_click_and_refreshes_campaign_totals() -> None:
    campaign = make_campaign()
    notification = make_notification(campaign_id=campaign.id, tenant_id=campaign.tenant_id)
    db = DummyEngagementSession(campaign, totals=[1, 1])

    updated = await record_notification_engagement(
        db,
        notification=notification,
        mark_clicked=True,
    )

    assert updated.is_read is True
    assert updated.opened_at is not None
    assert updated.clicked_at is not None
    assert campaign.total_opened == 1
    assert campaign.total_clicked == 1
    assert db.flush_calls == 1
    assert db.refreshed_objects == [notification]
