"""Webpay Plus integration helpers using Transbank's REST API."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import httpx
import structlog

from app.core.config import get_settings

settings = get_settings()
logger = structlog.get_logger()

WEBPAY_ENVIRONMENTS = {
    "integration": "https://webpay3gint.transbank.cl",
    "production": "https://webpay3g.transbank.cl",
}
WEBPAY_CREATE_PATH = "/rswebpaytransaction/api/webpay/v1.2/transactions"
WEBPAY_DEFAULT_INTEGRATION_COMMERCE_CODE = "597055555532"
WEBPAY_DEFAULT_INTEGRATION_API_KEY = "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"


@dataclass(frozen=True)
class WebpayCredentials:
    commerce_code: str
    api_key: str
    environment: str = "integration"

    @property
    def base_url(self) -> str:
        return WEBPAY_ENVIRONMENTS[self.environment]

    @property
    def create_url(self) -> str:
        return f"{self.base_url}{WEBPAY_CREATE_PATH}"

    def commit_url(self, token: str) -> str:
        return f"{self.create_url}/{token}"

    def status_url(self, token: str) -> str:
        return f"{self.create_url}/{token}"

    def refund_url(self, token: str) -> str:
        return f"{self.create_url}/{token}/refunds"


class WebpayService:
    def _normalize_environment(self, raw_value: Optional[str]) -> str:
        environment = (raw_value or "integration").strip().lower()
        if environment not in WEBPAY_ENVIRONMENTS:
            raise ValueError("WEBPAY_ENVIRONMENT debe ser 'integration' o 'production'")
        return environment

    def get_platform_credentials(self) -> Optional[WebpayCredentials]:
        commerce_code = settings.WEBPAY_COMMERCE_CODE.strip()
        api_key = settings.WEBPAY_API_KEY.strip()
        environment = self._normalize_environment(settings.WEBPAY_ENVIRONMENT)

        if commerce_code and api_key:
            return WebpayCredentials(
                commerce_code=commerce_code,
                api_key=api_key,
                environment=environment,
            )

        if settings.APP_ENV != "production":
            return WebpayCredentials(
                commerce_code=WEBPAY_DEFAULT_INTEGRATION_COMMERCE_CODE,
                api_key=WEBPAY_DEFAULT_INTEGRATION_API_KEY,
                environment="integration",
            )

        return None

    def is_configured(self) -> bool:
        try:
            return self.get_platform_credentials() is not None
        except ValueError:
            return False

    def credentials_from_metadata(self, metadata: Optional[dict[str, Any]]) -> Optional[WebpayCredentials]:
        payload = metadata or {}
        commerce_code = str(payload.get("commerce_code") or "").strip()
        api_key = str(payload.get("api_key") or "").strip()
        try:
            environment = self._normalize_environment(str(payload.get("environment") or "integration"))
        except ValueError:
            return None

        if not commerce_code or not api_key:
            return None

        return WebpayCredentials(
            commerce_code=commerce_code,
            api_key=api_key,
            environment=environment,
        )

    def is_account_configured(self, metadata: Optional[dict[str, Any]]) -> bool:
        return self.credentials_from_metadata(metadata) is not None

    def build_headers(self, credentials: WebpayCredentials) -> dict[str, str]:
        return {
            "Tbk-Api-Key-Id": credentials.commerce_code,
            "Tbk-Api-Key-Secret": credentials.api_key,
            "Content-Type": "application/json",
        }

    async def create_transaction(
        self,
        *,
        buy_order: str,
        session_id: str,
        amount: int,
        return_url: str,
        credentials: WebpayCredentials,
    ) -> dict[str, Any]:
        payload = {
            "buy_order": buy_order,
            "session_id": session_id,
            "amount": amount,
            "return_url": return_url,
        }

        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                credentials.create_url,
                headers=self.build_headers(credentials),
                json=payload,
            )

        if response.status_code not in (200, 201):
            logger.error(
                "webpay_create_transaction_failed",
                status=response.status_code,
                body=response.text[:300],
                environment=credentials.environment,
            )
            raise ValueError(f"Webpay error {response.status_code}: {response.text[:200]}")

        data = response.json()
        if not data.get("token") or not data.get("url"):
            raise ValueError("Webpay no devolvio token o url para la transaccion")

        logger.info(
            "webpay_transaction_created",
            buy_order=buy_order,
            session_id=session_id,
            amount=amount,
            environment=credentials.environment,
        )
        return data

    async def commit_transaction(
        self,
        *,
        token: str,
        credentials: WebpayCredentials,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.put(
                credentials.commit_url(token),
                headers=self.build_headers(credentials),
            )

        if response.status_code != 200:
            logger.error(
                "webpay_commit_transaction_failed",
                status=response.status_code,
                body=response.text[:300],
                token=token,
                environment=credentials.environment,
            )
            raise ValueError(f"Webpay error {response.status_code}: {response.text[:200]}")

        data = response.json()
        logger.info(
            "webpay_transaction_committed",
            token=token,
            buy_order=data.get("buy_order"),
            status=data.get("status"),
            response_code=data.get("response_code"),
        )
        return data

    async def transaction_status(
        self,
        *,
        token: str,
        credentials: WebpayCredentials,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                credentials.status_url(token),
                headers=self.build_headers(credentials),
            )

        if response.status_code != 200:
            raise ValueError(f"Webpay error {response.status_code}: {response.text[:200]}")
        return response.json()

    async def refund(
        self,
        *,
        token: str,
        amount: int,
        credentials: WebpayCredentials,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                credentials.refund_url(token),
                headers=self.build_headers(credentials),
                json={"amount": amount},
            )

        if response.status_code != 200:
            raise ValueError(f"Webpay error {response.status_code}: {response.text[:200]}")
        return response.json()


webpay_service = WebpayService()
