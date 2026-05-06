"""Unit tests for TOTPService (encryption, TOTP verify, backup codes)."""
from __future__ import annotations

import json
import time

import pyotp
import pytest

from app.services.totp_service import (
    consume_backup_code,
    decrypt_secret,
    encrypt_secret,
    generate_backup_codes,
    generate_secret,
    provisioning_uri,
    remaining_backup_codes,
    verify_code,
)


def test_generate_secret_is_base32_and_unique() -> None:
    a, b = generate_secret(), generate_secret()
    assert a != b
    assert len(a) >= 16
    # base32 alphabet
    assert all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567=" for c in a)


def test_encrypt_decrypt_roundtrip() -> None:
    secret = generate_secret()
    token = encrypt_secret(secret)
    assert token != secret
    assert decrypt_secret(token) == secret


def test_decrypt_invalid_returns_none() -> None:
    assert decrypt_secret("not-a-valid-token") is None


def test_provisioning_uri_format() -> None:
    secret = "JBSWY3DPEHPK3PXP"
    uri = provisioning_uri(secret, account_name="user@gym.cl", issuer_name="Mi Gimnasio")
    assert uri.startswith("otpauth://totp/")
    assert "secret=" + secret in uri
    assert "issuer=" in uri


def test_verify_code_accepts_current() -> None:
    secret = generate_secret()
    code = pyotp.TOTP(secret).now()
    assert verify_code(secret, code) is True


def test_verify_code_rejects_wrong() -> None:
    secret = generate_secret()
    assert verify_code(secret, "000000") is False


def test_verify_code_rejects_malformed() -> None:
    secret = generate_secret()
    assert verify_code(secret, "abc") is False
    assert verify_code(secret, "12345") is False
    assert verify_code(secret, "1234567") is False
    assert verify_code(secret, "") is False


def test_verify_code_strips_spaces() -> None:
    secret = generate_secret()
    code = pyotp.TOTP(secret).now()
    assert verify_code(secret, f" {code[:3]} {code[3:]} ") is True


def test_verify_code_handles_drift() -> None:
    secret = generate_secret()
    totp = pyotp.TOTP(secret)
    # Code from 30s ago should still work with valid_window=1
    past_code = totp.at(int(time.time()) - 30)
    assert verify_code(secret, past_code) is True


# ─── Backup codes ────────────────────────────────────────────────────────────

def test_generate_backup_codes_returns_10_unique() -> None:
    plaintext, stored = generate_backup_codes()
    assert len(plaintext) == 10
    assert len(set(plaintext)) == 10
    hashes = json.loads(stored)
    assert len(hashes) == 10


def test_backup_code_format() -> None:
    plaintext, _ = generate_backup_codes()
    for code in plaintext:
        # "ABCDE-FGHIJ"
        assert len(code) == 11
        assert code[5] == "-"
        assert code[:5].isalnum()
        assert code[6:].isalnum()


def test_consume_backup_code_success_removes_hash() -> None:
    plaintext, stored = generate_backup_codes()
    new_stored = consume_backup_code(stored, plaintext[3])
    assert new_stored is not None
    assert remaining_backup_codes(new_stored) == 9


def test_consume_backup_code_is_single_use() -> None:
    plaintext, stored = generate_backup_codes()
    new_stored = consume_backup_code(stored, plaintext[0])
    assert new_stored is not None
    # Same code should NOT verify against the new stored set
    assert consume_backup_code(new_stored, plaintext[0]) is None


def test_consume_backup_code_rejects_wrong_code() -> None:
    _, stored = generate_backup_codes()
    assert consume_backup_code(stored, "WRONG-CODE1") is None


def test_consume_backup_code_normalizes_input() -> None:
    plaintext, stored = generate_backup_codes()
    code = plaintext[0]
    # Lowercase + extra spaces should still match
    assert consume_backup_code(stored, f"  {code.lower()}  ") is not None


def test_consume_backup_code_handles_empty_storage() -> None:
    assert consume_backup_code(None, "ANY-CODE") is None
    assert consume_backup_code("[]", "ANY-CODE") is None
    assert consume_backup_code("not json", "ANY-CODE") is None


def test_remaining_backup_codes() -> None:
    assert remaining_backup_codes(None) == 0
    assert remaining_backup_codes("[]") == 0
    _, stored = generate_backup_codes()
    assert remaining_backup_codes(stored) == 10
