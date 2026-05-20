"""Tenant settings router (branding, billing email, feature flags, custom domain)."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import (
    get_current_tenant,
    require_roles,
)
from app.models.tenant import Tenant
from app.schemas.platform import TenantSettingsResponse, TenantSettingsUpdateRequest
from app.services.branding_service import (
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_SECONDARY_COLOR,
    coerce_brand_color,
    normalize_brand_color,
)
from app.services.custom_domain_service import (
    domains_conflict,
    extract_hostname,
    normalize_custom_domain,
)
from app.services.support_contact_service import resolve_tenant_support_contacts

from ._common import _feature_map, _save_feature_map


settings_router = APIRouter(prefix="/settings", tags=["Settings"])

settings = get_settings()


async def _ensure_custom_domain_is_available(
    db: AsyncSession,
    *,
    candidate_domain: str,
    tenant_id: UUID,
) -> None:
    reserved_hosts = {
        host
        for host in {
            extract_hostname(settings.FRONTEND_URL),
            extract_hostname(settings.public_app_url),
        }
        if host
    }

    for host in reserved_hosts:
        if candidate_domain == host:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"El dominio {candidate_domain} ya esta reservado por la plataforma principal. "
                    "Usa otro dominio o subdominio."
                ),
            )

    existing_tenants = (
        await db.execute(
            select(Tenant.id, Tenant.name, Tenant.custom_domain).where(
                Tenant.id != tenant_id,
                Tenant.custom_domain.is_not(None),
            )
        )
    ).all()

    for _existing_tenant_id, existing_name, existing_domain in existing_tenants:
        if not existing_domain:
            continue
        try:
            normalized_existing = normalize_custom_domain(existing_domain)
        except ValueError:
            continue
        if not normalized_existing:
            continue
        if domains_conflict(candidate_domain, normalized_existing):
            if candidate_domain == normalized_existing:
                detail = (
                    f"El dominio {candidate_domain} ya esta siendo usado por el tenant {existing_name}. "
                    "Debe ser unico."
                )
            else:
                detail = (
                    f"El dominio {candidate_domain} entra en conflicto con {normalized_existing} del tenant "
                    f"{existing_name}. Usa un dominio que no sea padre ni subdominio de otro tenant."
                )
            raise HTTPException(status_code=409, detail=detail)


@settings_router.get("", response_model=TenantSettingsResponse)
async def get_tenant_settings(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("owner", "admin")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    features = _feature_map(tenant)
    support_email, support_phone = await resolve_tenant_support_contacts(db, tenant)
    primary_color = coerce_brand_color(tenant.primary_color, DEFAULT_PRIMARY_COLOR)
    secondary_color = coerce_brand_color(tenant.secondary_color, DEFAULT_SECONDARY_COLOR)
    try:
        custom_domain = normalize_custom_domain(tenant.custom_domain)
    except ValueError:
        custom_domain = tenant.custom_domain

    return TenantSettingsResponse(
        slug=tenant.slug,
        gym_name=tenant.name,
        email=tenant.email,
        phone=tenant.phone,
        city=tenant.city,
        address=tenant.address,
        primary_color=primary_color,
        secondary_color=secondary_color,
        logo_url=tenant.logo_url,
        custom_domain=custom_domain,
        billing_email=str(features.get("billing_email", tenant.email)),
        support_email=support_email,
        support_phone=support_phone,
        public_api_key=str(features.get("public_api_key", f"nexo_live_{tenant.slug.replace('-', '_')}")),
        marketplace_headline=str(features.get("marketplace_headline", f"{tenant.name}: planes, clases y reservas online")),
        marketplace_description=str(features.get("marketplace_description", "Compra tu plan, reserva tus clases y administra tu membresia en un solo lugar.")),
        reminder_emails=bool(features.get("reminder_emails", True)),
        reminder_whatsapp=bool(features.get("reminder_whatsapp", True)),
        staff_can_edit_plans=bool(features.get("staff_can_edit_plans", False)),
        two_factor_required=bool(features.get("two_factor_required", False)),
        public_checkout_enabled=bool(features.get("public_checkout_enabled", True)),
        branding={
            "logo_url": tenant.logo_url,
            "primary_color": primary_color,
            "secondary_color": secondary_color,
            "custom_domain": custom_domain,
            "support_email": support_email,
            "support_phone": support_phone,
            "marketplace_headline": str(features.get("marketplace_headline", "")) or None,
            "marketplace_description": str(features.get("marketplace_description", "")) or None,
        },
    )


@settings_router.patch("", response_model=TenantSettingsResponse)
async def update_tenant_settings(
    data: TenantSettingsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin")),
):
    if tenant is None:
        raise HTTPException(status_code=400, detail="Se requiere el contexto de la cuenta")

    payload = data.model_dump(exclude_unset=True)
    color_labels = {
        "primary_color": "color principal",
        "secondary_color": "color secundario",
    }
    for field, label in color_labels.items():
        if field not in payload:
            continue
        try:
            payload[field] = normalize_brand_color(
                payload[field],
                field_label=label,
                default=DEFAULT_PRIMARY_COLOR if field == "primary_color" else DEFAULT_SECONDARY_COLOR,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    if "custom_domain" in payload:
        try:
            payload["custom_domain"] = normalize_custom_domain(payload["custom_domain"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        if payload["custom_domain"]:
            await _ensure_custom_domain_is_available(
                db,
                candidate_domain=payload["custom_domain"],
                tenant_id=tenant.id,
            )

    tenant_field_map = {
        "gym_name": "name",
        "email": "email",
        "phone": "phone",
        "city": "city",
        "address": "address",
        "primary_color": "primary_color",
        "secondary_color": "secondary_color",
        "logo_url": "logo_url",
        "custom_domain": "custom_domain",
    }
    feature_updates: dict[str, Any] = {}

    for field, value in payload.items():
        tenant_field = tenant_field_map.get(field)
        if tenant_field:
            setattr(tenant, tenant_field, value)
        else:
            feature_updates[field] = value

    if feature_updates:
        _save_feature_map(tenant, feature_updates)

    await db.flush()
    return await get_tenant_settings(tenant=tenant, db=db)
