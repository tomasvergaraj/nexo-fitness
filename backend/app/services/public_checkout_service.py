"""Helpers for building public checkout URLs and return links."""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.services.custom_domain_service import build_storefront_url


def _append_path_segment(base_url: str, path_segment: str) -> str:
    parts = urlsplit(base_url)
    normalized_segment = path_segment.strip("/")
    base_path = parts.path.rstrip("/")
    next_path = f"{base_path}/{normalized_segment}" if base_path else f"/{normalized_segment}"

    return urlunsplit((parts.scheme, parts.netloc, next_path, parts.query, parts.fragment))


def _merge_query_params(base_url: str, params: dict[str, str | None]) -> str:
    parts = urlsplit(base_url)
    overridden_keys = {key for key, value in params.items() if value}
    query_items = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key not in overridden_keys]
    query_items.extend((key, value) for key, value in params.items() if value)

    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query_items), parts.fragment))


def build_storefront_return_urls(
    frontend_url: str,
    tenant_slug: str,
    custom_domain: str | None = None,
) -> tuple[str, str]:
    storefront_url = build_storefront_url(frontend_url, tenant_slug, custom_domain)
    return (
        f"{storefront_url}?checkout=success",
        f"{storefront_url}?checkout=cancelled",
    )


def build_public_checkout_urls(
    *,
    checkout_base_url: str,
    plan_id: str,
    session_reference: str,
    success_url: str,
    cancel_url: str,
    amount: str | None = None,
    promo_code_id: str | None = None,
) -> tuple[str, str]:
    checkout_url = _merge_query_params(
        checkout_base_url,
        {
            "plan_id": plan_id,
            "session": session_reference,
            "amount": amount,
            "promo_code_id": promo_code_id,
            "success_url": success_url,
            "cancel_url": cancel_url,
        },
    )
    payment_link_url = _merge_query_params(
        _append_path_segment(checkout_base_url, f"link/{session_reference}"),
        {
            "amount": amount,
            "promo_code_id": promo_code_id,
            "success_url": success_url,
            "cancel_url": cancel_url,
        },
    )

    return checkout_url, payment_link_url
