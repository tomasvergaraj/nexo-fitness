from __future__ import annotations

import hmac
import json
import time
from typing import Any

import pytest

from app.integrations.payments.fintoc_service import FintocService


class DummyResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


class DummyAsyncClient:
    last_request: dict[str, Any] | None = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> "DummyAsyncClient":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        return None

    async def post(self, url: str, headers: dict[str, str], json: dict[str, Any]) -> DummyResponse:
        DummyAsyncClient.last_request = {
            "url": url,
            "headers": headers,
            "json": json,
        }
        return DummyResponse(
            201,
            {
                "id": "cs_test_123",
                "status": "created",
                "redirect_url": "https://checkout.fintoc.com/checkout_session_test_123",
                "session_token": None,
            },
        )


@pytest.mark.asyncio
async def test_create_checkout_session_uses_v2_redirect_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.payments.fintoc_service.httpx.AsyncClient", DummyAsyncClient)
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_SECRET_KEY", "sk_test_dummy")

    service = FintocService()
    result = await service.create_checkout_session(
        amount=34990,
        currency="CLP",
        customer_name="Jane Doe",
        customer_email="jane@example.com",
        success_url="https://merchant.example/success",
        cancel_url="https://merchant.example/cancel",
        metadata={"tenant_id": "tenant_123"},
    )

    assert DummyAsyncClient.last_request is not None
    assert DummyAsyncClient.last_request["url"] == "https://api.fintoc.com/v2/checkout_sessions"
    assert DummyAsyncClient.last_request["json"]["payment_method_types"] == ["bank_transfer"]
    assert DummyAsyncClient.last_request["json"]["success_url"] == "https://merchant.example/success"
    assert DummyAsyncClient.last_request["json"]["cancel_url"] == "https://merchant.example/cancel"
    assert DummyAsyncClient.last_request["json"]["customer"] == {
        "name": "Jane Doe",
        "email": "jane@example.com",
    }
    assert result["id"] == "cs_test_123"
    assert result["redirect_url"] == "https://checkout.fintoc.com/checkout_session_test_123"


def test_create_checkout_session_requires_https_return_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_SECRET_KEY", "sk_test_dummy")

    service = FintocService()

    with pytest.raises(ValueError, match="success_url HTTPS"):
        service._validate_return_url("http://localhost:3000/store/test?checkout=success", "success_url")


def test_verify_webhook_accepts_current_fintoc_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_test_dummy"
    timestamp = str(int(time.time()))
    payload_dict = {"type": "payment_intent.succeeded", "data": {"object": {"metadata": {"tenant_id": "tenant_123"}}}}
    payload = json.dumps(payload_dict, separators=(",", ":")).encode("utf-8")
    signed_payload = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), signed_payload, "sha256").hexdigest()

    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_WEBHOOK_SECRET", secret)

    service = FintocService()
    event = service.verify_webhook(payload, f"t={timestamp},v1={signature}")

    assert event["type"] == "payment_intent.succeeded"


def test_verify_webhook_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_WEBHOOK_SECRET", "whsec_test_dummy")

    service = FintocService()
    with pytest.raises(ValueError, match="signature invalida"):
        service.verify_webhook(
            b'{"type":"payment_intent.succeeded"}',
            f"t={int(time.time())},v1=invalid",
        )
