"""Tests for FintocService — covers collection-activated and non-collection flows."""

from __future__ import annotations

import hmac
import json
import time
from typing import Any

import pytest

from app.integrations.payments.fintoc_service import FintocService


# ── Helpers ──────────────────────────────────────────────────────────────────

class DummyResponse:
    def __init__(self, status_code: int, payload: dict[str, Any], text: str | None = None):
        self.status_code = status_code
        self._payload = payload
        self.text = text or json.dumps(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


class DummyAsyncClient:
    last_request: dict[str, Any] | None = None
    _response: DummyResponse | None = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> "DummyAsyncClient":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        return None

    async def post(self, url: str, headers: dict[str, str], json: dict[str, Any]) -> DummyResponse:
        DummyAsyncClient.last_request = {"url": url, "headers": headers, "json": json}
        return DummyAsyncClient._response or DummyResponse(
            201,
            {
                "id": "cs_test_123",
                "status": "created",
                "redirect_url": "https://checkout.fintoc.com/cs_test_123",
                "session_token": "tok_test_abc",
            },
        )

    @classmethod
    def respond_with(cls, status: int, payload: dict) -> None:
        cls._response = DummyResponse(status, payload)

    @classmethod
    def reset(cls) -> None:
        cls.last_request = None
        cls._response = None


VALID_URLS = {
    "success_url": "https://nexofitness.cl/store/gym?checkout=success",
    "cancel_url": "https://nexofitness.cl/store/gym?checkout=cancelled",
}


# ── collection activado: NO enviar recipient_account ─────────────────────────

@pytest.mark.asyncio
async def test_checkout_collection_activated_no_recipient_account(monkeypatch: pytest.MonkeyPatch) -> None:
    """Con collection activado: no se envía recipient_account, usa la key del tenant."""
    monkeypatch.setattr("app.integrations.payments.fintoc_service.httpx.AsyncClient", DummyAsyncClient)
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_SECRET_KEY", "sk_live_platform")
    DummyAsyncClient.reset()

    service = FintocService()
    result = await service.create_checkout_session(
        amount=34990,
        currency="CLP",
        customer_name="Ana García",
        customer_email="ana@gym.cl",
        success_url=VALID_URLS["success_url"],
        cancel_url=VALID_URLS["cancel_url"],
        metadata={"tenant_id": "tenant_abc", "plan_id": "plan_xyz"},
        recipient_account=None,
        secret_key="sk_live_tenant_key",
    )

    req = DummyAsyncClient.last_request
    assert req is not None
    # usa la key del tenant, no la de plataforma
    assert req["headers"]["Authorization"] == "sk_live_tenant_key"
    # collection activado: NO payment_method_types ni payment_method_options
    assert "payment_method_options" not in req["json"]
    assert "payment_method_types" not in req["json"]
    assert result["redirect_url"] == "https://checkout.fintoc.com/cs_test_123"


@pytest.mark.asyncio
async def test_checkout_platform_key_fallback_when_no_tenant_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sin key del tenant: cae en la key de plataforma."""
    monkeypatch.setattr("app.integrations.payments.fintoc_service.httpx.AsyncClient", DummyAsyncClient)
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_SECRET_KEY", "sk_live_platform")
    DummyAsyncClient.reset()

    service = FintocService()
    await service.create_checkout_session(
        amount=10000,
        currency="CLP",
        customer_name="",
        customer_email="",
        success_url=VALID_URLS["success_url"],
        cancel_url=VALID_URLS["cancel_url"],
        secret_key=None,
    )

    req = DummyAsyncClient.last_request
    assert req["headers"]["Authorization"] == "sk_live_platform"


# ── sin collection: CON recipient_account ────────────────────────────────────

@pytest.mark.asyncio
async def test_checkout_without_collection_sends_recipient_account(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sin collection activado: se envía recipient_account correctamente."""
    monkeypatch.setattr("app.integrations.payments.fintoc_service.httpx.AsyncClient", DummyAsyncClient)
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_SECRET_KEY", "sk_live_platform")
    DummyAsyncClient.reset()

    service = FintocService()
    await service.create_checkout_session(
        amount=34990,
        currency="CLP",
        customer_name="Jane Doe",
        customer_email="jane@example.com",
        success_url=VALID_URLS["success_url"],
        cancel_url=VALID_URLS["cancel_url"],
        metadata={"tenant_id": "tenant_123"},
        recipient_account={
            "holder_id": "12345678-9",
            "number": "00123456789",
            "type": "checking_account",
            "institution_id": "cl_banco_estado",
        },
    )

    req = DummyAsyncClient.last_request
    assert req["json"]["payment_method_types"] == ["bank_transfer"]
    assert req["json"]["payment_method_options"] == {
        "bank_transfer": {
            "recipient_account": {
                "holder_id": "12345678-9",
                "number": "00123456789",
                "type": "checking_account",
                "institution_id": "cl_banco_estado",
            }
        }
    }


# ── plataforma: recipient_account vars vacías → no se envía ──────────────────

def test_get_platform_recipient_account_empty_vars_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """Con FINTOC_RECIPIENT_* vacíos: get_platform_recipient_account devuelve None."""
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_RECIPIENT_HOLDER_ID", "")
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_RECIPIENT_ACCOUNT_NUMBER", "")
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_RECIPIENT_ACCOUNT_TYPE", "")
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_RECIPIENT_INSTITUTION_ID", "")

    service = FintocService()
    assert service.get_platform_recipient_account() is None


def test_get_platform_recipient_account_filled_vars_returns_dict(monkeypatch: pytest.MonkeyPatch) -> None:
    """Con FINTOC_RECIPIENT_* llenos: devuelve dict normalizado."""
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_RECIPIENT_HOLDER_ID", "19726539-6")
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_RECIPIENT_ACCOUNT_NUMBER", "19802070520")
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_RECIPIENT_ACCOUNT_TYPE", "checking_account")
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_RECIPIENT_INSTITUTION_ID", "cl_banco_falabella")

    service = FintocService()
    result = service.get_platform_recipient_account()
    assert result is not None
    assert result["holder_id"] == "19726539-6"
    assert result["institution_id"] == "cl_banco_falabella"


# ── normalize_recipient_account ───────────────────────────────────────────────

def test_normalize_recipient_account_all_empty_returns_none() -> None:
    service = FintocService()
    assert service.normalize_recipient_account({}) is None
    assert service.normalize_recipient_account(None) is None


def test_normalize_recipient_account_missing_fields_raises() -> None:
    service = FintocService()
    with pytest.raises(ValueError, match="recipient_account"):
        service.normalize_recipient_account({
            "holder_id": "12345678-9",
            "number": "",
            "type": "checking_account",
            "institution_id": "cl_banco_estado",
        })


def test_normalize_recipient_account_invalid_type_raises() -> None:
    service = FintocService()
    with pytest.raises(ValueError, match="checking_account"):
        service.normalize_recipient_account({
            "holder_id": "12345678-9",
            "number": "00123456789",
            "type": "savings_account",
            "institution_id": "cl_banco_estado",
        })


def test_normalize_recipient_account_valid_sight_account() -> None:
    service = FintocService()
    result = service.normalize_recipient_account({
        "holder_id": "12345678-9",
        "number": "00123456789",
        "type": "sight_account",
        "institution_id": "cl_banco_estado",
    })
    assert result is not None
    assert result["type"] == "sight_account"


# ── URLs HTTPS ────────────────────────────────────────────────────────────────

def test_validate_return_url_rejects_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_SECRET_KEY", "sk_test_dummy")
    service = FintocService()
    with pytest.raises(ValueError, match="success_url HTTPS"):
        service._validate_return_url("http://nexofitness.cl/store/gym?checkout=success", "success_url")


def test_validate_return_url_accepts_https(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_SECRET_KEY", "sk_test_dummy")
    service = FintocService()
    service._validate_return_url("https://nexofitness.cl/store/gym?checkout=success", "success_url")


# ── sin key configurada ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_checkout_raises_when_no_key_available(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sin key de tenant ni de plataforma: RuntimeError."""
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_SECRET_KEY", "")

    service = FintocService()
    with pytest.raises(RuntimeError, match="FINTOC_SECRET_KEY"):
        await service.create_checkout_session(
            amount=10000,
            currency="CLP",
            customer_name="",
            customer_email="",
            success_url=VALID_URLS["success_url"],
            cancel_url=VALID_URLS["cancel_url"],
            secret_key=None,
        )


# ── Webhook ───────────────────────────────────────────────────────────────────

def test_verify_webhook_valid_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_live_test"
    timestamp = str(int(time.time()))
    payload_dict = {"type": "payment_intent.succeeded", "data": {"object": {"metadata": {"tenant_id": "t1"}}}}
    payload = json.dumps(payload_dict, separators=(",", ":")).encode("utf-8")
    signed_payload = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), signed_payload, "sha256").hexdigest()

    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_WEBHOOK_SECRET", secret)

    service = FintocService()
    event = service.verify_webhook(payload, f"t={timestamp},v1={signature}")
    assert event["type"] == "payment_intent.succeeded"


def test_verify_webhook_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_WEBHOOK_SECRET", "whsec_live_test")

    service = FintocService()
    with pytest.raises(ValueError, match="signature invalida"):
        service.verify_webhook(
            b'{"type":"payment_intent.succeeded"}',
            f"t={int(time.time())},v1=badfakesignature",
        )


def test_verify_webhook_rejects_stale_timestamp(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_live_test"
    stale_timestamp = str(int(time.time()) - 400)
    payload = b'{"type":"payment_intent.succeeded"}'
    signed_payload = f"{stale_timestamp}.{payload.decode()}".encode()
    signature = hmac.new(secret.encode(), signed_payload, "sha256").hexdigest()

    monkeypatch.setattr("app.integrations.payments.fintoc_service.settings.FINTOC_WEBHOOK_SECRET", secret)

    service = FintocService()
    with pytest.raises(ValueError, match="timestamp"):
        service.verify_webhook(payload, f"t={stale_timestamp},v1={signature}")
