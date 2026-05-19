"""Cloudflare R2 client (S3-compatible via boto3)."""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Optional

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class R2ConfigError(RuntimeError):
    """Raised cuando faltan credenciales o config de R2."""


@lru_cache
def _get_client():
    s = get_settings()
    missing = [
        name
        for name, value in [
            ("R2_ACCOUNT_ID", s.R2_ACCOUNT_ID),
            ("R2_ACCESS_KEY_ID", s.R2_ACCESS_KEY_ID),
            ("R2_SECRET_ACCESS_KEY", s.R2_SECRET_ACCESS_KEY),
            ("R2_BUCKET", s.R2_BUCKET),
            ("R2_PUBLIC_BASE_URL", s.R2_PUBLIC_BASE_URL),
        ]
        if not value
    ]
    if missing:
        raise R2ConfigError(f"R2 no configurado. Faltan: {', '.join(missing)}")

    endpoint = f"https://{s.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=s.R2_ACCESS_KEY_ID,
        aws_secret_access_key=s.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    )


def public_url_for_key(key: str) -> str:
    base = get_settings().R2_PUBLIC_BASE_URL.rstrip("/")
    return f"{base}/{key.lstrip('/')}"


def upload_bytes(
    key: str,
    data: bytes,
    content_type: str,
    cache_control: str = "public, max-age=31536000, immutable",
) -> str:
    """Sube bytes a R2 y retorna URL pública."""
    client = _get_client()
    bucket = get_settings().R2_BUCKET
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl=cache_control,
    )
    return public_url_for_key(key)


def delete_key(key: str) -> bool:
    """Borra key de R2. Retorna False si falla (no levanta)."""
    try:
        client = _get_client()
        client.delete_object(Bucket=get_settings().R2_BUCKET, Key=key)
        return True
    except (ClientError, R2ConfigError) as exc:
        logger.warning("R2 delete failed for key=%s: %s", key, exc)
        return False


def key_from_public_url(url: Optional[str]) -> Optional[str]:
    """Extrae el key de una URL pública. None si la URL no pertenece al bucket configurado."""
    if not url:
        return None
    base = get_settings().R2_PUBLIC_BASE_URL.rstrip("/")
    if not base or not url.startswith(base + "/"):
        return None
    return url[len(base) + 1 :]
