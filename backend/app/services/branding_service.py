"""Helpers for validating tenant brand colors."""

import re


DEFAULT_PRIMARY_COLOR = "#06b6d4"
DEFAULT_SECONDARY_COLOR = "#0f766e"
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def normalize_brand_color(
    value: str | None,
    *,
    field_label: str = "color",
    default: str | None = None,
) -> str | None:
    if value is None:
        return default

    raw = value.strip()
    if not raw:
        return default
    if not HEX_COLOR_RE.fullmatch(raw):
        raise ValueError(f"El {field_label} debe usar formato hexadecimal #RRGGBB")
    return raw.lower()


def coerce_brand_color(value: str | None, default: str) -> str:
    try:
        normalized = normalize_brand_color(value, default=default)
    except ValueError:
        return default
    return normalized or default
