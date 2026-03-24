from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models.business import Campaign, CampaignChannel, CampaignStatus
from app.services.campaign_service import (
    DISPATCH_TRIGGER_MANUAL,
    build_campaign_dispatch_config,
    dispatch_campaign_broadcast,
    mark_campaign_dispatch_started,
    normalize_campaign_status,
)


class DummySession:
    def __init__(self) -> None:
        self.flush_calls = 0

    async def flush(self) -> None:
        self.flush_calls += 1


def make_campaign(**overrides) -> Campaign:
    campaign = Campaign(
        id=uuid4(),
        tenant_id=uuid4(),
        name="Promo marzo",
        subject="Activa tu plan",
        content="Tenemos una promocion para ti.",
        channel=CampaignChannel.EMAIL,
        status=CampaignStatus.DRAFT,
        notification_type="warning",
        action_url="nexofitness://store",
        send_push=False,
        total_recipients=0,
        total_sent=0,
        total_opened=0,
        total_clicked=0,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(campaign, key, value)
    return campaign


def test_normalize_campaign_status_sets_scheduled_when_datetime_exists() -> None:
    status = normalize_campaign_status(
        current_status=CampaignStatus.DRAFT,
        requested_status=CampaignStatus.DRAFT,
        scheduled_at=datetime(2026, 3, 24, 12, 0, tzinfo=timezone.utc),
    )

    assert status == CampaignStatus.SCHEDULED


def test_normalize_campaign_status_keeps_explicit_terminal_status() -> None:
    status = normalize_campaign_status(
        current_status=CampaignStatus.SCHEDULED,
        requested_status=CampaignStatus.CANCELLED,
        scheduled_at=datetime(2026, 3, 24, 12, 0, tzinfo=timezone.utc),
    )

    assert status == CampaignStatus.CANCELLED


def test_build_campaign_dispatch_config_uses_persisted_payload() -> None:
    campaign = make_campaign()

    payload = build_campaign_dispatch_config(campaign)

    assert payload["title"] == "Activa tu plan"
    assert payload["message"] == "Tenemos una promocion para ti."
    assert payload["notification_type"] == "warning"
    assert payload["action_url"] == "nexofitness://store"
    assert payload["send_push"] is False


def test_mark_campaign_dispatch_started_tracks_attempt_metadata() -> None:
    campaign = make_campaign(status=CampaignStatus.SCHEDULED, dispatch_attempts=2)
    started_at = datetime(2026, 3, 24, 15, 30, tzinfo=timezone.utc)

    previous_status = mark_campaign_dispatch_started(
        campaign,
        trigger=DISPATCH_TRIGGER_MANUAL,
        started_at=started_at,
    )

    assert previous_status == CampaignStatus.SCHEDULED
    assert campaign.status == CampaignStatus.SENDING
    assert campaign.last_dispatch_trigger == DISPATCH_TRIGGER_MANUAL
    assert campaign.last_dispatch_attempted_at == started_at
    assert campaign.last_dispatch_finished_at is None
    assert campaign.last_dispatch_error is None
    assert campaign.dispatch_attempts == 3


@pytest.mark.asyncio
async def test_dispatch_campaign_broadcast_marks_empty_scheduled_campaign_as_sent() -> None:
    campaign = make_campaign(status=CampaignStatus.SCHEDULED, subject=None, segment_filter=None)
    db = DummySession()

    summary = await dispatch_campaign_broadcast(
        db,
        tenant_id=campaign.tenant_id,
        campaign=campaign,
        title="Promo marzo",
        allow_empty=True,
    )

    assert summary.total_recipients == 0
    assert summary.total_notifications == 0
    assert campaign.status == CampaignStatus.SENT
    assert campaign.total_recipients == 0
    assert campaign.total_sent == 0
    assert campaign.sent_at is not None
    assert campaign.last_dispatch_trigger == DISPATCH_TRIGGER_MANUAL
    assert campaign.last_dispatch_attempted_at is not None
    assert campaign.last_dispatch_finished_at is not None
    assert campaign.last_dispatch_error is None
    assert campaign.dispatch_attempts == 1
    assert db.flush_calls == 2
