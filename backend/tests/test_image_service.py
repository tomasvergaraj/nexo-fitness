"""Tests para image_service — pipeline Pillow + helpers de keys/URLs.

No toca R2: las funciones puras (_optimize, _build_keys, derive_thumb_url)
se testean con imágenes reales construidas en memoria con Pillow.
upload_*/delete_* requieren R2 — fuera de scope de este file.
"""

from __future__ import annotations

import io
from uuid import UUID

import pytest
from PIL import Image

from app.services.image_service import (
    ImageTooLargeError,
    InvalidImageError,
    _build_keys,
    _optimize,
    derive_thumb_url,
)


def _make_png_bytes(size: tuple[int, int] = (100, 100), mode: str = "RGB") -> bytes:
    """Genera bytes PNG válidos in-memory."""
    buf = io.BytesIO()
    Image.new(mode, size, color="red").save(buf, format="PNG")
    return buf.getvalue()


# ─── _optimize ───────────────────────────────────────────────────────────────


def test_optimize_returns_main_and_thumb_when_requested():
    raw = _make_png_bytes((400, 400))

    main, thumb = _optimize(raw, generate_thumb=True)

    assert isinstance(main, bytes) and len(main) > 0
    assert isinstance(thumb, bytes) and len(thumb) > 0
    # Thumb debe pesar menos que main
    assert len(thumb) < len(main)


def test_optimize_skips_thumb_when_disabled():
    raw = _make_png_bytes()

    main, thumb = _optimize(raw, generate_thumb=False)

    assert isinstance(main, bytes) and len(main) > 0
    assert thumb is None


def test_optimize_rejects_oversized_file(monkeypatch: pytest.MonkeyPatch):
    """Si el raw_bytes excede MAX_IMAGE_UPLOAD_BYTES, levantar ImageTooLargeError."""
    from app.core import config as config_module

    settings = config_module.get_settings()
    monkeypatch.setattr(settings, "MAX_IMAGE_UPLOAD_BYTES", 100)

    raw = _make_png_bytes((500, 500))  # mucho más que 100 bytes

    with pytest.raises(ImageTooLargeError):
        _optimize(raw, generate_thumb=False)


def test_optimize_rejects_non_image_bytes():
    raw = b"esto no es una imagen, es texto plano." * 10

    with pytest.raises(InvalidImageError):
        _optimize(raw, generate_thumb=False)


def test_optimize_accepts_rgba_image():
    """RGBA debe convertirse internamente sin crashear."""
    raw = _make_png_bytes(mode="RGBA")

    main, thumb = _optimize(raw, generate_thumb=True)

    assert main and thumb


def test_optimize_main_size_is_capped_at_800():
    """Imagen 2000x2000 debe encogerse a 800x800 máximo en main."""
    raw = _make_png_bytes((2000, 2000))

    main, _ = _optimize(raw, generate_thumb=False)

    decoded = Image.open(io.BytesIO(main))
    assert max(decoded.size) <= 800


def test_optimize_thumb_size_is_capped_at_200():
    raw = _make_png_bytes((2000, 2000))

    _, thumb = _optimize(raw, generate_thumb=True)

    decoded = Image.open(io.BytesIO(thumb))
    assert max(decoded.size) <= 200


# ─── _build_keys ─────────────────────────────────────────────────────────────


def test_build_keys_with_thumb():
    main_key, thumb_key = _build_keys("tenants/abc/products/xyz", generate_thumb=True)

    assert main_key.startswith("tenants/abc/products/xyz/")
    assert main_key.endswith(".webp")
    assert thumb_key.endswith("_thumb.webp")
    # main + thumb comparten el mismo uuid base
    base = main_key[: -len(".webp")]
    assert thumb_key == f"{base}_thumb.webp"


def test_build_keys_without_thumb():
    main_key, thumb_key = _build_keys("tenants/abc/expenses/xyz", generate_thumb=False)

    assert main_key.endswith(".webp")
    assert thumb_key is None


def test_build_keys_strips_trailing_slash_in_prefix():
    main_key, _ = _build_keys("tenants/abc/", generate_thumb=False)

    # No debe haber doble slash
    assert "//" not in main_key


def test_build_keys_uses_unique_uuid():
    """Dos calls al mismo prefix deben generar keys distintas."""
    k1, _ = _build_keys("p", generate_thumb=False)
    k2, _ = _build_keys("p", generate_thumb=False)

    assert k1 != k2


# ─── derive_thumb_url ────────────────────────────────────────────────────────


def test_derive_thumb_url_converts_webp():
    url = "https://cdn.example.com/tenants/abc/products/xyz/deadbeef.webp"

    thumb = derive_thumb_url(url)

    assert thumb == "https://cdn.example.com/tenants/abc/products/xyz/deadbeef_thumb.webp"


def test_derive_thumb_url_returns_none_for_non_webp():
    assert derive_thumb_url("https://cdn.example.com/foo.png") is None
    assert derive_thumb_url("https://cdn.example.com/foo.jpg") is None


def test_derive_thumb_url_returns_none_for_empty():
    assert derive_thumb_url(None) is None
    assert derive_thumb_url("") is None
