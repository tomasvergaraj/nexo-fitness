"""Image optimization + upload pipeline for product images."""

from __future__ import annotations

import io
import logging
import uuid
from typing import Optional
from uuid import UUID

from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings
from app.integrations.storage import r2_client

logger = logging.getLogger(__name__)

MAIN_MAX_SIZE = (800, 800)
THUMB_MAX_SIZE = (200, 200)
MAIN_QUALITY = 80
THUMB_QUALITY = 75
WEBP_METHOD = 6  # 0=fast, 6=best compression


class ImageTooLargeError(ValueError):
    pass


class InvalidImageError(ValueError):
    pass


def _open_image(raw: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise InvalidImageError(f"Archivo no es una imagen válida: {exc}") from exc

    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.mode or img.mode == "P" else "RGB")
    return img


def _encode_webp(img: Image.Image, max_size: tuple[int, int], quality: int) -> bytes:
    canvas = img.copy()
    canvas.thumbnail(max_size, Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    canvas.save(buf, format="WEBP", quality=quality, method=WEBP_METHOD)
    return buf.getvalue()


def optimize_product_image(raw_bytes: bytes) -> tuple[bytes, bytes]:
    """Devuelve (main_webp, thumb_webp). Lanza ImageTooLargeError / InvalidImageError."""
    max_bytes = get_settings().MAX_IMAGE_UPLOAD_BYTES
    if len(raw_bytes) > max_bytes:
        raise ImageTooLargeError(f"Imagen excede {max_bytes // (1024 * 1024)} MB")

    img = _open_image(raw_bytes)
    main = _encode_webp(img, MAIN_MAX_SIZE, MAIN_QUALITY)
    thumb = _encode_webp(img, THUMB_MAX_SIZE, THUMB_QUALITY)
    return main, thumb


def _build_keys(tenant_id: UUID, product_id: UUID) -> tuple[str, str]:
    uid = uuid.uuid4().hex
    base = f"tenants/{tenant_id}/products/{product_id}/{uid}"
    return f"{base}.webp", f"{base}_thumb.webp"


def upload_product_image(
    tenant_id: UUID,
    product_id: UUID,
    raw_bytes: bytes,
) -> dict[str, str]:
    """Optimiza + sube imagen principal y thumbnail. Retorna {image_url, thumb_url}."""
    main_bytes, thumb_bytes = optimize_product_image(raw_bytes)
    main_key, thumb_key = _build_keys(tenant_id, product_id)

    main_url = r2_client.upload_bytes(main_key, main_bytes, "image/webp")
    try:
        thumb_url = r2_client.upload_bytes(thumb_key, thumb_bytes, "image/webp")
    except Exception:
        # rollback main si falla thumb
        r2_client.delete_key(main_key)
        raise
    return {"image_url": main_url, "thumb_url": thumb_url}


def delete_product_image(image_url: Optional[str]) -> None:
    """Borra main + thumb a partir de la URL principal. Best-effort, no levanta."""
    if not image_url:
        return
    main_key = r2_client.key_from_public_url(image_url)
    if not main_key:
        return
    if main_key.endswith(".webp"):
        thumb_key = main_key[: -len(".webp")] + "_thumb.webp"
    else:
        thumb_key = None
    r2_client.delete_key(main_key)
    if thumb_key:
        r2_client.delete_key(thumb_key)


def derive_thumb_url(image_url: Optional[str]) -> Optional[str]:
    """Convención: thumb es <main>_thumb.webp. Retorna None si no aplica."""
    if not image_url or not image_url.endswith(".webp"):
        return None
    return image_url[: -len(".webp")] + "_thumb.webp"
