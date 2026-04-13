"""Push notification helpers for Expo and Web Push providers."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence
from urllib.parse import parse_qs, urlencode, urlparse
from uuid import UUID

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    import pywebpush as pywebpush_module
    from pywebpush import WebPushException, webpush
except ImportError:  # pragma: no cover - optional dependency in local dev
    pywebpush_module = None
    WebPushException = Exception
    webpush = None

from app.core.config import get_settings
from app.models.business import Campaign, Notification
from app.models.platform import PushDelivery, PushSubscription
from app.models.user import User, UserRole

settings = get_settings()

EXPO_PUSH_TOKEN_RE = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$")
_PYWEBPUSH_CURVE_COMPAT_PATCHED = False


@dataclass
class PushDeliveryResult:
    subscription_id: UUID
    provider: str
    delivery_target: str
    expo_push_token: str | None
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


def _is_expo_push_token(token: str | None) -> bool:
    return bool(token and EXPO_PUSH_TOKEN_RE.match(token.strip()))


def _subscription_target(subscription: PushSubscription) -> str:
    return subscription.expo_push_token or subscription.web_endpoint or ""


def _is_web_push_subscription(subscription: PushSubscription) -> bool:
    return bool(subscription.web_endpoint and subscription.web_p256dh_key and subscription.web_auth_key)


def _needs_pywebpush_curve_compatibility(exc: Exception) -> bool:
    return isinstance(exc, TypeError) and "curve must be an EllipticCurve instance" in str(exc)


def _patch_pywebpush_curve_compatibility() -> bool:
    global _PYWEBPUSH_CURVE_COMPAT_PATCHED

    if _PYWEBPUSH_CURVE_COMPAT_PATCHED or pywebpush_module is None:
        return False

    web_pusher = getattr(pywebpush_module, "WebPusher", None)
    if web_pusher is None:
        return False

    def _encode_with_curve_instance(self, data, content_encoding="aes128gcm"):
        if not data:
            self.verb("No data found...")
            return None
        if not self.auth_key or not self.receiver_key:
            raise WebPushException("No keys specified in subscription info")

        self.verb("Encoding data...")
        salt = None
        if content_encoding not in self.valid_encodings:
            raise WebPushException(
                "Invalid content encoding specified. Select from "
                + json.dumps(self.valid_encodings)
            )
        if content_encoding == "aesgcm":
            self.verb("Generating salt for aesgcm...")
            salt = pywebpush_module.os.urandom(16)

        # pywebpush<=1.14 passes the curve class instead of an instance here,
        # which breaks with newer cryptography releases.
        server_key = pywebpush_module.ec.generate_private_key(
            pywebpush_module.ec.SECP256R1(),
            pywebpush_module.default_backend(),
        )
        crypto_key = server_key.public_key().public_bytes(
            encoding=pywebpush_module.serialization.Encoding.X962,
            format=pywebpush_module.serialization.PublicFormat.UncompressedPoint,
        )

        if isinstance(data, pywebpush_module.six.text_type):
            data = bytes(data.encode("utf8"))

        if content_encoding == "aes128gcm":
            self.verb("Encrypting to aes128gcm...")
            encrypted = pywebpush_module.http_ece.encrypt(
                data,
                salt=salt,
                private_key=server_key,
                dh=self.receiver_key,
                auth_secret=self.auth_key,
                version=content_encoding,
            )
            return pywebpush_module.CaseInsensitiveDict({"body": encrypted})

        self.verb("Encrypting to aesgcm...")
        crypto_key = pywebpush_module.base64.urlsafe_b64encode(crypto_key).strip(b"=")
        encrypted = pywebpush_module.http_ece.encrypt(
            data,
            salt=salt,
            private_key=server_key,
            keyid=crypto_key.decode(),
            dh=self.receiver_key,
            auth_secret=self.auth_key,
            version=content_encoding,
        )
        reply = pywebpush_module.CaseInsensitiveDict(
            {
                "crypto_key": crypto_key,
                "body": encrypted,
            }
        )
        if salt:
            reply["salt"] = pywebpush_module.base64.urlsafe_b64encode(salt).strip(b"=")
        return reply

    web_pusher.encode = _encode_with_curve_instance
    _PYWEBPUSH_CURVE_COMPAT_PATCHED = True
    return True


def _dispatch_webpush_request(
    *,
    subscription_info: dict[str, Any],
    payload: str,
    vapid_claims: dict[str, Any],
):
    if webpush is None:
        raise RuntimeError("webpush no esta disponible")

    try:
        return webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=settings.WEB_PUSH_VAPID_PRIVATE_KEY.strip(),
            vapid_claims=vapid_claims,
            ttl=60,
        )
    except TypeError as exc:
        if not _needs_pywebpush_curve_compatibility(exc) or not _patch_pywebpush_curve_compatibility():
            raise

        return webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=settings.WEB_PUSH_VAPID_PRIVATE_KEY.strip(),
            vapid_claims=vapid_claims,
            ttl=60,
        )


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


def _default_webpush_route(role: UserRole | None) -> str:
    if role == UserRole.CLIENT:
        return "/member?tab=notifications"
    if role == UserRole.SUPERADMIN:
        return "/platform/tenants"
    return "/dashboard"


def _map_staff_tab_to_route(tab: str | None) -> str:
    if tab == "agenda":
        return "/classes"
    if tab == "payments":
        return "/reports"
    if tab in {"plans", "store", "checkout"}:
        return "/plans"
    if tab == "support":
        return "/support"
    if tab == "profile":
        return "/settings"
    if tab == "programs":
        return "/programs"
    if tab == "clients":
        return "/clients"
    if tab == "reports":
        return "/reports"
    if tab == "promo-codes":
        return "/promo-codes"
    if tab == "settings":
        return "/settings"
    return "/dashboard"


def _build_member_route(params: dict[str, str]) -> str:
    next_params = {"tab": params.get("tab") or "notifications"}
    for key, value in params.items():
        if key != "tab" and value:
            next_params[key] = value
    return f"/member?{urlencode(next_params)}"


def _extract_action_parts(action_url: str | None) -> tuple[str | None, dict[str, str], str | None]:
    raw = (action_url or "").strip()
    if not raw:
        return None, {}, None

    if raw.startswith(("http://", "https://")):
        return None, {}, raw

    if raw.startswith("/"):
        return raw, {}, None

    if raw.startswith("?"):
        params = {key: values[-1] for key, values in parse_qs(raw[1:], keep_blank_values=True).items()}
        return "", params, None

    if raw.startswith("nexofitness://"):
        parsed = urlparse(raw)
        path_parts = [parsed.netloc, parsed.path.lstrip("/")]
        path = "/".join(part for part in path_parts if part).lower()
        params = {key: values[-1] for key, values in parse_qs(parsed.query, keep_blank_values=True).items()}
        return path, params, None

    return raw.lower(), {}, None


def _resolve_webpush_target_url(action_url: str | None, recipient_role: UserRole | None) -> str:
    path, params, absolute_url = _extract_action_parts(action_url)
    if absolute_url:
        return absolute_url

    if path and path.startswith("/"):
        return path

    if recipient_role == UserRole.CLIENT:
        if not path and params:
            return _build_member_route(params)

        client_params = dict(params)
        if path:
            if "agenda" in path or "class" in path:
                client_params["tab"] = "agenda"
            elif "support" in path:
                client_params["tab"] = "support"
            elif "payments" in path:
                client_params["tab"] = "payments"
            elif any(section in path for section in {"store", "checkout", "plans"}):
                client_params["tab"] = "plans"
            elif "account/profile" in path or "profile" in path:
                client_params["tab"] = "profile"
            elif "program" in path:
                client_params["tab"] = "programs"
            elif "progress" in path:
                client_params["tab"] = "progress"
        return _build_member_route(client_params)

    if recipient_role == UserRole.SUPERADMIN:
        if path and path.startswith("platform/"):
            return f"/{path}"
        if path and "plan" in path:
            return "/platform/plans"
        if path and "lead" in path:
            return "/platform/leads"
        return "/platform/tenants"

    if path and path.startswith("platform/"):
        return f"/{path}"
    if not path and params:
        return _map_staff_tab_to_route(params.get("tab"))
    if path and ("agenda" in path or "class" in path):
        return "/classes"
    if path and "support" in path:
        return "/support"
    if path and "payments" in path:
        return "/reports"
    if path and any(section in path for section in {"store", "checkout", "plans"}):
        return "/plans"
    if path and ("account/profile" in path or "profile" in path):
        return "/settings"
    if path and "program" in path:
        return "/programs"
    if path and "report" in path:
        return "/reports"
    if path and "promo" in path:
        return "/promo-codes"
    if path and "client" in path:
        return "/clients"
    if path and "setting" in path:
        return "/settings"
    if path and "dashboard" in path:
        return "/dashboard"
    return _default_webpush_route(recipient_role)


def _build_webpush_payload(notification: Notification, recipient_role: UserRole | None) -> dict[str, Any]:
    body = notification.message or notification.title
    return {
        "title": notification.title,
        "body": body,
        "message": notification.message,
        "url": _resolve_webpush_target_url(notification.action_url, recipient_role),
        "notification_id": str(notification.id),
        "campaign_id": str(notification.campaign_id) if notification.campaign_id else None,
        "type": notification.type,
        "tag": f"notification-{notification.id}",
        "action_url": notification.action_url,
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
        provider=delivery.provider,
        delivery_target=delivery.delivery_target,
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
            provider=delivery.provider,
            delivery_target=delivery.delivery_target,
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
                provider="expo",
                delivery_target=_subscription_target(subscription),
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
                        provider="expo",
                        delivery_target=_subscription_target(subscription),
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
                        provider="expo",
                        delivery_target=_subscription_target(subscription),
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
                        provider="expo",
                        delivery_target=_subscription_target(subscription),
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
                        provider="expo",
                        delivery_target=_subscription_target(subscription),
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


async def send_notification_via_webpush(
    notification: Notification,
    subscriptions: Sequence[PushSubscription],
    *,
    recipient_role: UserRole | None = None,
) -> list[PushDeliveryResult]:
    deliveries: list[PushDeliveryResult] = []

    if webpush is None:
        return [
            PushDeliveryResult(
                subscription_id=subscription.id,
                provider="webpush",
                delivery_target=_subscription_target(subscription),
                expo_push_token=subscription.expo_push_token,
                status="error",
                is_active=subscription.is_active,
                error="WebPushLibraryMissing",
                message="pywebpush no esta instalado en el backend.",
            )
            for subscription in subscriptions
        ]

    if not settings.WEB_PUSH_VAPID_PUBLIC_KEY.strip() or not settings.WEB_PUSH_VAPID_PRIVATE_KEY.strip():
        return [
            PushDeliveryResult(
                subscription_id=subscription.id,
                provider="webpush",
                delivery_target=_subscription_target(subscription),
                expo_push_token=subscription.expo_push_token,
                status="error",
                is_active=subscription.is_active,
                error="WebPushNotConfigured",
                message="Faltan las credenciales VAPID para Web Push.",
            )
            for subscription in subscriptions
        ]

    payload = json.dumps(_build_webpush_payload(notification, recipient_role))
    vapid_claims = {"sub": settings.WEB_PUSH_VAPID_SUBJECT.strip() or "mailto:soporte@nexofitness.com"}

    for subscription in subscriptions:
        if not _is_web_push_subscription(subscription):
            deliveries.append(
                PushDeliveryResult(
                    subscription_id=subscription.id,
                    provider="webpush",
                    delivery_target=_subscription_target(subscription),
                    expo_push_token=subscription.expo_push_token,
                    status="error",
                    is_active=subscription.is_active,
                    error="InvalidWebPushSubscription",
                    message="La subscription web no tiene endpoint o llaves validas.",
                )
            )
            continue

        try:
            response = _dispatch_webpush_request(
                subscription_info={
                    "endpoint": subscription.web_endpoint,
                    "keys": {
                        "p256dh": subscription.web_p256dh_key,
                        "auth": subscription.web_auth_key,
                    },
                },
                payload=payload,
                vapid_claims=vapid_claims,
            )
            status_code = getattr(response, "status_code", 201)
            if status_code in (404, 410):
                subscription.is_active = False

            deliveries.append(
                PushDeliveryResult(
                    subscription_id=subscription.id,
                    provider="webpush",
                    delivery_target=_subscription_target(subscription),
                    expo_push_token=subscription.expo_push_token,
                    status="ok" if status_code < 400 else "error",
                    is_active=subscription.is_active,
                    message="Web Push enviado." if status_code < 400 else f"Web Push HTTP {status_code}",
                    error=None if status_code < 400 else "WebPushHttpError",
                )
            )
        except WebPushException as exc:  # type: ignore[misc]
            response = getattr(exc, "response", None)
            status_code = getattr(response, "status_code", None)
            if status_code in (404, 410):
                subscription.is_active = False

            deliveries.append(
                PushDeliveryResult(
                    subscription_id=subscription.id,
                    provider="webpush",
                    delivery_target=_subscription_target(subscription),
                    expo_push_token=subscription.expo_push_token,
                    status="error",
                    is_active=subscription.is_active,
                    error="WebPushSubscriptionExpired" if status_code in (404, 410) else "WebPushError",
                    message=str(exc),
                )
            )
        except Exception as exc:  # pragma: no cover - defensive fallback
            deliveries.append(
                PushDeliveryResult(
                    subscription_id=subscription.id,
                    provider="webpush",
                    delivery_target=_subscription_target(subscription),
                    expo_push_token=subscription.expo_push_token,
                    status="error",
                    is_active=subscription.is_active,
                    error="WebPushError",
                    message=str(exc),
                )
            )

    return deliveries


async def send_notification_via_push(
    notification: Notification,
    subscriptions: Sequence[PushSubscription],
    *,
    recipient_role: UserRole | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> list[PushDeliveryResult]:
    deliveries: list[PushDeliveryResult] = []
    expo_subscriptions = [subscription for subscription in subscriptions if subscription.provider == "expo"]
    webpush_subscriptions = [subscription for subscription in subscriptions if subscription.provider == "webpush"]

    unsupported_subscriptions = [
        subscription
        for subscription in subscriptions
        if subscription.provider not in {"expo", "webpush"}
    ]
    deliveries.extend(
        PushDeliveryResult(
            subscription_id=subscription.id,
            provider=subscription.provider,
            delivery_target=_subscription_target(subscription),
            expo_push_token=subscription.expo_push_token,
            status="error",
            is_active=subscription.is_active,
            error="UnsupportedPushProvider",
            message=f"El proveedor {subscription.provider} no esta soportado.",
        )
        for subscription in unsupported_subscriptions
    )

    if expo_subscriptions:
        deliveries.extend(await send_notification_via_expo(notification, expo_subscriptions, http_client=http_client))
    if webpush_subscriptions:
        deliveries.extend(
            await send_notification_via_webpush(
                notification,
                webpush_subscriptions,
                recipient_role=recipient_role,
            )
        )

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
        recipient = await db.get(User, user_id)
        subscriptions = await list_active_push_subscriptions(db, tenant_id=tenant_id, user_id=user_id)
        deliveries = await send_notification_via_push(
            notification,
            subscriptions,
            recipient_role=recipient.role if recipient else None,
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
        raise LookupError("Notificación no encontrada")

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
        PushDelivery.provider == "expo",
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
