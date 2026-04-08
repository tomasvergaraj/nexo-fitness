import pytest

from app.services.branding_service import (
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_SECONDARY_COLOR,
    coerce_brand_color,
    normalize_brand_color,
)


def test_normalize_brand_color_accepts_hex_and_normalizes_case() -> None:
    assert normalize_brand_color("#A1B2C3", field_label="color principal") == "#a1b2c3"


def test_normalize_brand_color_uses_default_for_empty_values() -> None:
    assert normalize_brand_color("", default=DEFAULT_PRIMARY_COLOR) == DEFAULT_PRIMARY_COLOR
    assert normalize_brand_color(None, default=DEFAULT_SECONDARY_COLOR) == DEFAULT_SECONDARY_COLOR


def test_normalize_brand_color_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="hexadecimal"):
        normalize_brand_color("teal", field_label="color secundario")


def test_coerce_brand_color_falls_back_to_default_on_invalid_stored_value() -> None:
    assert coerce_brand_color("not-a-color", DEFAULT_PRIMARY_COLOR) == DEFAULT_PRIMARY_COLOR
