"""Push notification helpers backed by Expo Push Service."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence
from uuid import UUID

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.business import Campaign, Notification
from app.models.platform import PushDelivery, PushSubscription

settings = get_settings()

EXPO_PUSH_TOKEN_RE = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$")


@dataclass
class PushDeliveryResult:
    subscription_id: UUID
    expo_push_token: str
    status: str
    is_active: bool
    ticket_id: str | None = None
    message: str | None = None
    error: str | None = None
    receipt_status: str | None = None
    receipt_message: str | None = None
    receipt_error: str | None = None
    receipt_checked_at: datetime | None = None


@dataclass
class NotificationDispatchResult:
    notification: Notification
    deliveries: list[PushDeliveryResult]


def _chunked(items: Sequence[PushSubscription], chunk_size: int) -> Iterable[Sequence[PushSubscription]]:
    for index in range(0, len(items), chunk_size):
        yield items[index:index + chunk_size]


def _is_expo_push_token(token: str) -> bool:
    return bool(EXPO_PUSH_TOKEN_RE.match(token.strip()))


def _build_expo_message(notification: Notification, subscription: PushSubscription) -> dict[str, Any]:
    body = notification.message or notification.title
    return {
        "to": subscription.expo_push_token,
        "title": notification.title,
        "body": body,
        "sound": "default",
        "priority": "high",
        "channelId": "default",
        "data": {
            "source": "backend-notification",
            "notification_id": str(notification.id),
            "campaign_id": str(notification.campaign_id) if notification.campaign_id else None,
            "action_url": notification.action_url,
            "type": notification.type,
        },
    }


def _normalize_ticket_payload(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def _normalize_receipt_payload(data: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(data, dict):
        return {}
    return {
        str(key): value
        for key, value in data.items()
        if isinstance(key, str) and isinstance(value, dict)
    }


def _request_headers() -> dict[str, str]:
    headers = {
        "accept": "application/json",
        "accept-encoding": "gzip, deflate",
        "content-type": "application/json",
    }
    if settings.EXPO_PUSH_ACCESS_TOKEN.strip():
        headers["Authorization"] = f"Bearer {settings.EXPO_PUSH_ACCESS_TOKEN.strip()}"
    return headers


def _format_response_error(payload: dict[str, Any] | None, status_code: int) -> tuple[str | None, str]:
    if isinstance(payload, dict):
        errors = payload.get("errors")
        if isinstance(errors, list) and errors:
            first_error = errors[0] if isinstance(errors[0], dict) else {}
            error_code = first_error.get("code") if isinstance(first_error, dict) else None
            message = first_error.get("message") if isinstance(first_error, dict) else None
            if isinstance(error_code, str) or isinstance(message, str):
                return (
                    str(error_code) if isinstance(error_code, str) else None,
                    str(message) if isinstance(message, str) and message else f"Expo Push API HTTP {status_code}",
                )
    return None, f"Expo Push API HTTP {status_code}"


async def create_notification_record(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    campaign_id: UUID | None = None,
    title: str,
    message: str | None = None,
    type: str = "info",
    action_url: str | None = None,
) -> Notification:
    notification = Notification(
        tenant_id=tenant_id,
        user_id=user_id,
        campaign_id=campaign_id,
        title=title,
        message=message,
        type=type,
        action_url=action_url,
        is_read=False,
    )
    db.add(notification)
    await db.flush()
    await db.refresh(notification)
    return notification


async def list_active_push_subscriptions(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
) -> list[PushSubscription]:
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.tenant_id == tenant_id,
            PushSubscription.user_id == user_id,
            PushSubscription.is_active == True,
        )
    )
    return list(result.scalars().all())


async def list_push_deliveries_for_notification(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    notification_id: UUID,
) -> list[PushDelivery]:
    result = await db.execute(
        select(PushDelivery)
        .where(
            PushDelivery.tenant_id == tenant_id,
            PushDelivery.notification_id == notification_id,
        )
        .order_by(PushDelivery.created_at.asc())
    )
    return list(result.scalars().all())


async def refresh_campaign_engagement_totals(
    db: AsyncSession,
    *,
    campaign: Campaign,
) -> Campaign:
    campaign.total_opened = (
        await db.execute(
            select(func.count(Notification.id)).where(
                Notification.campaign_id == campaign.id,
                Notification.opened_at.is_not(None),
            )
        )
    ).scalar_one()
    campaign.total_clicked = (
        await db.execute(
            select(func.count(Notification.id)).where(
                Notification.campaign_id == campaign.id,
                Notification.clicked_at.is_not(None),
            )
        )
    ).scalar_one()
    return campaign


async def record_notification_engagement(
    db: AsyncSession,
    *,
    notification: Notification,
    is_read: bool | None = None,
    mark_opened: bool = False,
    mark_clicked: bool = False,
    occurred_at: datetime | None = None,
) -> Notification:
    timestamp = occurred_at or datetime.now(timezone.utc)

    if mark_clicked:
        mark_opened = True
        if is_read is None:
            is_read = True
    elif mark_opened and is_read is None:
        is_read = True

    if is_read is not None:
        notification.is_read = is_read
        if is_read and notification.opened_at is None:
            notification.opened_at = timestamp

    if mark_opened and notification.opened_at is None:
        notification.opened_at = timestamp

    if mark_clicked and notification.clicked_at is None:
        notification.clicked_at = timestamp

    await db.flush()

    if notification.campaign_id:
        campaign = await db.get(Campaign, notification.campaign_id)
        if campaign is not None and campaign.tenant_id == notification.tenant_id:
            await refresh_campaign_engagement_totals(db, campaign=campaign)

    await db.refresh(notification)
    return notification


def push_delivery_result_from_model(delivery: PushDelivery) -> PushDeliveryResult:
    return PushDeliveryResult(
        subscription_id=delivery.subscription_id,
        expo_push_token=delivery.expo_push_token,
        status=delivery.status,
        is_active=delivery.is_active,
        ticket_id=delivery.ticket_id,
        message=delivery.message,
        error=delivery.error,
        receipt_status=delivery.receipt_status,
        receipt_message=delivery.receipt_message,
        receipt_error=delivery.receipt_error,
        receipt_checked_at=delivery.receipt_checked_at,
    )


async def store_push_delivery_results(
    db: AsyncSession,
    *,
    notification: Notification,
    deliveries: Sequence[PushDeliveryResult],
) -> list[PushDelivery]:
    records: list[PushDelivery] = []
    for delivery in deliveries:
        record = PushDelivery(
            tenant_id=notification.tenant_id,
            user_id=notification.user_id,
            notification_id=notification.id,
            subscription_id=delivery.subscription_id,
            expo_push_token=delivery.expo_push_token,
            status=delivery.status,
            is_active=delivery.is_active,
            ticket_id=delivery.ticket_id,
            message=delivery.message,
            error=delivery.error,
            receipt_status=delivery.receipt_status,
            receipt_message=delivery.receipt_message,
            receipt_error=delivery.receipt_error,
            receipt_checked_at=delivery.receipt_checked_at,
        )
        db.add(record)
        records.append(record)

    await db.flush()
    return records


async def send_notification_via_expo(
    notification: Notification,
    subscriptions: Sequence[PushSubscription],
    *,
    http_client: httpx.AsyncClient | None = None,
) -> list[PushDeliveryResult]:
    deliveries: list[PushDeliveryResult] = []
    valid_subscriptions: list[PushSubscription] = []

    for subscription in subscriptions:
        if _is_expo_push_token(subscription.expo_push_token):
            valid_subscriptions.append(subscription)
            continue

        deliveries.append(
            PushDeliveryResult(
                subscription_id=subscription.id,
                expo_push_token=subscription.expo_push_token,
                status="error",
                is_active=subscription.is_active,
                error="InvalidExpoPushToken",
                message="El token registrado no tiene formato Expo valido.",
            )
        )

    if not valid_subscriptions:
        return deliveries

    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=settings.EXPO_PUSH_REQUEST_TIMEOUT_SECONDS)

    try:
        for subscription_chunk in _chunked(valid_subscriptions, 100):
            messages = [_build_expo_message(notification, subscription) for subscription in subscription_chunk]

            try:
                response = await client.post(
                    settings.EXPO_PUSH_API_URL,
                    json=messages,
                    headers=_request_headers(),
                )
            except httpx.HTTPError as exc:
                deliveries.extend(
                    PushDeliveryResult(
                        subscription_id=subscription.id,
                        expo_push_token=subscription.expo_push_token,
                        status="error",
                        is_active=subscription.is_active,
                        error="ExpoRequestError",
                        message=str(exc),
                    )
                    for subscription in subscription_chunk
                )
                continue

            payload: dict[str, Any] | None
            try:
                payload = response.json()
            except ValueError:
                payload = None

            if response.status_code >= 400 or (isinstance(payload, dict) and payload.get("errors")):
                error_code, error_message = _format_response_error(payload, response.status_code)
                deliveries.extend(
                    PushDeliveryResult(
                        subscription_id=subscription.id,
                        expo_push_token=subscription.expo_push_token,
                        status="error",
                        is_active=subscription.is_active,
                        error=error_code,
                        message=error_message,
                    )
                    for subscription in subscription_chunk
                )
                continue

            tickets = _normalize_ticket_payload(payload.get("data") if isinstance(payload, dict) else None)
            if len(tickets) != len(subscription_chunk):
                deliveries.extend(
                    PushDeliveryResult(
                        subscription_id=subscription.id,
                        expo_push_token=subscription.expo_push_token,
                        status="error",
                        is_active=subscription.is_active,
                        error="MalformedExpoResponse",
                        message="Expo devolvio una cantidad inesperada de tickets para este lote.",
                    )
                    for subscription in subscription_chunk
                )
                continue

            for subscription, ticket in zip(subscription_chunk, tickets):
                details = ticket.get("details") if isinstance(ticket.get("details"), dict) else {}
                error_code = details.get("error") if isinstance(details.get("error"), str) else None
                status = str(ticket.get("status", "error"))
                if error_code == "DeviceNotRegistered":
                    subscription.is_active = False

                deliveries.append(
                    PushDeliveryResult(
                        subscription_id=subscription.id,
                        expo_push_token=subscription.expo_push_token,
                        status=status,
                        is_active=subscription.is_active,
                        ticket_id=str(ticket.get("id")) if ticket.get("id") else None,
                        message=str(ticket.get("message")) if ticket.get("message") else None,
                        error=error_code,
                        receipt_status="pending" if status == "ok" and ticket.get("id") else None,
                    )
                )
    finally:
        if owns_client:
            await client.aclose()

    return deliveries


async def create_and_dispatch_notification(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    campaign_id: UUID | None = None,
    title: str,
    message: str | None = None,
    type: str = "info",
    action_url: str | None = None,
    send_push: bool = True,
    http_client: httpx.AsyncClient | None = None,
) -> NotificationDispatchResult:
    notification = await create_notification_record(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        campaign_id=campaign_id,
        title=title,
        message=message,
        type=type,
        action_url=action_url,
    )

    deliveries: list[PushDeliveryResult] = []
    if send_push:
        subscriptions = await list_active_push_subscriptions(db, tenant_id=tenant_id, user_id=user_id)
        deliveries = await send_notification_via_expo(
            notification,
            subscriptions,
            http_client=http_client,
        )
        await store_push_delivery_results(
            db,
            notification=notification,
            deliveries=deliveries,
        )

    await db.flush()
    await db.refresh(notification)
    return NotificationDispatchResult(notification=notification, deliveries=deliveries)


async def get_notification_dispatch_result(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    notification_id: UUID,
) -> NotificationDispatchResult:
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.tenant_id != tenant_id:
        raise LookupError("Notification not found")

    deliveries = await list_push_deliveries_for_notification(
        db,
        tenant_id=tenant_id,
        notification_id=notification_id,
    )
    return NotificationDispatchResult(
        notification=notification,
        deliveries=[push_delivery_result_from_model(delivery) for delivery in deliveries],
    )


async def refresh_push_receipts(
    db: AsyncSession,
    *,
    tenant_id: UUID | None = None,
    notification_id: UUID | None = None,
    limit: int | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> int:
    query = select(PushDelivery).where(
        PushDelivery.ticket_id.is_not(None),
        PushDelivery.status == "ok",
        or_(PushDelivery.receipt_status.is_(None), PushDelivery.receipt_status == "pending"),
    )

    if tenant_id is not None:
        query = query.where(PushDelivery.tenant_id == tenant_id)
    if notification_id is not None:
        query = query.where(PushDelivery.notification_id == notification_id)

    deliveries = (
        await db.execute(
            query.order_by(PushDelivery.created_at.asc()).limit(limit or settings.EXPO_PUSH_RECEIPT_POLL_LIMIT)
        )
    ).scalars().all()

    pending_deliveries = [delivery for delivery in deliveries if delivery.ticket_id]
    if not pending_deliveries:
        return 0

    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=settings.EXPO_PUSH_REQUEST_TIMEOUT_SECONDS)

    try:
        updated = 0
        for chunk_start in range(0, len(pending_deliveries), settings.EXPO_PUSH_RECEIPT_BATCH_SIZE):
            delivery_chunk = pending_deliveries[chunk_start:chunk_start + settings.EXPO_PUSH_RECEIPT_BATCH_SIZE]
            ticket_ids = [delivery.ticket_id for delivery in delivery_chunk if delivery.ticket_id]
            if not ticket_ids:
                continue

            try:
                response = await client.post(
                    settings.EXPO_PUSH_RECEIPTS_API_URL,
                    json={"ids": ticket_ids},
                    headers=_request_headers(),
                )
            except httpx.HTTPError:
                continue

            try:
                payload = response.json()
            except ValueError:
                payload = None

            if response.status_code >= 400 or not isinstance(payload, dict):
                continue

            receipts = _normalize_receipt_payload(payload.get("data"))
            if not receipts:
                continue

            subscription_ids = [delivery.subscription_id for delivery in delivery_chunk]
            subscriptions = {
                subscription.id: subscription
                for subscription in (
                    await db.execute(select(PushSubscription).where(PushSubscription.id.in_(subscription_ids)))
                ).scalars().all()
            } if subscription_ids else {}

            for delivery in delivery_chunk:
                receipt = receipts.get(delivery.ticket_id or "")
                if not receipt:
                    continue

                details = receipt.get("details") if isinstance(receipt.get("details"), dict) else {}
                error_code = details.get("error") if isinstance(details.get("error"), str) else None
                receipt_status = str(receipt.get("status", "error"))

                delivery.receipt_status = receipt_status
                delivery.receipt_message = str(receipt.get("message")) if receipt.get("message") else None
                delivery.receipt_error = error_code
                delivery.receipt_checked_at = datetime.now(timezone.utc)

                subscription = subscriptions.get(delivery.subscription_id)
                if error_code == "DeviceNotRegistered" and subscription is not None:
                    subscription.is_active = False
                    delivery.is_active = False
                elif subscription is not None:
                    delivery.is_active = subscription.is_active

                updated += 1

        await db.flush()
        return updated
    finally:
        if owns_client:
            await client.aclose()
