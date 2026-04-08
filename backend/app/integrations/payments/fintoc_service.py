"""Fintoc payment integration for hosted bank-transfer checkout."""

import hashlib
import hmac
import json
import time
from typing import Optional
from urllib.parse import urlsplit

import httpx
import structlog

from app.core.config import get_settings

settings = get_settings()
logger = structlog.get_logger()

FINTOC_API_BASE = "https://api.fintoc.com"


class FintocService:
    """
    Fintoc Cobros integration using Checkout Sessions.
    Docs: https://docs.fintoc.com/docs/accept-a-payment
    """

    def is_configured(self) -> bool:
        return bool(settings.FINTOC_SECRET_KEY)

    def _headers(self) -> dict:
        return {
            "Authorization": settings.FINTOC_SECRET_KEY,
            "Content-Type": "application/json",
        }

    def _validate_return_url(self, url: str, field_name: str) -> None:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError(
                f"Fintoc requiere {field_name} HTTPS y publica. "
                "Configura una URL publica HTTPS para los redirects del checkout."
            )

    def _parse_signature_header(self, signature_header: str) -> tuple[str, str]:
        parts = {}
        for item in signature_header.split(","):
            if "=" not in item:
                continue
            key, value = item.split("=", 1)
            parts[key.strip()] = value.strip()

        timestamp = parts.get("t")
        signature = parts.get("v1")
        if not timestamp or not signature:
            raise ValueError("Fintoc webhook signature invalida")

        return timestamp, signature

    async def create_checkout_session(
        self,
        amount: int,
        currency: str = "CLP",
        customer_name: str = "",
        customer_email: str = "",
        success_url: str = "",
        cancel_url: str = "",
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        Create a Checkout Session and return the hosted redirect URL.
        The customer completes the transfer on Fintoc's checkout domain.
        """
        if not self.is_configured():
            raise RuntimeError("Fintoc no esta configurado. Agrega FINTOC_SECRET_KEY al .env")

        self._validate_return_url(success_url, "success_url")
        self._validate_return_url(cancel_url, "cancel_url")

        payload: dict = {
            "amount": amount,
            "currency": currency.upper(),
            "success_url": success_url,
            "cancel_url": cancel_url,
            # We already selected the provider in our checkout UI.
            "payment_method_types": ["bank_transfer"],
        }
        if customer_name or customer_email:
            payload["customer"] = {
                **({"name": customer_name} if customer_name else {}),
                **({"email": customer_email} if customer_email else {}),
            }
        if metadata:
            payload["metadata"] = metadata

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{FINTOC_API_BASE}/v2/checkout_sessions",
                headers=self._headers(),
                json=payload,
            )

        if response.status_code not in (200, 201):
            logger.error(
                "fintoc_create_checkout_session_failed",
                status=response.status_code,
                body=response.text[:300],
            )
            raise ValueError(f"Fintoc error {response.status_code}: {response.text[:200]}")

        data = response.json()
        redirect_url = data.get("redirect_url")
        if not redirect_url:
            raise ValueError("Fintoc no devolvio redirect_url para la sesion")

        logger.info(
            "fintoc_checkout_session_created",
            checkout_session_id=data.get("id"),
            amount=amount,
            currency=currency,
        )
        return {
            "id": data.get("id"),
            "redirect_url": redirect_url,
            "session_token": data.get("session_token"),
            "status": data.get("status", "pending"),
            "amount": amount,
            "currency": currency,
        }

    async def create_payment_intent(
        self,
        amount: int,
        currency: str = "CLP",
        customer_name: str = "",
        customer_email: str = "",
        return_url: str = "",
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        Create a Payment Intent and return the widget_token for the JS widget.
        Use this when embedding the Fintoc widget (not the hosted checkout redirect).
        Docs: https://docs.fintoc.com/reference/create-payment-intent
        """
        if not self.is_configured():
            raise RuntimeError("Fintoc no esta configurado. Agrega FINTOC_SECRET_KEY al .env")

        payload: dict = {
            "amount": amount,
            "currency": currency.upper(),
            "return_url": return_url,
        }
        if customer_name or customer_email:
            payload["customer"] = {
                **({"name": customer_name} if customer_name else {}),
                **({"email": customer_email} if customer_email else {}),
            }
        if metadata:
            payload["metadata"] = metadata

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{FINTOC_API_BASE}/v1/payment_intents",
                headers=self._headers(),
                json=payload,
            )

        if response.status_code not in (200, 201):
            logger.error(
                "fintoc_create_payment_intent_failed",
                status=response.status_code,
                body=response.text[:300],
            )
            raise ValueError(f"Fintoc error {response.status_code}: {response.text[:200]}")

        data = response.json()
        widget_token = data.get("widget_token")
        if not widget_token:
            raise ValueError("Fintoc no devolvio widget_token para el payment intent")

        logger.info(
            "fintoc_payment_intent_created",
            payment_intent_id=data.get("id"),
            amount=amount,
            currency=currency,
        )
        return {
            "id": data.get("id"),
            "widget_token": widget_token,
            "status": data.get("status", "pending"),
            "amount": amount,
            "currency": currency,
        }

    async def get_payment_intent(self, intent_id: str) -> dict:
        """Query a payment intent status."""
        if not self.is_configured():
            raise RuntimeError("Fintoc no esta configurado")

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{FINTOC_API_BASE}/v1/payment_intents/{intent_id}",
                headers=self._headers(),
            )

        if response.status_code == 404:
            raise ValueError(f"Payment intent {intent_id} no encontrado")
        if response.status_code != 200:
            raise ValueError(f"Fintoc error {response.status_code}")

        return response.json()

    def verify_webhook(self, payload: bytes, signature_header: str) -> dict:
        """
        Verify the Fintoc webhook signature using HMAC-SHA256.
        Header: Fintoc-Signature
        """
        if not settings.FINTOC_WEBHOOK_SECRET:
            raise RuntimeError("FINTOC_WEBHOOK_SECRET no configurado")

        timestamp, received_signature = self._parse_signature_header(signature_header)
        if abs(int(time.time()) - int(timestamp)) > 300:
            raise ValueError("Fintoc webhook timestamp fuera de rango")

        signed_payload = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
        expected = hmac.new(
            settings.FINTOC_WEBHOOK_SECRET.encode(),
            signed_payload,
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected, received_signature):
            raise ValueError("Fintoc webhook signature invalida")

        return json.loads(payload)


fintoc_service = FintocService()
