"""Campaign scheduling and broadcast helpers."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import async_session_factory
from app.models.business import Campaign, CampaignStatus
from app.models.user import User, UserRole
from app.services.push_notification_service import NotificationDispatchResult, create_and_dispatch_notification

logger = logging.getLogger(__name__)
settings = get_settings()

DEFAULT_CAMPAIGN_NOTIFICATION_TYPE = "info"
DISPATCH_TRIGGER_MANUAL = "manual"
DISPATCH_TRIGGER_SCHEDULED = "scheduled"


@dataclass
class CampaignDispatchRecipientResult:
    user: User
    dispatch_result: NotificationDispatchResult


@dataclass
class CampaignDispatchSummary:
    total_recipients: int
    total_notifications: int
    total_push_deliveries: int
    accepted_push_deliveries: int
    recipients: list[CampaignDispatchRecipientResult]


def _normalize_dispatch_error(exc: Exception) -> str:
    message = str(exc).strip()
    if not message:
        message = exc.__class__.__name__
    return message[:2000]


def mark_campaign_dispatch_started(
    campaign: Campaign,
    *,
    trigger: str,
    started_at: datetime,
) -> CampaignStatus:
    previous_status = campaign.status
    campaign.status = CampaignStatus.SENDING
    campaign.last_dispatch_trigger = trigger
    campaign.last_dispatch_attempted_at = started_at
    campaign.last_dispatch_finished_at = None
    campaign.last_dispatch_error = None
    campaign.dispatch_attempts = int(campaign.dispatch_attempts or 0) + 1
    return previous_status


def mark_campaign_dispatch_succeeded(
    campaign: Campaign,
    *,
    recipients_count: int,
    sent_count: int,
    finished_at: datetime,
) -> None:
    campaign.total_recipients = recipients_count
    campaign.total_sent = sent_count
    campaign.status = CampaignStatus.SENT
    campaign.sent_at = finished_at
    campaign.last_dispatch_finished_at = finished_at
    campaign.last_dispatch_error = None


def mark_campaign_dispatch_failed(
    campaign: Campaign,
    *,
    exc: Exception,
    finished_at: datetime,
    failure_status: CampaignStatus,
) -> None:
    campaign.status = failure_status
    campaign.last_dispatch_finished_at = finished_at
    campaign.last_dispatch_error = _normalize_dispatch_error(exc)


def _coerce_campaign_status(value: CampaignStatus | str | None) -> CampaignStatus | None:
    if value is None:
        return None
    if isinstance(value, CampaignStatus):
        return value
    try:
        return CampaignStatus(str(value))
    except ValueError:
        return None


def parse_segment_filter(raw_value: str | None) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def serialize_segment_filter(value: dict[str, Any] | None) -> str | None:
    return json.dumps(value) if value else None


def normalize_campaign_status(
    *,
    current_status: CampaignStatus | str | None = None,
    requested_status: CampaignStatus | str | None = None,
    scheduled_at: datetime | None = None,
) -> CampaignStatus:
    current = _coerce_campaign_status(current_status)
    requested = _coerce_campaign_status(requested_status)

    if requested in {CampaignStatus.SENT, CampaignStatus.CANCELLED}:
        return requested
    if scheduled_at is not None:
        return CampaignStatus.SCHEDULED
    if requested == CampaignStatus.SCHEDULED:
        return CampaignStatus.DRAFT
    if requested is not None:
        return requested
    if current == CampaignStatus.SCHEDULED:
        return CampaignStatus.DRAFT
    return current or CampaignStatus.DRAFT


def build_campaign_dispatch_config(campaign: Campaign) -> dict[str, Any]:
    title = (campaign.subject or campaign.name or "Campana").strip()
    return {
        "title": title or "Campana",
        "message": campaign.content,
        "notification_type": campaign.notification_type or DEFAULT_CAMPAIGN_NOTIFICATION_TYPE,
        "action_url": campaign.action_url,
        "send_push": campaign.send_push,
    }


async def resolve_campaign_segment_user_ids(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    segment_filter: dict[str, Any],
) -> list[UUID]:
    query = select(User.id).where(User.tenant_id == tenant_id, User.role == UserRole.CLIENT)

    status_filter = str(segment_filter.get("status", "active")).lower()
    if status_filter == "active":
        query = query.where(User.is_active == True)
    elif status_filter == "inactive":
        query = query.where(User.is_active == False)

    search_term = str(segment_filter.get("search", "")).strip()
    if search_term:
        query = query.where(
            User.first_name.ilike(f"%{search_term}%")
            | User.last_name.ilike(f"%{search_term}%")
            | User.email.ilike(f"%{search_term}%")
            | User.phone.ilike(f"%{search_term}%")
        )

    result = await db.execute(query.order_by(User.created_at.desc()).limit(200))
    return list(result.scalars().all())


async def dispatch_campaign_broadcast(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    title: str,
    message: str | None = None,
    notification_type: str = DEFAULT_CAMPAIGN_NOTIFICATION_TYPE,
    action_url: str | None = None,
    send_push: bool = True,
    user_ids: list[UUID] | None = None,
    campaign: Campaign | None = None,
    allow_empty: bool = False,
    dispatch_trigger: str = DISPATCH_TRIGGER_MANUAL,
    mark_started: bool = True,
    failure_status: CampaignStatus | None = None,
) -> CampaignDispatchSummary:
    previous_status = campaign.status if campaign else None
    resolved_failure_status = failure_status or previous_status or CampaignStatus.DRAFT

    if campaign and mark_started:
        mark_campaign_dispatch_started(
            campaign,
            trigger=dispatch_trigger,
            started_at=datetime.now(timezone.utc),
        )
        await db.flush()

    try:
        unique_user_ids = list(dict.fromkeys(user_ids or []))

        if not unique_user_ids and campaign and campaign.segment_filter:
            unique_user_ids = await resolve_campaign_segment_user_ids(
                db,
                tenant_id=tenant_id,
                segment_filter=parse_segment_filter(campaign.segment_filter),
            )

        if not unique_user_ids:
            if not allow_empty:
                raise ValueError("No recipients were resolved for this broadcast")

            if campaign:
                mark_campaign_dispatch_succeeded(
                    campaign,
                    recipients_count=0,
                    sent_count=0,
                    finished_at=datetime.now(timezone.utc),
                )

            await db.flush()
            return CampaignDispatchSummary(
                total_recipients=0,
                total_notifications=0,
                total_push_deliveries=0,
                accepted_push_deliveries=0,
                recipients=[],
            )

        recipients = (
            await db.execute(
                select(User).where(
                    User.tenant_id == tenant_id,
                    User.id.in_(unique_user_ids),
                    User.role == UserRole.CLIENT,
                )
            )
        ).scalars().all()
        recipient_map = {recipient.id: recipient for recipient in recipients}
        missing_user_ids = [user_id for user_id in unique_user_ids if user_id not in recipient_map]

        if missing_user_ids:
            raise LookupError("Some clients were not found for this tenant")

        recipient_payloads: list[CampaignDispatchRecipientResult] = []
        accepted_push_deliveries = 0
        total_push_deliveries = 0

        for user_id in unique_user_ids:
            recipient = recipient_map[user_id]
            result = await create_and_dispatch_notification(
                db,
                tenant_id=tenant_id,
                user_id=recipient.id,
                campaign_id=campaign.id if campaign else None,
                title=title,
                message=message,
                type=notification_type,
                action_url=action_url,
                send_push=send_push,
            )
            recipient_payloads.append(CampaignDispatchRecipientResult(user=recipient, dispatch_result=result))
            total_push_deliveries += len(result.deliveries)
            accepted_push_deliveries += sum(1 for delivery in result.deliveries if delivery.status == "ok")

        if campaign:
            mark_campaign_dispatch_succeeded(
                campaign,
                recipients_count=len(unique_user_ids),
                sent_count=len(recipient_payloads),
                finished_at=datetime.now(timezone.utc),
            )

        await db.flush()
        return CampaignDispatchSummary(
            total_recipients=len(unique_user_ids),
            total_notifications=len(recipient_payloads),
            total_push_deliveries=total_push_deliveries,
            accepted_push_deliveries=accepted_push_deliveries,
            recipients=recipient_payloads,
        )
    except Exception as exc:
        if campaign:
            mark_campaign_dispatch_failed(
                campaign,
                exc=exc,
                finished_at=datetime.now(timezone.utc),
                failure_status=resolved_failure_status,
            )
            await db.flush()
        raise


async def run_due_campaigns(*, batch_size: int | None = None) -> int:
    limit = batch_size or settings.CAMPAIGN_SCHEDULER_BATCH_SIZE
    now = datetime.now(timezone.utc)

    async with async_session_factory() as db:
        result = await db.execute(
            select(Campaign)
            .where(
                Campaign.status == CampaignStatus.SCHEDULED,
                Campaign.scheduled_at.is_not(None),
                Campaign.scheduled_at <= now,
            )
            .order_by(Campaign.scheduled_at.asc(), Campaign.created_at.asc())
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        due_campaigns = list(result.scalars().all())
        due_campaign_ids = [campaign.id for campaign in due_campaigns]

        for campaign in due_campaigns:
            mark_campaign_dispatch_started(
                campaign,
                trigger=DISPATCH_TRIGGER_SCHEDULED,
                started_at=now,
            )

        await db.commit()

    processed = 0
    for campaign_id in due_campaign_ids:
        async with async_session_factory() as db:
            campaign = await db.get(Campaign, campaign_id)
            if campaign is None or campaign.status != CampaignStatus.SENDING:
                continue

            try:
                await dispatch_campaign_broadcast(
                    db,
                    tenant_id=campaign.tenant_id,
                    campaign=campaign,
                    user_ids=[],
                    allow_empty=True,
                    dispatch_trigger=DISPATCH_TRIGGER_SCHEDULED,
                    mark_started=False,
                    failure_status=CampaignStatus.SCHEDULED,
                    **build_campaign_dispatch_config(campaign),
                )
                await db.commit()
                processed += 1
            except Exception:
                await db.rollback()
                logger.exception("Scheduled campaign dispatch failed", extra={"campaign_id": str(campaign_id)})

    return processed
