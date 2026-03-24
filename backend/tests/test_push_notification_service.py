from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest

from app.models.business import Notification
from app.models.platform import PushSubscription
from app.services.push_notification_service import send_notification_via_expo


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


def make_subscription(token: str, **overrides) -> PushSubscription:
    subscription = PushSubscription(
        id=uuid4(),
        tenant_id=uuid4(),
        user_id=uuid4(),
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
