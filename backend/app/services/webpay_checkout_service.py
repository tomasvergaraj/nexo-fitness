"""Helpers for creating Webpay transactions for SaaS and tenant checkouts."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.payments.fintoc_service import fintoc_service
from app.integrations.payments.webpay_service import WebpayCredentials, webpay_service
from app.models.platform import TenantPaymentProviderAccount, WebpayTransaction
from app.models.tenant import Tenant
from app.models.user import User

settings = get_settings()
WEBPAY_MAX_BUY_ORDER_LENGTH = 26
WEBPAY_BUY_ORDER_RANDOM_LENGTH = 20


def build_webpay_redirect_url(transaction_id: str) -> str:
    return f"{settings.public_app_url.rstrip('/')}{settings.API_V1_PREFIX}/public/webpay/redirect/{transaction_id}"


def build_webpay_return_url(transaction_id: str) -> str:
    return f"{settings.public_app_url.rstrip('/')}{settings.API_V1_PREFIX}/public/webpay/return?transaction_id={transaction_id}"


def generate_webpay_buy_order(prefix: str = "nexo") -> str:
    max_prefix_length = max(1, WEBPAY_MAX_BUY_ORDER_LENGTH - WEBPAY_BUY_ORDER_RANDOM_LENGTH)
    compact_prefix = "".join(ch for ch in prefix.lower() if ch.isalnum())[:max_prefix_length] or "nexo"
    suffix_length = max(1, WEBPAY_MAX_BUY_ORDER_LENGTH - len(compact_prefix))
    return f"{compact_prefix}{uuid4().hex[:suffix_length]}"


def generate_webpay_session_id(prefix: str = "sess") -> str:
    compact_prefix = "".join(ch for ch in prefix.lower() if ch.isalnum())[:8] or "sess"
    return f"{compact_prefix}{uuid4().hex[:20]}"


def sanitize_payment_account_metadata(metadata: Optional[dict[str, Any]]) -> dict[str, Any]:
    payload = dict(metadata or {})
    for key in ("api_key", "secret_key", "access_token", "private_key"):
        if payload.get(key):
            payload.pop(key, None)
            payload[f"{key}_configured"] = True
    return payload


def normalize_payment_account_metadata(
    provider: str,
    metadata: Optional[dict[str, Any]],
) -> dict[str, Any]:
    payload = dict(metadata or {})

    if provider == "webpay":
        environment = str(payload.get("environment") or "integration").strip().lower()
        if environment not in {"integration", "production"}:
            raise ValueError("Webpay requiere un ambiente válido: integration o production.")
        payload["environment"] = environment

        commerce_code = str(payload.get("commerce_code") or "").strip()
        api_key = str(payload.get("api_key") or "").strip()
        if commerce_code:
            payload["commerce_code"] = commerce_code
        if api_key:
            payload["api_key"] = api_key

    if provider == "fintoc":
        secret_key = str(payload.get("secret_key") or "").strip()
        if secret_key:
            payload["secret_key"] = secret_key
        recipient_account = fintoc_service.normalize_recipient_account(payload.get("recipient_account"))
        if recipient_account:
            payload["recipient_account"] = recipient_account
        else:
            payload.pop("recipient_account", None)

    return payload


async def create_platform_webpay_transaction(
    db: AsyncSession,
    *,
    tenant: Tenant,
    user: User,
    amount: Decimal,
    currency: str,
    flow_type: str,
    flow_reference: Optional[str],
    success_url: str,
    cancel_url: str,
    metadata: dict[str, Any],
) -> WebpayTransaction:
    credentials = webpay_service.get_platform_credentials()
    if credentials is None:
        raise ValueError("Webpay no está configurado para la plataforma. Define WEBPAY_COMMERCE_CODE y WEBPAY_API_KEY.")

    transaction = await _create_webpay_transaction(
        db,
        tenant=tenant,
        user=user,
        payment_account=None,
        amount=amount,
        currency=currency,
        flow_type=flow_type,
        flow_reference=flow_reference,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata,
        credentials=credentials,
    )
    return transaction


async def create_tenant_webpay_transaction(
    db: AsyncSession,
    *,
    tenant: Tenant,
    payment_account: TenantPaymentProviderAccount,
    user: Optional[User],
    amount: Decimal,
    currency: str,
    flow_type: str,
    flow_reference: Optional[str],
    success_url: str,
    cancel_url: str,
    metadata: dict[str, Any],
) -> WebpayTransaction:
    account_metadata = normalize_payment_account_metadata(payment_account.provider, _loads_dict(payment_account.metadata_json))
    credentials = webpay_service.credentials_from_metadata(account_metadata)
    if credentials is None:
        raise ValueError("La cuenta Webpay del gimnasio no tiene commerce code y API key configurados.")

    transaction = await _create_webpay_transaction(
        db,
        tenant=tenant,
        user=user,
        payment_account=payment_account,
        amount=amount,
        currency=currency,
        flow_type=flow_type,
        flow_reference=flow_reference,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata,
        credentials=credentials,
    )
    return transaction


async def _create_webpay_transaction(
    db: AsyncSession,
    *,
    tenant: Tenant,
    user: Optional[User],
    payment_account: Optional[TenantPaymentProviderAccount],
    amount: Decimal,
    currency: str,
    flow_type: str,
    flow_reference: Optional[str],
    success_url: str,
    cancel_url: str,
    metadata: dict[str, Any],
    credentials: WebpayCredentials,
) -> WebpayTransaction:
    transaction = WebpayTransaction(
        tenant_id=tenant.id,
        user_id=user.id if user else None,
        payment_account_id=payment_account.id if payment_account else None,
        flow_type=flow_type,
        flow_reference=flow_reference,
        status="creating",
        buy_order=generate_webpay_buy_order(flow_type),
        session_id=generate_webpay_session_id(flow_type),
        amount=amount,
        currency=(currency or tenant.currency or "CLP").upper(),
        commerce_code=credentials.commerce_code,
        environment=credentials.environment,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata_json=json.dumps(metadata),
    )
    db.add(transaction)
    await db.flush()

    return_url = build_webpay_return_url(str(transaction.id))
    provider_response = await webpay_service.create_transaction(
        buy_order=transaction.buy_order,
        session_id=transaction.session_id,
        amount=int(amount),
        return_url=return_url,
        credentials=credentials,
    )

    transaction.token = provider_response["token"]
    transaction.provider_url = provider_response["url"]
    transaction.return_url = return_url
    transaction.checkout_url = build_webpay_redirect_url(str(transaction.id))
    transaction.status = "pending"
    transaction.provider_response_json = json.dumps(provider_response)
    transaction.updated_at = datetime.now(timezone.utc)
    await db.flush()

    return transaction


def _loads_dict(raw_value: Optional[str]) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
