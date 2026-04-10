"""Helpers to resolve support contact data exposed to clients."""

import json
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import Tenant
from app.models.user import User, UserRole

_EMPTY_CONTACT_VALUES = {"", "none", "null", "undefined", "n/a", "na"}


def load_tenant_feature_map(raw_value: str | None) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def clean_optional_contact_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    if normalized.lower() in _EMPTY_CONTACT_VALUES:
        return None
    return normalized


async def resolve_tenant_support_contacts(db: AsyncSession, tenant: Tenant) -> tuple[Optional[str], Optional[str]]:
    features = load_tenant_feature_map(tenant.features)
    owner_contact = (
        await db.execute(
            select(User.email, User.phone)
            .where(
                User.tenant_id == tenant.id,
                User.role == UserRole.OWNER,
                User.is_active == True,
            )
            .order_by(User.created_at.asc())
            .limit(1)
        )
    ).first()

    owner_email = clean_optional_contact_value(owner_contact.email if owner_contact else None)
    owner_phone = clean_optional_contact_value(owner_contact.phone if owner_contact else None)
    support_email = (
        clean_optional_contact_value(features.get("support_email"))
        or clean_optional_contact_value(tenant.email)
        or owner_email
    )
    support_phone = (
        clean_optional_contact_value(features.get("support_phone"))
        or clean_optional_contact_value(tenant.phone)
        or owner_phone
    )
    return support_email, support_phone
