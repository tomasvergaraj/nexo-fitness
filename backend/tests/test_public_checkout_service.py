from urllib.parse import parse_qs, urlsplit

from app.services.public_checkout_service import build_public_checkout_urls, build_storefront_return_urls


def test_build_storefront_return_urls_point_back_to_tenant_storefront() -> None:
    success_url, cancel_url = build_storefront_return_urls("http://localhost:3000/", "nexo-gym-santiago")

    assert success_url == "http://localhost:3000/store/nexo-gym-santiago?checkout=success"
    assert cancel_url == "http://localhost:3000/store/nexo-gym-santiago?checkout=cancelled"


def test_build_public_checkout_urls_preserve_existing_query_and_add_return_urls() -> None:
    checkout_url, payment_link_url = build_public_checkout_urls(
        checkout_base_url="https://checkout.nexofitness.cl/start?tenant=nexo&channel=storefront",
        plan_id="plan_123",
        session_reference="session_456",
        success_url="nexofitness://checkout/success",
        cancel_url="nexofitness://checkout/cancel",
    )

    checkout_parts = urlsplit(checkout_url)
    checkout_query = parse_qs(checkout_parts.query)
    payment_parts = urlsplit(payment_link_url)
    payment_query = parse_qs(payment_parts.query)

    assert checkout_parts.path == "/start"
    assert checkout_query["tenant"] == ["nexo"]
    assert checkout_query["channel"] == ["storefront"]
    assert checkout_query["plan_id"] == ["plan_123"]
    assert checkout_query["session"] == ["session_456"]
    assert checkout_query["success_url"] == ["nexofitness://checkout/success"]
    assert checkout_query["cancel_url"] == ["nexofitness://checkout/cancel"]

    assert payment_parts.path == "/start/link/session_456"
    assert payment_query["tenant"] == ["nexo"]
    assert payment_query["channel"] == ["storefront"]
    assert payment_query["success_url"] == ["nexofitness://checkout/success"]
    assert payment_query["cancel_url"] == ["nexofitness://checkout/cancel"]
