"""TOTP (RFC 6238) and backup-code service for 2FA.

Secrets are stored encrypted at rest with Fernet (key derived from SECRET_KEY).
Backup codes are stored as bcrypt hashes — only the first time they are
generated does the caller receive the plaintext. On verify, the matching hash
is removed (single use).
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from typing import List, Optional
from urllib.parse import quote

import pyotp
from cryptography.fernet import Fernet, InvalidToken
from passlib.hash import bcrypt

from app.core.config import get_settings


_BACKUP_CODE_COUNT = 10
_BACKUP_CODE_GROUPS = 2  # 2 groups of 5 chars → "ABCDE-FGHIJ"
_BACKUP_CODE_GROUP_LEN = 5
_BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def _fernet() -> Fernet:
    """Derive a stable Fernet key from settings.SECRET_KEY."""
    settings = get_settings()
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> Optional[str]:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def generate_secret() -> str:
    """Random base32 TOTP seed (160 bits)."""
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_name: str, issuer_name: str) -> str:
    """otpauth://totp/... URI for QR codes."""
    return pyotp.TOTP(secret).provisioning_uri(
        name=quote(account_name, safe="@"),
        issuer_name=quote(issuer_name, safe=""),
    )


def verify_code(secret: str, code: str, *, valid_window: int = 1) -> bool:
    """Verify a 6-digit TOTP code with ±1 step (30s) drift tolerance."""
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=valid_window)


# ─── Backup codes ─────────────────────────────────────────────────────────────

def _format_code(raw: str) -> str:
    return "-".join(
        raw[i * _BACKUP_CODE_GROUP_LEN : (i + 1) * _BACKUP_CODE_GROUP_LEN]
        for i in range(_BACKUP_CODE_GROUPS)
    )


def _normalize_code(code: str) -> str:
    return code.strip().upper().replace("-", "").replace(" ", "")


def generate_backup_codes() -> tuple[List[str], str]:
    """Returns (plaintext_codes, json_hashes) — plaintext is shown ONCE."""
    plaintext: List[str] = []
    for _ in range(_BACKUP_CODE_COUNT):
        raw = "".join(
            secrets.choice(_BACKUP_CODE_ALPHABET)
            for _ in range(_BACKUP_CODE_GROUPS * _BACKUP_CODE_GROUP_LEN)
        )
        plaintext.append(_format_code(raw))
    hashes = [bcrypt.hash(_normalize_code(code)) for code in plaintext]
    return plaintext, json.dumps(hashes)


def consume_backup_code(stored_json: Optional[str], submitted: str) -> Optional[str]:
    """If submitted matches one of the stored hashes, remove it and return the
    new JSON (or '[]'). Returns None if no match."""
    if not stored_json:
        return None
    try:
        hashes: list[str] = json.loads(stored_json)
    except (json.JSONDecodeError, TypeError):
        return None
    candidate = _normalize_code(submitted)
    if not candidate:
        return None
    for idx, h in enumerate(hashes):
        try:
            if bcrypt.verify(candidate, h):
                remaining = hashes[:idx] + hashes[idx + 1 :]
                return json.dumps(remaining)
        except (ValueError, TypeError):
            continue
    return None


def remaining_backup_codes(stored_json: Optional[str]) -> int:
    if not stored_json:
        return 0
    try:
        return len(json.loads(stored_json))
    except (json.JSONDecodeError, TypeError):
        return 0
