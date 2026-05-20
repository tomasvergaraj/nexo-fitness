"""Tests para referral_service (Fase 6.4)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models.user import User, UserRole
from app.services.referral_service import (
    _new_referral_code,
    _sanitize_name_base,
    ensure_user_referral_code,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────


def make_user(**overrides) -> User:
    u = User(
        id=uuid4(),
        tenant_id=uuid4(),
        email=f"user-{uuid4().hex[:6]}@gym.test",
        hashed_password="hashed",
        first_name="Carlos",
        last_name="Mendoza",
        role=UserRole.CLIENT,
        is_active=True,
        is_verified=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for k, v in overrides.items():
        setattr(u, k, v)
    return u


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeSession:
    """Sesión mínima: simula execute() devolviendo el user si el code matchea."""

    def __init__(self, existing_users: list[User] | None = None):
        self.users_by_code = {
            u.referral_code: u for u in (existing_users or []) if u.referral_code
        }
        self.flushed = 0

    async def execute(self, statement):
        # Cualquier select(User.id).where(User.referral_code == X) lo
        # resolvemos buscando en users_by_code. Implementación naive: parsear
        # el SQL no vale la pena; usamos compile().params para sacar el valor.
        try:
            params = statement.compile().params
        except Exception:
            params = {}
        code = next(
            (v for v in params.values() if isinstance(v, str) and "-" in v),
            None,
        )
        if code and code in self.users_by_code:
            return FakeResult(self.users_by_code[code].id)
        return FakeResult(None)

    async def flush(self):
        self.flushed += 1


# ─── Sanitización del nombre base ────────────────────────────────────────────


def test_sanitize_name_base_strips_accents_and_truncates() -> None:
    assert _sanitize_name_base("Camila") == "CAMILA"
    assert _sanitize_name_base("María-José") == "MARAJO"  # 6 chars max, sin acentos
    assert _sanitize_name_base("X") == "X"
    assert _sanitize_name_base("") == "NEXO"
    assert _sanitize_name_base(None) == "NEXO"  # type: ignore[arg-type]
    assert _sanitize_name_base("12345") == "NEXO"  # solo dígitos → fallback


def test_new_referral_code_format() -> None:
    code = _new_referral_code("Camila")
    assert code.startswith("CAMILA-")
    base, suffix = code.split("-", 1)
    assert base == "CAMILA"
    assert len(suffix) == 5
    assert suffix.isalnum()


def test_new_referral_code_uses_fallback_for_empty_name() -> None:
    code = _new_referral_code(None)
    assert code.startswith("NEXO-")


# ─── ensure_user_referral_code ──────────────────────────────────────────────


def test_ensure_user_referral_code_idempotent_when_already_set() -> None:
    user = make_user(referral_code="CARLOS-AAAAA")
    session = FakeSession()
    result = asyncio.run(ensure_user_referral_code(session, user=user))  # type: ignore[arg-type]
    assert result == "CARLOS-AAAAA"
    assert user.referral_code == "CARLOS-AAAAA"
    assert session.flushed == 0  # no escribió porque ya tenía


def test_ensure_user_referral_code_generates_when_missing() -> None:
    user = make_user(first_name="Camila", referral_code=None)
    session = FakeSession()
    result = asyncio.run(ensure_user_referral_code(session, user=user))  # type: ignore[arg-type]
    assert result.startswith("CAMILA-")
    assert user.referral_code == result
    assert session.flushed == 1


def test_ensure_user_referral_code_handles_collision() -> None:
    """Si el primer candidato colisiona, retry hasta 5 veces."""
    user = make_user(first_name="Camila", referral_code=None)
    # Simulamos: el primer código generado ya existe en otro user.
    # FakeSession devuelve ID para el primer code, None para el segundo.
    class CollisionOnceSession(FakeSession):
        def __init__(self):
            super().__init__()
            self.calls = 0

        async def execute(self, statement):
            self.calls += 1
            if self.calls == 1:
                return FakeResult(uuid4())  # primer code colisiona
            return FakeResult(None)

    session = CollisionOnceSession()
    result = asyncio.run(ensure_user_referral_code(session, user=user))  # type: ignore[arg-type]
    assert result.startswith("CAMILA-")
    assert session.calls == 2  # 1 colisión + 1 éxito
    assert session.flushed == 1


def test_ensure_user_referral_code_fails_after_max_retries() -> None:
    """Si TODAS las colisiones se repiten, raise RuntimeError."""
    user = make_user(referral_code=None)

    class AlwaysCollidesSession(FakeSession):
        async def execute(self, statement):
            return FakeResult(uuid4())

    session = AlwaysCollidesSession()
    with pytest.raises(RuntimeError) as exc:
        asyncio.run(ensure_user_referral_code(session, user=user))  # type: ignore[arg-type]
    assert "5 intentos" in str(exc.value)
    assert user.referral_code is None  # no se asignó
