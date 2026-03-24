"""Additional tenant operations endpoints for the complete gym platform."""

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import get_settings
from app.core.dependencies import (
    TenantContext,
    get_current_tenant,
    get_current_user,
    get_tenant_context,
    require_roles,
)
from app.models.business import (
    Branch,
    Campaign,
    CampaignStatus,
    CheckIn,
    ClassStatus,
    GymClass,
    Membership,
    MembershipStatus,
    Notification,
    Payment,
    PaymentStatus,
    Plan,
    Reservation,
    SupportInteraction,
    TrainingProgram,
)
from app.models.platform import PushDelivery, PushSubscription, TenantPaymentProviderAccount
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.business import (
    BranchCreate,
    BranchResponse,
    BranchUpdate,
    CampaignCreate,
    CampaignResponse,
    PaginatedResponse,
)
from app.schemas.platform import (
    CampaignOverviewResponse,
    CampaignUpdateRequest,
    MembershipCreateRequest,
    MembershipResponse,
    NotificationBroadcastRecipientResponse,
    NotificationBroadcastRequest,
    NotificationBroadcastResponse,
    MobilePushPreviewRequest,
    MobilePaymentHistoryItemResponse,
    MembershipUpdateRequest,
    MobileMembershipWalletResponse,
    NotificationCreateRequest,
    NotificationDispatchResponse,
    NotificationResponse,
    NotificationUpdateRequest,
    PaymentProviderAccountCreateRequest,
    PaymentProviderAccountResponse,
    PaymentProviderAccountUpdateRequest,
    PushDeliveryResponse,
    PushSubscriptionCreateRequest,
    PushSubscriptionResponse,
    ReportsOverviewResponse,
    ReportSeriesPoint,
    SupportInteractionCreateRequest,
    SupportInteractionResponse,
    SupportInteractionUpdateRequest,
    TenantSettingsResponse,
    TenantSettingsUpdateRequest,
    TrainingProgramCreateRequest,
    TrainingProgramResponse,
    TrainingProgramUpdateRequest,
    WebPushConfigResponse,
)
from app.services.campaign_service import (
    CampaignDispatchRecipientResult,
    DISPATCH_TRIGGER_MANUAL,
    DISPATCH_TRIGGER_SCHEDULED,
    dispatch_campaign_broadcast,
    normalize_campaign_status,
    parse_segment_filter,
    serialize_segment_filter,
)
from app.services.push_notification_service import NotificationDispatchResult, create_and_dispatch_notification
from app.services.push_notification_service import get_notification_dispatch_result, refresh_push_receipts
from app.services.push_notification_service import record_notification_engagement

branches_router = APIRouter(prefix="/branches", tags=["Branches"])
memberships_router = APIRouter(prefix="/memberships", tags=["Memberships"])
campaigns_router = APIRouter(prefix="/campaigns", tags=["Campaigns"])
support_router = APIRouter(prefix="/support/interactions", tags=["Support"])
programs_router = APIRouter(prefix="/programs", tags=["Programs"])
settings_router = APIRouter(prefix="/settings", tags=["Settings"])
reports_router = APIRouter(prefix="/reports", tags=["Reports"])
notifications_router = APIRouter(prefix="/notifications", tags=["Notifications"])
payment_accounts_router = APIRouter(prefix="/payment-provider/accounts", tags=["Payment Accounts"])
mobile_router = APIRouter(prefix="/mobile", tags=["Mobile"])
settings = get_settings()


def _loads_dict(raw_value: Optional[str]) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _loads_list(raw_value: Optional[str]) -> list[Any]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _feature_map(tenant: Tenant) -> dict[str, Any]:
    return _loads_dict(tenant.features)


def _save_feature_map(tenant: Tenant, values: dict[str, Any]) -> None:
    current = _feature_map(tenant)
    current.update(values)
    tenant.features = json.dumps(current)


def _notification_payload(notification: Notification) -> NotificationResponse:
    return NotificationResponse.model_validate(notification)


def _notification_dispatch_payload(result: NotificationDispatchResult) -> NotificationDispatchResponse:
    return NotificationDispatchResponse(
        notification=_notification_payload(result.notification),
        push_deliveries=[
            PushDeliveryResponse(
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
            for delivery in result.deliveries
        ],
    )


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


def _membership_payload(membership: Membership, user: Optional[User], plan: Optional[Plan]) -> MembershipResponse:
    return MembershipResponse(
        id=membership.id,
        user_id=membership.user_id,
        plan_id=membership.plan_id,
        status=membership.status.value if isinstance(membership.status, MembershipStatus) else str(membership.status),
        starts_at=membership.starts_at,
        expires_at=membership.expires_at,
        auto_renew=membership.auto_renew,
        frozen_until=membership.frozen_until,
        stripe_subscription_id=membership.stripe_subscription_id,
        created_at=membership.created_at,
        user_name=user.full_name if user else None,
        plan_name=plan.name if plan else None,
    )


def _program_payload(program: TrainingProgram, trainer: Optional[User]) -> TrainingProgramResponse:
    return TrainingProgramResponse(
        id=program.id,
        name=program.name,
        description=program.description,
        trainer_id=program.trainer_id,
        program_type=program.program_type,
        duration_weeks=program.duration_weeks,
        schedule=_loads_list(program.schedule_json),
        is_active=program.is_active,
        created_at=program.created_at,
        updated_at=program.updated_at,
        trainer_name=trainer.full_name if trainer else None,
    )


def _support_payload(
    interaction: SupportInteraction,
    client: Optional[User],
    handler: Optional[User],
) -> SupportInteractionResponse:
    return SupportInteractionResponse(
        id=interaction.id,
        user_id=interaction.user_id,
        channel=str(interaction.channel.value if hasattr(interaction.channel, "value") else interaction.channel),
        subject=interaction.subject,
        notes=interaction.notes,
        resolved=interaction.resolved,
        handled_by=interaction.handled_by,
        created_at=interaction.created_at,
        client_name=client.full_name if client else None,
        handler_name=handler.full_name if handler else None,
    )


def _payment_account_payload(account: TenantPaymentProviderAccount) -> PaymentProviderAccountResponse:
    return PaymentProviderAccountResponse(
        id=account.id,
        provider=account.provider,
        status=account.status,
        account_label=account.account_label,
        public_identifier=account.public_identifier,
        checkout_base_url=account.checkout_base_url,
        metadata=_loads_dict(account.metadata_json),
        is_default=account.is_default,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def _mobile_payment_payload(
    payment: Payment,
    membership: Optional[Membership],
    plan: Optional[Plan],
) -> MobilePaymentHistoryItemResponse:
    return MobilePaymentHistoryItemResponse(
        id=payment.id,
        user_id=payment.user_id,
        membership_id=payment.membership_id,
        amount=payment.amount,
        currency=payment.currency,
        status=payment.status.value if hasattr(payment.status, "value") else str(payment.status),
        method=payment.method.value if hasattr(payment.method, "value") else str(payment.method),
        description=payment.description,
        paid_at=payment.paid_at,
        created_at=payment.created_at,
        receipt_url=payment.receipt_url,
        external_id=payment.external_id,
        plan_name=plan.name if plan else None,
    )


@branches_router.get("", response_model=list[BranchResponse])
async def list_branches(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    result = await db.execute(
        select(Branch).where(Branch.tenant_id == ctx.tenant_id).order_by(Branch.created_at.asc())
    )
    return [BranchResponse.model_validate(branch) for branch in result.scalars().all()]


@branches_router.post("", response_model=BranchResponse, status_code=201)
async def create_branch(
    data: BranchCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    branch = Branch(tenant_id=ctx.tenant_id, **data.model_dump())
    db.add(branch)
    await db.flush()
    await db.refresh(branch)
    return BranchResponse.model_validate(branch)


@branches_router.patch("/{branch_id}", response_model=BranchResponse)
async def update_branch(
    branch_id: UUID,
    data: BranchUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    branch = await db.get(Branch, branch_id)
    if not branch or branch.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Branch not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(branch, field, value)

    await db.flush()
    await db.refresh(branch)
    return BranchResponse.model_validate(branch)


@memberships_router.get("", response_model=PaginatedResponse)
async def list_memberships(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    user_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception", "trainer")),
):
    query = select(Membership).where(Membership.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(Membership).where(Membership.tenant_id == ctx.tenant_id)

    if status_filter:
        query = query.where(Membership.status == status_filter)
        count_query = count_query.where(Membership.status == status_filter)
    if user_id:
        query = query.where(Membership.user_id == user_id)
        count_query = count_query.where(Membership.user_id == user_id)

    total = (await db.execute(count_query)).scalar() or 0
    memberships = (
        await db.execute(
            query.order_by(Membership.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).scalars().all()

    user_ids = [membership.user_id for membership in memberships]
    plan_ids = [membership.plan_id for membership in memberships]
    users = {
        user.id: user
        for user in (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
    } if user_ids else {}
    plans = {
        plan.id: plan
        for plan in (
            await db.execute(select(Plan).where(Plan.id.in_(plan_ids)))
        ).scalars().all()
    } if plan_ids else {}

    return PaginatedResponse(
        items=[_membership_payload(item, users.get(item.user_id), plans.get(item.plan_id)) for item in memberships],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@memberships_router.post("", response_model=MembershipResponse, status_code=201)
async def create_membership(
    data: MembershipCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    user = await db.get(User, data.user_id)
    if not user or user.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")

    plan = await db.get(Plan, data.plan_id)
    if not plan or plan.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Plan not found")

    expires_at = data.expires_at
    if expires_at is None and plan.duration_days:
        expires_at = data.starts_at + timedelta(days=plan.duration_days)

    membership = Membership(
        tenant_id=ctx.tenant_id,
        user_id=data.user_id,
        plan_id=data.plan_id,
        starts_at=data.starts_at,
        expires_at=expires_at,
        status=data.status,
        auto_renew=data.auto_renew,
    )
    db.add(membership)
    await db.flush()
    await db.refresh(membership)
    return _membership_payload(membership, user, plan)


@memberships_router.patch("/{membership_id}", response_model=MembershipResponse)
async def update_membership(
    membership_id: UUID,
    data: MembershipUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    membership = await db.get(Membership, membership_id)
    if not membership or membership.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Membership not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(membership, field, value)

    await db.flush()
    await db.refresh(membership)
    user = await db.get(User, membership.user_id)
    plan = await db.get(Plan, membership.plan_id)
    return _membership_payload(membership, user, plan)


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
        raise HTTPException(status_code=404, detail="Campaign not found")

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


@support_router.get("", response_model=PaginatedResponse)
async def list_support_interactions(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    resolved: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    query = select(SupportInteraction).where(SupportInteraction.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(SupportInteraction).where(SupportInteraction.tenant_id == ctx.tenant_id)
    if resolved is not None:
        query = query.where(SupportInteraction.resolved == resolved)
        count_query = count_query.where(SupportInteraction.resolved == resolved)

    total = (await db.execute(count_query)).scalar() or 0
    interactions = (
        await db.execute(
            query.order_by(SupportInteraction.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).scalars().all()

    related_ids = [value for item in interactions for value in (item.user_id, item.handled_by) if value]
    related_users = {
        user.id: user for user in (
            await db.execute(select(User).where(User.id.in_(related_ids)))
        ).scalars().all()
    } if related_ids else {}

    return PaginatedResponse(
        items=[
            _support_payload(item, related_users.get(item.user_id), related_users.get(item.handled_by))
            for item in interactions
        ],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@support_router.post("", response_model=SupportInteractionResponse, status_code=201)
async def create_support_interaction(
    data: SupportInteractionCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    interaction = SupportInteraction(
        tenant_id=ctx.tenant_id,
        user_id=data.user_id,
        channel=data.channel,
        subject=data.subject,
        notes=data.notes,
        handled_by=data.handled_by,
    )
    db.add(interaction)
    await db.flush()
    await db.refresh(interaction)

    client = await db.get(User, interaction.user_id) if interaction.user_id else None
    handler = await db.get(User, interaction.handled_by) if interaction.handled_by else None
    return _support_payload(interaction, client, handler)


@support_router.patch("/{interaction_id}", response_model=SupportInteractionResponse)
async def update_support_interaction(
    interaction_id: UUID,
    data: SupportInteractionUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    interaction = await db.get(SupportInteraction, interaction_id)
    if not interaction or interaction.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Support interaction not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(interaction, field, value)

    await db.flush()
    await db.refresh(interaction)
    client = await db.get(User, interaction.user_id) if interaction.user_id else None
    handler = await db.get(User, interaction.handled_by) if interaction.handled_by else None
    return _support_payload(interaction, client, handler)


@programs_router.get("", response_model=PaginatedResponse)
async def list_programs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    active_only: bool = False,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    query = select(TrainingProgram).where(TrainingProgram.tenant_id == ctx.tenant_id)
    count_query = select(func.count()).select_from(TrainingProgram).where(TrainingProgram.tenant_id == ctx.tenant_id)
    if active_only:
        query = query.where(TrainingProgram.is_active == True)
        count_query = count_query.where(TrainingProgram.is_active == True)

    total = (await db.execute(count_query)).scalar() or 0
    programs = (
        await db.execute(
            query.order_by(TrainingProgram.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).scalars().all()

    trainer_ids = [program.trainer_id for program in programs if program.trainer_id]
    trainers = {
        trainer.id: trainer
        for trainer in (
            await db.execute(select(User).where(User.id.in_(trainer_ids)))
        ).scalars().all()
    } if trainer_ids else {}

    return PaginatedResponse(
        items=[_program_payload(program, trainers.get(program.trainer_id)) for program in programs],
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@programs_router.post("", response_model=TrainingProgramResponse, status_code=201)
async def create_program(
    data: TrainingProgramCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    program = TrainingProgram(
        tenant_id=ctx.tenant_id,
        name=data.name,
        description=data.description,
        trainer_id=data.trainer_id,
        program_type=data.program_type,
        duration_weeks=data.duration_weeks,
        schedule_json=json.dumps(data.schedule),
        is_active=data.is_active,
    )
    db.add(program)
    await db.flush()
    await db.refresh(program)
    trainer = await db.get(User, program.trainer_id) if program.trainer_id else None
    return _program_payload(program, trainer)


@programs_router.patch("/{program_id}", response_model=TrainingProgramResponse)
async def update_program(
    program_id: UUID,
    data: TrainingProgramUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "trainer")),
):
    program = await db.get(TrainingProgram, program_id)
    if not program or program.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Program not found")

    payload = data.model_dump(exclude_unset=True)
    if "schedule" in payload:
        payload["schedule_json"] = json.dumps(payload.pop("schedule"))
    for field, value in payload.items():
        setattr(program, field, value)

    await db.flush()
    await db.refresh(program)
    trainer = await db.get(User, program.trainer_id) if program.trainer_id else None
    return _program_payload(program, trainer)


@settings_router.get("", response_model=TenantSettingsResponse)
async def get_tenant_settings(
    tenant: Tenant = Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Tenant context is required")

    features = _feature_map(tenant)
    support_email = str(features.get("support_email", tenant.email))
    support_phone = str(features.get("support_phone", tenant.phone or "")) or None
    return TenantSettingsResponse(
        gym_name=tenant.name,
        email=tenant.email,
        phone=tenant.phone,
        city=tenant.city,
        address=tenant.address,
        primary_color=tenant.primary_color,
        logo_url=tenant.logo_url,
        custom_domain=tenant.custom_domain,
        billing_email=str(features.get("billing_email", tenant.email)),
        support_email=support_email,
        support_phone=support_phone,
        public_api_key=str(features.get("public_api_key", f"nexo_live_{tenant.slug.replace('-', '_')}")),
        marketplace_headline=str(features.get("marketplace_headline", f"{tenant.name}: planes, clases y reservas online")),
        marketplace_description=str(features.get("marketplace_description", "Compra tu plan, reserva tus clases y administra tu membresia en un solo lugar.")),
        reminder_emails=bool(features.get("reminder_emails", True)),
        reminder_whatsapp=bool(features.get("reminder_whatsapp", True)),
        staff_can_edit_plans=bool(features.get("staff_can_edit_plans", False)),
        two_factor_required=bool(features.get("two_factor_required", False)),
        public_checkout_enabled=bool(features.get("public_checkout_enabled", True)),
        branding={
            "logo_url": tenant.logo_url,
            "primary_color": tenant.primary_color,
            "custom_domain": tenant.custom_domain,
            "support_email": support_email,
            "support_phone": support_phone,
            "marketplace_headline": str(features.get("marketplace_headline", "")) or None,
            "marketplace_description": str(features.get("marketplace_description", "")) or None,
        },
    )


@settings_router.patch("", response_model=TenantSettingsResponse)
async def update_tenant_settings(
    data: TenantSettingsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Tenant context is required")

    payload = data.model_dump(exclude_unset=True)
    tenant_field_map = {
        "gym_name": "name",
        "email": "email",
        "phone": "phone",
        "city": "city",
        "address": "address",
        "primary_color": "primary_color",
        "logo_url": "logo_url",
        "custom_domain": "custom_domain",
    }
    feature_updates: dict[str, Any] = {}

    for field, value in payload.items():
        tenant_field = tenant_field_map.get(field)
        if tenant_field:
            setattr(tenant, tenant_field, value)
        else:
            feature_updates[field] = value

    if feature_updates:
        _save_feature_map(tenant, feature_updates)

    await db.flush()
    return await get_tenant_settings(tenant=tenant)


@reports_router.get("/overview", response_model=ReportsOverviewResponse)
async def get_reports_overview(
    range_key: str = Query("12m", pattern=r"^(30d|90d|12m)$"),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=365 if range_key == "12m" else 90 if range_key == "90d" else 30)

    payments = (
        await db.execute(
            select(Payment).where(
                Payment.tenant_id == ctx.tenant_id,
                Payment.created_at >= since,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
    ).scalars().all()
    memberships = (
        await db.execute(select(Membership).where(Membership.tenant_id == ctx.tenant_id))
    ).scalars().all()
    plans = {
        plan.id: plan for plan in (
            await db.execute(select(Plan).where(Plan.tenant_id == ctx.tenant_id))
        ).scalars().all()
    }
    checkins = (
        await db.execute(select(CheckIn).where(CheckIn.tenant_id == ctx.tenant_id, CheckIn.checked_in_at >= since))
    ).scalars().all()
    classes = (
        await db.execute(
            select(GymClass).where(
                GymClass.tenant_id == ctx.tenant_id,
                GymClass.start_time >= since,
                GymClass.status != ClassStatus.CANCELLED,
            )
        )
    ).scalars().all()
    reservations = (
        await db.execute(select(Reservation).where(Reservation.tenant_id == ctx.tenant_id, Reservation.created_at >= since))
    ).scalars().all()

    revenue_total = sum((payment.amount for payment in payments), 0)
    active_members = sum(1 for membership in memberships if membership.status == MembershipStatus.ACTIVE)
    renewal_rate = round((active_members / len(memberships)) * 100, 1) if memberships else 0.0
    churn_rate = round((sum(1 for membership in memberships if membership.status == MembershipStatus.CANCELLED) / len(memberships)) * 100, 1) if memberships else 0.0

    month_keys = [(now - timedelta(days=30 * offset)).strftime("%b") for offset in reversed(range(12 if range_key == "12m" else 3 if range_key == "90d" else 1))]
    revenue_buckets = {key: 0 for key in month_keys}
    member_buckets = {key: 0 for key in month_keys}
    for payment in payments:
        key = payment.created_at.strftime("%b")
        if key in revenue_buckets:
            revenue_buckets[key] += float(payment.amount)
    for membership in memberships:
        key = membership.created_at.strftime("%b")
        if key in member_buckets:
            member_buckets[key] += 1

    plan_revenue: dict[str, float] = {}
    membership_by_id = {membership.id: membership for membership in memberships}
    for payment in payments:
        membership = membership_by_id.get(payment.membership_id) if payment.membership_id else None
        plan_name = plans[membership.plan_id].name if membership and membership.plan_id in plans else "Sin plan"
        plan_revenue[plan_name] = plan_revenue.get(plan_name, 0) + float(payment.amount)

    weekday_labels = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]
    attendance = {label: 0 for label in weekday_labels}
    for checkin in checkins:
        attendance[weekday_labels[checkin.checked_in_at.weekday()]] += 1

    reservation_counts: dict[UUID, int] = {}
    for reservation in reservations:
        reservation_counts[reservation.gym_class_id] = reservation_counts.get(reservation.gym_class_id, 0) + 1
    occupancy_points = []
    for gym_class in classes[:5]:
        occupancy = 0.0
        if gym_class.max_capacity:
            occupancy = round((reservation_counts.get(gym_class.id, 0) / gym_class.max_capacity) * 100, 1)
        occupancy_points.append({"name": gym_class.name, "occupancy": occupancy})

    colors = ["#06b6d4", "#10b981", "#8b5cf6", "#f59e0b", "#94a3b8"]
    revenue_by_plan = [
        {"name": name, "value": value, "color": colors[index % len(colors)]}
        for index, (name, value) in enumerate(sorted(plan_revenue.items(), key=lambda item: item[1], reverse=True))
    ]

    return ReportsOverviewResponse(
        revenue_total=revenue_total,
        active_members=active_members,
        renewal_rate=renewal_rate,
        churn_rate=churn_rate,
        revenue_series=[ReportSeriesPoint(label=label, value=value) for label, value in revenue_buckets.items()],
        members_series=[ReportSeriesPoint(label=label, value=value) for label, value in member_buckets.items()],
        revenue_by_plan=revenue_by_plan,
        attendance_by_day=[ReportSeriesPoint(label=label, value=value) for label, value in attendance.items()],
        occupancy_by_class=occupancy_points,
    )


@notifications_router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Notification)
        .where(Notification.tenant_id == ctx.tenant_id, Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(20)
    )
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
        raise HTTPException(status_code=404, detail="Client not found")

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
            raise HTTPException(status_code=404, detail="Campaign not found")

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
        raise HTTPException(status_code=404, detail="Notification not found")

    notification = await record_notification_engagement(
        db,
        notification=notification,
        is_read=data.is_read,
        mark_opened=data.mark_opened,
        mark_clicked=data.mark_clicked,
    )
    return _notification_payload(notification)


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
        public_identifier=data.public_identifier,
        checkout_base_url=data.checkout_base_url,
        metadata_json=json.dumps(data.metadata),
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
        raise HTTPException(status_code=404, detail="Payment account not found")

    payload = data.model_dump(exclude_unset=True)
    if payload.get("is_default"):
        existing_accounts = (
            await db.execute(
                select(TenantPaymentProviderAccount).where(TenantPaymentProviderAccount.tenant_id == ctx.tenant_id)
            )
        ).scalars().all()
        for existing in existing_accounts:
            existing.is_default = existing.id == account.id

    if "metadata" in payload:
        account.metadata_json = json.dumps(payload.pop("metadata"))
    for field, value in payload.items():
        setattr(account, field, value)

    await db.flush()
    await db.refresh(account)
    return _payment_account_payload(account)


@mobile_router.get("/wallet", response_model=MobileMembershipWalletResponse)
async def get_mobile_wallet(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Tenant context is required")

    membership = (
        await db.execute(
            select(Membership)
            .where(Membership.user_id == current_user.id, Membership.tenant_id == tenant.id)
            .order_by(Membership.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    plan = await db.get(Plan, membership.plan_id) if membership else None
    next_class = (
        await db.execute(
            select(GymClass)
            .where(
                GymClass.tenant_id == tenant.id,
                GymClass.start_time >= datetime.now(timezone.utc),
                GymClass.status == ClassStatus.SCHEDULED,
            )
            .order_by(GymClass.start_time.asc())
            .limit(1)
        )
    ).scalars().first()

    return MobileMembershipWalletResponse(
        tenant_slug=tenant.slug,
        tenant_name=tenant.name,
        membership_id=membership.id if membership else None,
        plan_id=plan.id if plan else None,
        plan_name=plan.name if plan else None,
        membership_status=membership.status.value if membership else None,
        expires_at=membership.expires_at if membership else None,
        auto_renew=membership.auto_renew if membership else None,
        next_class=(
            {
                "id": str(next_class.id),
                "name": next_class.name,
                "start_time": next_class.start_time.isoformat(),
                "modality": next_class.modality.value if hasattr(next_class.modality, "value") else str(next_class.modality),
            }
            if next_class
            else None
        ),
        qr_payload=f"nexo:{tenant.slug}:{current_user.id}:{membership.id if membership else uuid4()}",
    )


@mobile_router.get("/payments", response_model=list[MobilePaymentHistoryItemResponse])
async def list_mobile_payments(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Tenant context is required")

    payments = (
        await db.execute(
            select(Payment)
            .where(Payment.tenant_id == tenant.id, Payment.user_id == current_user.id)
            .order_by(func.coalesce(Payment.paid_at, Payment.created_at).desc(), Payment.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    membership_ids = [payment.membership_id for payment in payments if payment.membership_id]
    memberships = {
        membership.id: membership
        for membership in (
            await db.execute(select(Membership).where(Membership.id.in_(membership_ids)))
        ).scalars().all()
    } if membership_ids else {}
    plan_ids = [membership.plan_id for membership in memberships.values() if membership.plan_id]
    plans = {
        plan.id: plan
        for plan in (
            await db.execute(select(Plan).where(Plan.id.in_(plan_ids)))
        ).scalars().all()
    } if plan_ids else {}

    return [
        _mobile_payment_payload(
            payment,
            memberships.get(payment.membership_id) if payment.membership_id else None,
            plans.get(memberships[payment.membership_id].plan_id)
            if payment.membership_id and payment.membership_id in memberships
            else None,
        )
        for payment in payments
    ]


@mobile_router.post("/push-preview", response_model=NotificationDispatchResponse, status_code=201)
async def create_mobile_push_preview(
    data: MobilePushPreviewRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Tenant context is required")

    result = await create_and_dispatch_notification(
        db,
        tenant_id=tenant.id,
        user_id=current_user.id,
        title=data.title,
        message=data.message,
        type=data.type,
        action_url=data.action_url or "nexofitness://account/profile",
        send_push=True,
    )
    return _notification_dispatch_payload(result)


@mobile_router.get("/push-subscriptions", response_model=list[PushSubscriptionResponse])
async def list_push_subscriptions(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Tenant context is required")
    result = await db.execute(
        select(PushSubscription)
        .where(PushSubscription.tenant_id == tenant.id, PushSubscription.user_id == current_user.id)
        .order_by(PushSubscription.updated_at.desc())
    )
    return [PushSubscriptionResponse.model_validate(item) for item in result.scalars().all()]


@mobile_router.get("/push-config", response_model=WebPushConfigResponse)
async def get_mobile_push_config(
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None or current_user is None:
        raise HTTPException(status_code=400, detail="Tenant context is required")

    public_key = settings.WEB_PUSH_VAPID_PUBLIC_KEY.strip()
    return WebPushConfigResponse(
        enabled=bool(public_key and settings.WEB_PUSH_VAPID_PRIVATE_KEY.strip()),
        public_vapid_key=public_key or None,
    )


@mobile_router.post("/push-subscriptions", response_model=PushSubscriptionResponse, status_code=201)
async def create_push_subscription(
    data: PushSubscriptionCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Tenant context is required")

    lookup_field = (
        PushSubscription.expo_push_token == data.expo_push_token
        if data.provider == "expo"
        else PushSubscription.web_endpoint == data.web_endpoint
    )
    existing = (
        await db.execute(
            select(PushSubscription).where(
                PushSubscription.tenant_id == tenant.id,
                PushSubscription.user_id == current_user.id,
                PushSubscription.provider == data.provider,
                lookup_field,
            )
        )
    ).scalars().first()
    if existing:
        existing.provider = data.provider
        existing.device_type = data.device_type
        existing.device_name = data.device_name
        existing.expo_push_token = data.expo_push_token
        existing.web_endpoint = data.web_endpoint
        existing.web_p256dh_key = data.web_p256dh_key
        existing.web_auth_key = data.web_auth_key
        existing.user_agent = data.user_agent or request.headers.get("user-agent")
        existing.is_active = True
        existing.last_seen_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(existing)
        return PushSubscriptionResponse.model_validate(existing)

    subscription = PushSubscription(
        tenant_id=tenant.id,
        user_id=current_user.id,
        provider=data.provider,
        device_type=data.device_type,
        device_name=data.device_name,
        expo_push_token=data.expo_push_token,
        web_endpoint=data.web_endpoint,
        web_p256dh_key=data.web_p256dh_key,
        web_auth_key=data.web_auth_key,
        user_agent=data.user_agent or request.headers.get("user-agent"),
        is_active=True,
    )
    db.add(subscription)
    await db.flush()
    await db.refresh(subscription)
    return PushSubscriptionResponse.model_validate(subscription)
