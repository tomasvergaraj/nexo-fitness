"""Payment provider accounts router (tenant-level)."""

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_tenant_context,
    require_roles,
)
from app.integrations.payments.webpay_service import (
    WEBPAY_DEFAULT_INTEGRATION_API_KEY,
    WEBPAY_DEFAULT_INTEGRATION_COMMERCE_CODE,
    WebpayCredentials,
    webpay_service,
)
from app.models.platform import TenantPaymentProviderAccount, WebpayTransaction
from app.models.user import User
from app.schemas.platform import (
    PaymentProviderAccountCreateRequest,
    PaymentProviderAccountResponse,
    PaymentProviderAccountUpdateRequest,
)
from app.services.webpay_checkout_service import (
    build_webpay_redirect_url,
    build_webpay_return_url,
    generate_webpay_buy_order,
    generate_webpay_session_id,
    normalize_payment_account_metadata,
    sanitize_payment_account_metadata,
)

from ._common import _loads_dict


payment_accounts_router = APIRouter(prefix="/payment-provider/accounts", tags=["Payment Accounts"])

settings = get_settings()


def _validate_payment_account_configuration(
    *,
    provider: str,
    status: str,
    metadata: dict[str, Any],
    checkout_base_url: Optional[str],
) -> dict[str, Any]:
    try:
        normalized_metadata = normalize_payment_account_metadata(provider, metadata)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if provider == "webpay" and status == "connected":
        if not normalized_metadata.get("commerce_code") or not normalized_metadata.get("api_key"):
            raise HTTPException(
                status_code=400,
                detail="Webpay conectado requiere commerce code y API key.",
            )

    if provider == "fintoc" and status == "connected":
        secret_key = str(normalized_metadata.get("secret_key") or "").strip()
        if not secret_key:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Fintoc conectado requiere la API key secreta de tu cuenta Fintoc. "
                    "Encuéntrala en el dashboard de Fintoc bajo 'API Keys'."
                ),
            )

    if provider == "tuu" and status == "connected":
        account_id = str(normalized_metadata.get("account_id") or "").strip()
        secret_key = str(normalized_metadata.get("secret_key") or "").strip()
        if not account_id or not secret_key:
            raise HTTPException(
                status_code=400,
                detail="TUU conectado requiere account_id y secret_key.",
            )

    if provider in {"stripe", "mercadopago", "manual"} and status == "connected" and not (checkout_base_url or "").strip():
        raise HTTPException(
            status_code=400,
            detail=f"El proveedor {provider} requiere checkout_base_url cuando se marca como conectado.",
        )

    return normalized_metadata


def _payment_account_payload(account: TenantPaymentProviderAccount) -> PaymentProviderAccountResponse:
    return PaymentProviderAccountResponse(
        id=account.id,
        provider=account.provider,
        status=account.status,
        account_label=account.account_label,
        public_identifier=account.public_identifier,
        checkout_base_url=account.checkout_base_url,
        metadata=sanitize_payment_account_metadata(_loads_dict(account.metadata_json)),
        is_default=account.is_default,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


@payment_accounts_router.get("", response_model=list[PaymentProviderAccountResponse])
async def list_payment_accounts(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(TenantPaymentProviderAccount)
        .where(TenantPaymentProviderAccount.tenant_id == ctx.tenant_id)
        .order_by(TenantPaymentProviderAccount.is_default.desc(), TenantPaymentProviderAccount.created_at.asc())
    )
    return [_payment_account_payload(account) for account in result.scalars().all()]


@payment_accounts_router.post("", response_model=PaymentProviderAccountResponse, status_code=201)
async def create_payment_account(
    data: PaymentProviderAccountCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    normalized_metadata = _validate_payment_account_configuration(
        provider=data.provider,
        status=data.status,
        metadata=data.metadata,
        checkout_base_url=data.checkout_base_url,
    )
    public_identifier = (data.public_identifier or "").strip() or None
    if data.provider == "webpay" and not public_identifier:
        public_identifier = str(normalized_metadata.get("commerce_code") or "").strip() or None
    if data.provider == "tuu" and not public_identifier:
        public_identifier = str(normalized_metadata.get("account_id") or "").strip() or None

    if data.is_default:
        existing_accounts = (
            await db.execute(
                select(TenantPaymentProviderAccount).where(TenantPaymentProviderAccount.tenant_id == ctx.tenant_id)
            )
        ).scalars().all()
        for account in existing_accounts:
            account.is_default = False

    account = TenantPaymentProviderAccount(
        tenant_id=ctx.tenant_id,
        provider=data.provider,
        status=data.status,
        account_label=data.account_label,
        public_identifier=public_identifier,
        checkout_base_url=(data.checkout_base_url or "").strip() or None,
        metadata_json=json.dumps(normalized_metadata),
        is_default=data.is_default,
    )
    db.add(account)
    await db.flush()
    await db.refresh(account)
    return _payment_account_payload(account)


@payment_accounts_router.patch("/{account_id}", response_model=PaymentProviderAccountResponse)
async def update_payment_account(
    account_id: UUID,
    data: PaymentProviderAccountUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    account = await db.get(TenantPaymentProviderAccount, account_id)
    if not account or account.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Cuenta de pago no encontrada")

    payload = data.model_dump(exclude_unset=True)
    merged_metadata = _loads_dict(account.metadata_json)
    if "metadata" in payload and payload["metadata"] is not None:
        merged_metadata.update(payload["metadata"])

    normalized_status = payload.get("status", account.status)
    normalized_checkout_base_url = payload.get("checkout_base_url", account.checkout_base_url)
    normalized_metadata = _validate_payment_account_configuration(
        provider=account.provider,
        status=normalized_status,
        metadata=merged_metadata,
        checkout_base_url=normalized_checkout_base_url,
    )

    if payload.get("is_default"):
        existing_accounts = (
            await db.execute(
                select(TenantPaymentProviderAccount).where(TenantPaymentProviderAccount.tenant_id == ctx.tenant_id)
            )
        ).scalars().all()
        for existing in existing_accounts:
            existing.is_default = existing.id == account.id

    if "metadata" in payload:
        payload.pop("metadata")
        account.metadata_json = json.dumps(normalized_metadata)

    if account.provider == "webpay" and "public_identifier" not in payload:
        auto_identifier = str(normalized_metadata.get("commerce_code") or "").strip()
        if auto_identifier and not (account.public_identifier or "").strip():
            account.public_identifier = auto_identifier
    if account.provider == "tuu" and "public_identifier" not in payload:
        auto_identifier = str(normalized_metadata.get("account_id") or "").strip()
        if auto_identifier and not (account.public_identifier or "").strip():
            account.public_identifier = auto_identifier

    for field, value in payload.items():
        if field in {"account_label", "public_identifier", "checkout_base_url"}:
            value = (value or "").strip() or None
        setattr(account, field, value)

    await db.flush()
    await db.refresh(account)
    return _payment_account_payload(account)


@payment_accounts_router.delete("/{account_id}", status_code=204, response_class=Response)
async def delete_payment_account(
    account_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    account = await db.get(TenantPaymentProviderAccount, account_id)
    if not account or account.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Cuenta de pago no encontrada")

    was_default = account.is_default
    await db.delete(account)
    await db.flush()

    if was_default:
        replacement = (
            await db.execute(
                select(TenantPaymentProviderAccount)
                .where(TenantPaymentProviderAccount.tenant_id == ctx.tenant_id)
                .order_by(TenantPaymentProviderAccount.created_at.asc())
                .limit(1)
            )
        ).scalars().first()
        if replacement:
            replacement.is_default = True
            await db.flush()

    return Response(status_code=204)


@payment_accounts_router.post("/{account_id}/webpay/test-transaction", status_code=201)
async def create_webpay_test_transaction(
    account_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(require_roles("owner", "admin")),
):
    account = await db.get(TenantPaymentProviderAccount, account_id)
    if not account or account.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Cuenta de pago no encontrada")
    if account.provider != "webpay":
        raise HTTPException(status_code=400, detail="Esta cuenta no es de tipo Webpay")

    credentials = WebpayCredentials(
        commerce_code=WEBPAY_DEFAULT_INTEGRATION_COMMERCE_CODE,
        api_key=WEBPAY_DEFAULT_INTEGRATION_API_KEY,
        environment="integration",
    )

    success_url = f"{settings.public_app_url.rstrip('/')}/settings?webpay_test=success"
    cancel_url = f"{settings.public_app_url.rstrip('/')}/settings?webpay_test=cancelled"

    transaction = WebpayTransaction(
        tenant_id=ctx.tenant_id,
        user_id=current_user.id,
        payment_account_id=account.id,
        flow_type="webpay_connectivity_test",
        flow_reference=str(account_id),
        status="creating",
        buy_order=generate_webpay_buy_order("wbtest"),
        session_id=generate_webpay_session_id("wbtest"),
        amount=Decimal("100"),
        currency="CLP",
        commerce_code=credentials.commerce_code,
        environment=credentials.environment,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata_json=json.dumps({"account_id": str(account_id), "test": True}),
    )
    db.add(transaction)
    await db.flush()

    return_url = build_webpay_return_url(str(transaction.id))
    provider_response = await webpay_service.create_transaction(
        buy_order=transaction.buy_order,
        session_id=transaction.session_id,
        amount=100,
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

    return {"checkout_url": transaction.checkout_url, "transaction_id": str(transaction.id)}
