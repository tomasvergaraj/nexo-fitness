"""Helpers for creating TUU transactions for tenant checkouts."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.payments.tuu_service import tuu_service
from app.models.platform import TenantPaymentProviderAccount, TuuTransaction
from app.models.tenant import Tenant
from app.models.user import User

settings = get_settings()
TUU_REFERENCE_MAX_LENGTH = 24


def build_tuu_redirect_url(transaction_id: str) -> str:
    return f"{settings.public_app_url.rstrip('/')}{settings.API_V1_PREFIX}/public/tuu/redirect/{transaction_id}"


def build_tuu_callback_url(transaction_id: str) -> str:
    return (
        f"{settings.public_app_url.rstrip('/')}{settings.API_V1_PREFIX}"
        f"/public/webhooks/tuu/{transaction_id}"
    )


def generate_tuu_reference(prefix: str = "tuu") -> str:
    compact_prefix = "".join(ch for ch in prefix.lower() if ch.isalnum())[:8] or "tuu"
    random_length = max(8, TUU_REFERENCE_MAX_LENGTH - len(compact_prefix))
    return f"{compact_prefix}{uuid4().hex[:random_length]}"


def build_tuu_complete_url(transaction_id: str) -> str:
    return (
        f"{settings.public_app_url.rstrip('/')}{settings.API_V1_PREFIX}"
        f"/public/tuu/complete/{transaction_id}"
    )


def build_tuu_cancel_url(transaction_id: str) -> str:
    return (
        f"{settings.public_app_url.rstrip('/')}{settings.API_V1_PREFIX}"
        f"/public/tuu/cancel/{transaction_id}"
    )


async def create_tenant_tuu_transaction(
    db: AsyncSession,
    *,
    tenant: Tenant,
    payment_account: TenantPaymentProviderAccount,
    user: Optional[User],
    amount: Decimal,
    currency: str,
    flow_type: str,
    flow_reference: str,
    success_url: str,
    cancel_url: str,
    metadata: dict[str, Any],
) -> TuuTransaction:
    account_metadata = _loads_dict(payment_account.metadata_json)
    credentials = tuu_service.credentials_from_metadata(account_metadata)
    if credentials is None:
        raise ValueError("La cuenta TUU del gimnasio no tiene account_id y secret_key configurados.")

    transaction = TuuTransaction(
        tenant_id=tenant.id,
        user_id=user.id if user else None,
        payment_account_id=payment_account.id,
        flow_type=flow_type,
        flow_reference=flow_reference,
        status="created",
        amount=amount,
        currency=(currency or tenant.currency or "CLP").upper(),
        account_id=credentials.account_id,
        environment=credentials.environment,
        provider_url=credentials.payment_url,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata_json=json.dumps(metadata),
    )
    db.add(transaction)
    await db.flush()

    transaction.callback_url = build_tuu_callback_url(str(transaction.id))
    transaction.checkout_url = build_tuu_redirect_url(str(transaction.id))
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
