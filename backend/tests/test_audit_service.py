"""Tests para audit_service — extracción de metadata + log_audit best-effort."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.audit_service import extract_request_meta, log_audit
from app.models.business import AuditLog


class _FakeClient:
    def __init__(self, host: str):
        self.host = host


def _make_request(headers: dict[str, str] | None = None, client_host: str | None = None) -> MagicMock:
    req = MagicMock()
    req.headers = headers or {}
    req.client = _FakeClient(client_host) if client_host else None
    return req


# ─── extract_request_meta ────────────────────────────────────────────────────


def test_extract_request_meta_none_returns_none_pair():
    ip, ua = extract_request_meta(None)
    assert ip is None and ua is None


def test_extract_request_meta_uses_client_host_when_no_proxy_header():
    req = _make_request(client_host="192.168.1.10")
    ip, ua = extract_request_meta(req)
    assert ip == "192.168.1.10"
    assert ua is None


def test_extract_request_meta_prefers_x_forwarded_for():
    req = _make_request(
        headers={"x-forwarded-for": "203.0.113.1, 10.0.0.1", "user-agent": "Mozilla/5.0"},
        client_host="10.0.0.99",
    )
    ip, ua = extract_request_meta(req)
    assert ip == "203.0.113.1"  # primer IP del header
    assert ua == "Mozilla/5.0"


def test_extract_request_meta_falls_back_to_x_real_ip():
    req = _make_request(headers={"x-real-ip": "203.0.113.2"})
    ip, _ = extract_request_meta(req)
    assert ip == "203.0.113.2"


def test_extract_request_meta_truncates_long_ua():
    long_ua = "X" * 1000
    req = _make_request(headers={"user-agent": long_ua})
    _, ua = extract_request_meta(req)
    assert len(ua) == 500


# ─── log_audit best-effort ───────────────────────────────────────────────────


class _CollectingSession:
    """Session que colecta los .add() para inspección."""

    def __init__(self):
        self.added: list = []

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass


class _BrokenSession:
    """Session que tira al hacer flush — log_audit debe atrapar."""

    def add(self, _obj):
        pass

    async def flush(self):
        raise RuntimeError("simulated DB failure")


@pytest.mark.asyncio
async def test_log_audit_creates_entry_with_payload():
    session = _CollectingSession()
    tenant_id = uuid4()

    await log_audit(
        session,
        action="role_change",
        tenant_id=tenant_id,
        entity_type="user",
        entity_id=str(uuid4()),
        details={"from": "trainer", "to": "admin"},
    )

    assert len(session.added) == 1
    entry: AuditLog = session.added[0]
    assert entry.action == "role_change"
    assert entry.tenant_id == tenant_id
    assert entry.entity_type == "user"
    assert "trainer" in entry.details
    assert "admin" in entry.details


@pytest.mark.asyncio
async def test_log_audit_swallows_db_exception():
    """Si flush falla, log_audit no debe propagar — la operación principal sigue."""
    session = _BrokenSession()

    # No debe lanzar
    await log_audit(session, action="login_failed", details={"email": "x@y.cl"})


@pytest.mark.asyncio
async def test_log_audit_truncates_action_to_100_chars():
    session = _CollectingSession()
    long_action = "very_long_action_name_" + ("x" * 200)

    await log_audit(session, action=long_action)

    assert len(session.added[0].action) == 100


@pytest.mark.asyncio
async def test_log_audit_handles_request_metadata():
    session = _CollectingSession()
    req = _make_request(
        headers={"x-forwarded-for": "1.2.3.4", "user-agent": "Bot/1.0"},
        client_host="10.0.0.1",
    )

    await log_audit(session, action="login_success", request=req)

    entry: AuditLog = session.added[0]
    assert entry.ip_address == "1.2.3.4"
