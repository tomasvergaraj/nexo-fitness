"""Helpers for validating and composing tenant custom domains."""

from urllib.parse import urlsplit


def normalize_custom_domain(value: str | None) -> str | None:
    if value is None:
        return None

    raw = value.strip().lower().rstrip(".")
    if not raw:
        return None

    candidate = raw if "://" in raw else f"https://{raw}"
    parts = urlsplit(candidate)

    if not parts.hostname:
        raise ValueError("Ingresa un dominio valido, por ejemplo midominio.cl")
    if parts.username or parts.password:
        raise ValueError("El dominio personalizado no puede incluir credenciales")
    if parts.port is not None:
        raise ValueError("El dominio personalizado no puede incluir puertos")
    if parts.path not in {"", "/"} or parts.query or parts.fragment:
        raise ValueError("Ingresa solo el dominio, sin rutas ni parametros")

    hostname = parts.hostname.strip().lower().rstrip(".")
    labels = hostname.split(".")
    if len(labels) < 2:
        raise ValueError("Ingresa un dominio valido, por ejemplo midominio.cl")

    for label in labels:
        if not label or len(label) > 63:
            raise ValueError("El dominio personalizado no es valido")
        if label.startswith("-") or label.endswith("-"):
            raise ValueError("El dominio personalizado no es valido")
        if not all(char.isalnum() or char == "-" for char in label):
            raise ValueError("El dominio personalizado no es valido")

    return hostname


def domains_conflict(candidate: str, existing: str) -> bool:
    left = candidate.strip().lower().rstrip(".")
    right = existing.strip().lower().rstrip(".")
    if not left or not right:
        return False
    return left == right or left.endswith(f".{right}") or right.endswith(f".{left}")


def build_storefront_url(frontend_url: str, tenant_slug: str, custom_domain: str | None = None) -> str:
    try:
        normalized_domain = normalize_custom_domain(custom_domain)
    except ValueError:
        normalized_domain = None
    if normalized_domain:
        return f"https://{normalized_domain}"
    return f"{frontend_url.rstrip('/')}/store/{tenant_slug}"


def extract_hostname(value: str | None) -> str | None:
    if not value:
        return None

    parsed = urlsplit(value if "://" in value else f"https://{value}")
    return parsed.hostname.strip().lower().rstrip(".") if parsed.hostname else None
