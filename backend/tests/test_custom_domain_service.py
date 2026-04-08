import pytest

from app.services.custom_domain_service import (
    build_storefront_url,
    domains_conflict,
    extract_hostname,
    normalize_custom_domain,
)


def test_normalize_custom_domain_accepts_plain_host() -> None:
    assert normalize_custom_domain("Gym.Example.COM") == "gym.example.com"


def test_normalize_custom_domain_rejects_paths_and_ports() -> None:
    with pytest.raises(ValueError, match="sin rutas ni parametros"):
        normalize_custom_domain("https://gym.example.com/store")

    with pytest.raises(ValueError, match="puertos"):
        normalize_custom_domain("gym.example.com:8443")


def test_domains_conflict_detects_exact_match_and_domain_overlap() -> None:
    assert domains_conflict("gym.example.com", "gym.example.com") is True
    assert domains_conflict("ventas.gym.example.com", "gym.example.com") is True
    assert domains_conflict("gym.example.com", "ventas.gym.example.com") is True
    assert domains_conflict("gym-a.example.com", "gym-b.example.com") is False


def test_build_storefront_url_prefers_custom_domain() -> None:
    assert (
        build_storefront_url("https://app.nexofitness.cl", "nexo-gym", "ventas.gym.cl")
        == "https://ventas.gym.cl"
    )
    assert (
        build_storefront_url("https://app.nexofitness.cl", "nexo-gym")
        == "https://app.nexofitness.cl/store/nexo-gym"
    )


def test_extract_hostname_returns_lowercase_hostname() -> None:
    assert extract_hostname("https://APP.NEXOFITNESS.CL/demo") == "app.nexofitness.cl"
    assert extract_hostname(None) is None
