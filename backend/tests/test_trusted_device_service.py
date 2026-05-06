"""Unit tests for trusted_device_service hashing + label heuristic."""
from __future__ import annotations

from app.services.trusted_device_service import _hash_token, _label_from_user_agent


def test_hash_token_is_deterministic_and_64_hex_chars() -> None:
    h1 = _hash_token("abc123")
    h2 = _hash_token("abc123")
    assert h1 == h2
    assert len(h1) == 64
    assert all(c in "0123456789abcdef" for c in h1)


def test_hash_token_differs_per_input() -> None:
    assert _hash_token("a") != _hash_token("b")


def test_label_from_ua_android() -> None:
    assert _label_from_user_agent("Mozilla/5.0 (Linux; Android 13)") == "Android"


def test_label_from_ua_ios() -> None:
    assert _label_from_user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)") == "iOS"


def test_label_from_ua_mac() -> None:
    assert _label_from_user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)") == "Mac"


def test_label_from_ua_windows() -> None:
    assert _label_from_user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)") == "Windows"


def test_label_from_ua_linux() -> None:
    assert _label_from_user_agent("Mozilla/5.0 (X11; Linux x86_64)") == "Linux"


def test_label_from_ua_falls_back() -> None:
    assert _label_from_user_agent(None) == "Dispositivo"
    assert _label_from_user_agent("") == "Dispositivo"
    assert _label_from_user_agent("RandomBot/1.0") == "Dispositivo"
