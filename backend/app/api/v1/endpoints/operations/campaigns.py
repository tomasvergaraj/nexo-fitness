"""Campaigns router: list, overview, create, update."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import (
    TenantContext,
    get_current_user,
    get_tenant_context,
    require_roles,
)
from app.models.business import Campaign, CampaignStatus
from app.models.platform import PushDelivery
from app.models.user import User
from app.schemas.business import (
    CampaignCreate,
    CampaignResponse,
    PaginatedResponse,
)
from app.schemas.platform import (
    CampaignOverviewResponse,
    CampaignUpdateRequest,
)
from app.services.campaign_service import (
    DISPATCH_TRIGGER_MANUAL,
    DISPATCH_TRIGGER_SCHEDULED,
    normalize_campaign_status,
    parse_segment_filter,
    serialize_segment_filter,
)


campaigns_router = APIRouter(prefix="/campaigns", tags=["Campaigns"])


def _campaign_payload(campaign: Campaign) -> CampaignResponse:
    return CampaignResponse(
        id=campaign.id,
        name=campaign.name,
        subject=campaign.subject,
        content=campaign.content,
        channel=str(campaign.channel.value if hasattr(campaign.channel, "value") else campaign.channel),
        status=str(campaign.status.value if hasattr(campaign.status, "value") else campaign.status),
        total_recipients=campaign.total_recipients,
        total_sent=campaign.total_sent,
        total_opened=campaign.total_opened,
        total_clicked=campaign.total_clicked,
        segment_filter=parse_segment_filter(campaign.segment_filter),
        notification_type=campaign.notification_type,
        action_url=campaign.action_url,
        send_push=campaign.send_push,
        scheduled_at=campaign.scheduled_at,
        sent_at=campaign.sent_at,
        last_dispatch_trigger=campaign.last_dispatch_trigger,
        last_dispatch_attempted_at=campaign.last_dispatch_attempted_at,
        last_dispatch_finished_at=campaign.last_dispatch_finished_at,
        last_dispatch_error=campaign.last_dispatch_error,
        dispatch_attempts=campaign.dispatch_attempts,
        created_at=campaign.created_at,
    )


@campaigns_router.get("", response_model=PaginatedResponse)
async def list_campaigns(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "marketing")),
):
    total = (
        await db.execute(
            select(func.count()).select_from(Campaign).where(Campaign.tenant_id == ctx.tenant_id)
        )
    ).scalar() or 0
    campaigns = (
        await db.execute(
            select(Campaign)
            .where(Campaign.tenant_id == ctx.tenant_id)
            .order_by(Campaign.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).scalars().all()
    return PaginatedResponse(
        items=[_campaign_payload(campaign) for campaign in campaigns],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@campaigns_router.get("/overview", response_model=CampaignOverviewResponse)
async def get_campaigns_overview(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "marketing")),
):
    campaigns = (
        await db.execute(select(Campaign).where(Campaign.tenant_id == ctx.tenant_id))
    ).scalars().all()

    sent_total = sum(int(campaign.total_sent or 0) for campaign in campaigns)
    opened_total = sum(int(campaign.total_opened or 0) for campaign in campaigns)
    clicked_total = sum(int(campaign.total_clicked or 0) for campaign in campaigns)

    pending_push_receipts = (
        await db.execute(
            select(func.count()).select_from(PushDelivery).where(
                PushDelivery.tenant_id == ctx.tenant_id,
                PushDelivery.status == "ok",
                or_(PushDelivery.receipt_status.is_(None), PushDelivery.receipt_status == "pending"),
            )
        )
    ).scalar() or 0
    failed_push_receipts = (
        await db.execute(
            select(func.count()).select_from(PushDelivery).where(
                PushDelivery.tenant_id == ctx.tenant_id,
                PushDelivery.receipt_status == "error",
            )
        )
    ).scalar() or 0

    return CampaignOverviewResponse(
        total_campaigns=len(campaigns),
        scheduled_pending=sum(1 for campaign in campaigns if campaign.status == CampaignStatus.SCHEDULED),
        sending_now=sum(1 for campaign in campaigns if campaign.status == CampaignStatus.SENDING),
        sent_total=sent_total,
        opened_total=opened_total,
        clicked_total=clicked_total,
        manual_runs=sum(
            1
            for campaign in campaigns
            if campaign.last_dispatch_trigger == DISPATCH_TRIGGER_MANUAL
            and campaign.last_dispatch_finished_at is not None
            and not campaign.last_dispatch_error
        ),
        scheduler_runs=sum(
            1
            for campaign in campaigns
            if campaign.last_dispatch_trigger == DISPATCH_TRIGGER_SCHEDULED
            and campaign.last_dispatch_finished_at is not None
            and not campaign.last_dispatch_error
        ),
        scheduler_failures=sum(
            1
            for campaign in campaigns
            if campaign.last_dispatch_trigger == DISPATCH_TRIGGER_SCHEDULED and bool(campaign.last_dispatch_error)
        ),
        pending_push_receipts=int(pending_push_receipts),
        failed_push_receipts=int(failed_push_receipts),
        open_rate=round((opened_total / sent_total) * 100, 1) if sent_total else 0.0,
        click_rate=round((clicked_total / sent_total) * 100, 1) if sent_total else 0.0,
    )


@campaigns_router.post("", response_model=CampaignResponse, status_code=201)
async def create_campaign(
    data: CampaignCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
    _user=Depends(require_roles("owner", "admin", "marketing")),
):
    normalized_status = normalize_campaign_status(
        requested_status=data.status,
        scheduled_at=data.scheduled_at,
    )
    campaign = Campaign(
        tenant_id=ctx.tenant_id,
        name=data.name,
        subject=data.subject,
        content=data.content,
        channel=data.channel,
        status=normalized_status,
        segment_filter=serialize_segment_filter(data.segment_filter),
        notification_type=data.notification_type,
        action_url=data.action_url,
        send_push=data.send_push,
        scheduled_at=data.scheduled_at,
        total_recipients=data.total_recipients,
        total_sent=data.total_sent,
        total_opened=data.total_opened,
        total_clicked=data.total_clicked,
        created_by=current_user.id,
    )
    db.add(campaign)
    await db.flush()
    await db.refresh(campaign)
    return _campaign_payload(campaign)


@campaigns_router.patch("/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(
    campaign_id: UUID,
    data: CampaignUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "marketing")),
):
    campaign = await db.get(Campaign, campaign_id)
    if not campaign or campaign.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Campaña no encontrada")

    previous_status = campaign.status
    payload = data.model_dump(exclude_unset=True)
    if "segment_filter" in payload:
        payload["segment_filter"] = serialize_segment_filter(payload["segment_filter"])
    scheduled_at = payload.get("scheduled_at", campaign.scheduled_at)
    payload["status"] = normalize_campaign_status(
        current_status=campaign.status,
        requested_status=payload.get("status"),
        scheduled_at=scheduled_at,
    )

    if payload["status"] != CampaignStatus.SENT:
        campaign.sent_at = None
        if "total_recipients" not in payload:
            campaign.total_recipients = 0
        if "total_sent" not in payload:
            campaign.total_sent = 0
        if "total_opened" not in payload and previous_status == CampaignStatus.SENT:
            campaign.total_opened = 0
        if "total_clicked" not in payload and previous_status == CampaignStatus.SENT:
            campaign.total_clicked = 0

    for field, value in payload.items():
        setattr(campaign, field, value)

    await db.flush()
    await db.refresh(campaign)
    return _campaign_payload(campaign)
