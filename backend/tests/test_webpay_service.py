from __future__ import annotations

from typing import Any

import pytest

from app.integrations.payments.webpay_service import WebpayCredentials, WebpayService, settings
from app.services.webpay_checkout_service import generate_webpay_buy_order


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
        DummyAsyncClient.last_request = {"method": "post", "url": url, "headers": headers, "json": json}
        return DummyResponse(
            200,
            {
                "token": "token_test_123",
                "url": "https://webpay3gint.transbank.cl/webpayserver/initTransaction",
            },
        )

    async def put(self, url: str, headers: dict[str, str]) -> DummyResponse:
        DummyAsyncClient.last_request = {"method": "put", "url": url, "headers": headers}
        return DummyResponse(
            200,
            {
                "buy_order": "buyorder123",
                "session_id": "session123",
                "amount": 34990,
                "status": "AUTHORIZED",
                "response_code": 0,
                "authorization_code": "1213",
            },
        )


@pytest.mark.asyncio
async def test_create_transaction_calls_webpay_rest_api(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.payments.webpay_service.httpx.AsyncClient", DummyAsyncClient)

    service = WebpayService()
    credentials = WebpayCredentials(
        commerce_code="597055555532",
        api_key="secret_key_test",
        environment="integration",
    )
    result = await service.create_transaction(
        buy_order="nexo123",
        session_id="sess123",
        amount=34990,
        return_url="https://merchant.test/api/v1/public/webpay/return?transaction_id=123",
        credentials=credentials,
    )

    assert DummyAsyncClient.last_request is not None
    assert DummyAsyncClient.last_request["url"] == "https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions"
    assert DummyAsyncClient.last_request["headers"]["Tbk-Api-Key-Id"] == "597055555532"
    assert DummyAsyncClient.last_request["json"]["buy_order"] == "nexo123"
    assert result["token"] == "token_test_123"


@pytest.mark.asyncio
async def test_commit_transaction_calls_webpay_commit_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.payments.webpay_service.httpx.AsyncClient", DummyAsyncClient)

    service = WebpayService()
    credentials = WebpayCredentials(
        commerce_code="597055555532",
        api_key="secret_key_test",
        environment="integration",
    )
    result = await service.commit_transaction(token="token_test_123", credentials=credentials)

    assert DummyAsyncClient.last_request is not None
    assert DummyAsyncClient.last_request["url"].endswith("/transactions/token_test_123")
    assert result["status"] == "AUTHORIZED"
    assert result["response_code"] == 0


def test_is_configured_returns_false_for_invalid_platform_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "WEBPAY_ENVIRONMENT", "sandbox")
    monkeypatch.setattr(settings, "WEBPAY_COMMERCE_CODE", "597055555532")
    monkeypatch.setattr(settings, "WEBPAY_API_KEY", "secret_key_test")

    service = WebpayService()

    assert service.is_configured() is False


def test_credentials_from_metadata_returns_none_for_invalid_environment() -> None:
    service = WebpayService()

    assert (
        service.credentials_from_metadata(
            {
                "environment": "sandbox",
                "commerce_code": "597055555532",
                "api_key": "secret_key_test",
            }
        )
        is None
    )


def test_generate_webpay_buy_order_respects_max_length_and_format() -> None:
    buy_order = generate_webpay_buy_order("saas_reactivation")

    assert len(buy_order) <= 26
    assert buy_order.isalnum()
