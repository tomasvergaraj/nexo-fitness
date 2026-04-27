"""TUU payment integration helpers for hosted online checkout."""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlsplit

from app.core.config import get_settings

settings = get_settings()

TUU_ENVIRONMENTS = {
    "integration": "https://frontend-api.payment.haulmer.dev/v1/payment",
    "production": "https://core.payment.haulmer.com/api/v1/payment",
}


@dataclass(frozen=True)
class TuuCredentials:
    account_id: str
    secret_key: str
    environment: str = "integration"

    @property
    def payment_url(self) -> str:
        return TUU_ENVIRONMENTS[self.environment]


class TuuService:
    def _normalize_environment(self, raw_value: Optional[str]) -> str:
        environment = (raw_value or "integration").strip().lower()
        if environment not in TUU_ENVIRONMENTS:
            raise ValueError("TUU requiere environment = integration o production.")
        return environment

    def credentials_from_metadata(self, metadata: Optional[dict[str, Any]]) -> Optional[TuuCredentials]:
        payload = metadata or {}
        account_id = str(payload.get("account_id") or "").strip()
        secret_key = str(payload.get("secret_key") or "").strip()
        if not account_id or not secret_key:
            return None

        environment = self._normalize_environment(str(payload.get("environment") or "integration"))
        return TuuCredentials(
            account_id=account_id,
            secret_key=secret_key,
            environment=environment,
        )

    def is_account_configured(self, metadata: Optional[dict[str, Any]]) -> bool:
        try:
            return self.credentials_from_metadata(metadata) is not None
        except ValueError:
            return False

    def _validate_url(self, url: str, field_name: str) -> None:
        parsed = urlsplit(url)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError(f"TUU requiere {field_name} con una URL válida y pública.")
        if settings.APP_ENV == "production" and parsed.scheme != "https":
            raise ValueError(f"TUU requiere {field_name} HTTPS en producción.")

    def normalize_customer_phone(self, raw_value: str) -> str:
        raw = str(raw_value or "").strip()
        if not raw:
            raise ValueError("TUU requiere teléfono del cliente.")

        digits = "".join(ch for ch in raw if ch.isdigit())
        if raw.startswith("+") and 8 <= len(digits) <= 15:
            return f"+{digits}"
        if len(digits) == 11 and digits.startswith("56"):
            return f"+{digits}"
        if len(digits) == 9:
            return f"+56{digits}"
        if len(digits) == 8:
            return f"+56{digits}"
        if 10 <= len(digits) <= 15:
            return f"+{digits}"
        raise ValueError("TUU requiere teléfono en formato válido, idealmente +56912345678.")

    def sign_payload(self, payload: dict[str, Any], secret_key: str) -> str:
        signable_fields = {
            key: value
            for key, value in payload.items()
            if key.startswith("x_") and key != "x_signature"
        }
        message = "".join(f"{key}{signable_fields[key]}" for key in sorted(signable_fields))
        return hmac.new(
            secret_key.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def verify_signature(self, payload: dict[str, Any], secret_key: str) -> bool:
        received_signature = str(payload.get("x_signature") or "").strip().lower()
        if not received_signature:
            return False
        expected_signature = self.sign_payload(payload, secret_key)
        return hmac.compare_digest(received_signature, expected_signature)

    def build_payment_payload(
        self,
        *,
        credentials: TuuCredentials,
        amount: int,
        currency: str,
        customer_email: str,
        customer_first_name: str,
        customer_last_name: str,
        customer_phone: str,
        description: str,
        reference: str,
        shop_name: str,
        callback_url: str,
        cancel_url: str,
        complete_url: str,
    ) -> dict[str, Any]:
        normalized_currency = (currency or "CLP").strip().upper()
        if normalized_currency != "CLP":
            raise ValueError("TUU solo admite pagos en CLP.")

        for field_name, url in (
            ("x_url_callback", callback_url),
            ("x_url_cancel", cancel_url),
            ("x_url_complete", complete_url),
        ):
            self._validate_url(url, field_name)

        payload: dict[str, Any] = {
            "x_account_id": credentials.account_id,
            "x_amount": int(amount),
            "x_currency": normalized_currency,
            "x_customer_email": customer_email.strip(),
            "x_customer_first_name": customer_first_name.strip(),
            "x_customer_last_name": customer_last_name.strip(),
            "x_customer_phone": self.normalize_customer_phone(customer_phone),
            "x_description": description.strip(),
            "x_reference": reference.strip(),
            "x_shop_name": shop_name.strip(),
            "x_url_callback": callback_url.strip(),
            "x_url_cancel": cancel_url.strip(),
            "x_url_complete": complete_url.strip(),
        }
        payload["x_signature"] = self.sign_payload(payload, credentials.secret_key)
        return payload


tuu_service = TuuService()
