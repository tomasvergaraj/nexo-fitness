"""Notifications router: list, create, dispatch, broadcast, update."""

from datetime import date, datetime, time, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_current_user,
    get_tenant_context,
    require_roles,
)
from app.models.business import Campaign, Notification
from app.models.user import User
from app.schemas.platform import (
    NotificationBroadcastRecipientResponse,
    NotificationBroadcastRequest,
    NotificationBroadcastResponse,
    NotificationCreateRequest,
    NotificationDispatchResponse,
    NotificationResponse,
    NotificationUpdateRequest,
)
from app.services.campaign_service import (
    CampaignDispatchRecipientResult,
    DISPATCH_TRIGGER_MANUAL,
    dispatch_campaign_broadcast,
)
from app.services.push_notification_service import (
    create_and_dispatch_notification,
    get_notification_dispatch_result,
    record_notification_engagement,
    refresh_push_receipts,
)

from ._common import _notification_dispatch_payload, _notification_payload


notifications_router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _notification_broadcast_recipient_payload(
    result: CampaignDispatchRecipientResult,
) -> NotificationBroadcastRecipientResponse:
    dispatch_payload = _notification_dispatch_payload(result.dispatch_result)
    return NotificationBroadcastRecipientResponse(
        user_id=result.user.id,
        user_name=result.user.full_name,
        notification=dispatch_payload.notification,
        push_deliveries=dispatch_payload.push_deliveries,
    )


@notifications_router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser mayor que la fecha final")

    query = (
        select(Notification)
        .where(Notification.tenant_id == ctx.tenant_id, Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
    )

    if date_from:
        query = query.where(Notification.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        query = query.where(Notification.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))

    result = await db.execute(query.limit(limit))
    return [_notification_payload(notification) for notification in result.scalars().all()]


@notifications_router.post("", response_model=NotificationDispatchResponse, status_code=201)
async def create_notification(
    data: NotificationCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer", "marketing")),
):
    recipient = await db.get(User, data.user_id)
    if not recipient or recipient.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    result = await create_and_dispatch_notification(
        db,
        tenant_id=ctx.tenant_id,
        user_id=recipient.id,
        title=data.title,
        message=data.message,
        type=data.type,
        action_url=data.action_url,
        send_push=data.send_push,
    )
    return _notification_dispatch_payload(result)


@notifications_router.get("/{notification_id}/dispatch", response_model=NotificationDispatchResponse)
async def get_notification_dispatch(
    notification_id: UUID,
    refresh_receipts_now: bool = Query(False, alias="refresh_receipts"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer", "marketing")),
):
    try:
        if refresh_receipts_now:
            await refresh_push_receipts(
                db,
                tenant_id=ctx.tenant_id,
                notification_id=notification_id,
            )
        result = await get_notification_dispatch_result(
            db,
            tenant_id=ctx.tenant_id,
            notification_id=notification_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return _notification_dispatch_payload(result)


@notifications_router.post("/broadcast", response_model=NotificationBroadcastResponse, status_code=201)
async def broadcast_notifications(
    data: NotificationBroadcastRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer", "marketing")),
):
    campaign: Campaign | None = None
    if data.campaign_id:
        campaign = await db.get(Campaign, data.campaign_id)
        if not campaign or campaign.tenant_id != ctx.tenant_id:
            raise HTTPException(status_code=404, detail="Campaña no encontrada")

    try:
        summary = await dispatch_campaign_broadcast(
            db,
            tenant_id=ctx.tenant_id,
            campaign=campaign,
            user_ids=data.user_ids,
            title=data.title,
            message=data.message,
            notification_type=data.type,
            action_url=data.action_url,
            send_push=data.send_push,
            dispatch_trigger=DISPATCH_TRIGGER_MANUAL,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return NotificationBroadcastResponse(
        total_recipients=summary.total_recipients,
        total_notifications=summary.total_notifications,
        total_push_deliveries=summary.total_push_deliveries,
        accepted_push_deliveries=summary.accepted_push_deliveries,
        errored_push_deliveries=summary.total_push_deliveries - summary.accepted_push_deliveries,
        campaign_id=campaign.id if campaign else None,
        recipients=[_notification_broadcast_recipient_payload(recipient) for recipient in summary.recipients],
    )


@notifications_router.patch("/{notification_id}", response_model=NotificationResponse)
async def update_notification(
    notification_id: UUID,
    data: NotificationUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    notification = await db.get(Notification, notification_id)
    if not notification or notification.tenant_id != ctx.tenant_id or notification.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")

    notification = await record_notification_engagement(
        db,
        notification=notification,
        is_read=data.is_read,
        mark_opened=data.mark_opened,
        mark_clicked=data.mark_clicked,
    )
    return _notification_payload(notification)
