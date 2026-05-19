"""Tests para parse_qr_payload — validación del formato QR.

Formato esperado: "nexo:<tenant_slug>:<user_uuid>:<membership_uuid>"
Caseless en el prefijo "nexo", tolerante a whitespace exterior, trims
los UUIDs antes de parsearlos.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.services.checkin_helpers import parse_qr_payload


def _valid_payload(slug: str = "gym-norte", user_id: UUID | None = None, mem_id: UUID | None = None) -> str:
    user_id = user_id or uuid4()
    mem_id = mem_id or uuid4()
    return f"nexo:{slug}:{user_id}:{mem_id}"


def test_parse_qr_payload_returns_parsed_tuple():
    user_id = uuid4()
    mem_id = uuid4()
    payload = f"nexo:gym-norte:{user_id}:{mem_id}"

    slug, parsed_user, parsed_mem = parse_qr_payload(payload)

    assert slug == "gym-norte"
    assert parsed_user == user_id
    assert parsed_mem == mem_id


def test_parse_qr_payload_lowercases_slug():
    user_id = uuid4()
    mem_id = uuid4()
    payload = f"nexo:Gym-NORTE:{user_id}:{mem_id}"

    slug, _, _ = parse_qr_payload(payload)

    assert slug == "gym-norte"


def test_parse_qr_payload_accepts_case_insensitive_prefix():
    payload = f"NEXO:gym:{uuid4()}:{uuid4()}"

    slug, _, _ = parse_qr_payload(payload)

    assert slug == "gym"


def test_parse_qr_payload_strips_surrounding_whitespace():
    user_id = uuid4()
    mem_id = uuid4()
    payload = f"   nexo:gym:{user_id}:{mem_id}   "

    slug, parsed_user, parsed_mem = parse_qr_payload(payload)

    assert slug == "gym"
    assert parsed_user == user_id
    assert parsed_mem == mem_id


@pytest.mark.parametrize("bad_prefix", ["foo", "nexofit", "n3xo", ""])
def test_parse_qr_payload_rejects_wrong_prefix(bad_prefix: str):
    payload = f"{bad_prefix}:gym:{uuid4()}:{uuid4()}"

    with pytest.raises(HTTPException) as exc:
        parse_qr_payload(payload)

    assert exc.value.status_code == 400
    assert "QR" in exc.value.detail


@pytest.mark.parametrize(
    "broken",
    [
        "nexo:gym:user",  # 3 partes
        "nexo:gym",  # 2 partes
        "nexo:gym:user:mem:extra",  # 5 partes
        "",  # vacío
    ],
)
def test_parse_qr_payload_rejects_wrong_part_count(broken: str):
    with pytest.raises(HTTPException) as exc:
        parse_qr_payload(broken)
    assert exc.value.status_code == 400


def test_parse_qr_payload_rejects_invalid_user_uuid():
    payload = f"nexo:gym:not-a-uuid:{uuid4()}"

    with pytest.raises(HTTPException) as exc:
        parse_qr_payload(payload)

    assert exc.value.status_code == 400


def test_parse_qr_payload_rejects_invalid_membership_uuid():
    payload = f"nexo:gym:{uuid4()}:also-not-a-uuid"

    with pytest.raises(HTTPException) as exc:
        parse_qr_payload(payload)

    assert exc.value.status_code == 400
