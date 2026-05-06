"""CRUD + render helpers for the superadmin email templates editor.

Templates use ``{{var}}`` placeholders. Render replaces them with values from
a context dict, leaving unresolved tokens as the literal placeholder so missing
variables are visible in preview / output instead of silently swallowed."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import PlatformEmailTemplate

PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


# Built-in defaults — rendered into the DB on first GET if a template is missing.
DEFAULT_TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "trial_reminder",
        "name": "Recordatorio de prueba",
        "description": "Aviso al owner cuando faltan pocos días para que termine el trial.",
        "subject": "Tu prueba en Nexo Fitness termina en {{days_left}} días",
        "body_html": (
            "<p>Hola {{owner_name}},</p>"
            "<p>Tu período de prueba en <strong>{{gym_name}}</strong> termina en "
            "<strong>{{days_left}} días</strong>. Activa tu suscripción para no perder el acceso.</p>"
            "<p><a href=\"{{checkout_url}}\">Activar suscripción</a></p>"
            "<p>— Equipo Nexo Fitness</p>"
        ),
        "body_text": (
            "Hola {{owner_name}},\n\n"
            "Tu período de prueba en {{gym_name}} termina en {{days_left}} días.\n"
            "Activa tu suscripción aquí: {{checkout_url}}\n\n"
            "— Equipo Nexo Fitness"
        ),
        "variables": {
            "owner_name": "Tomás Vergara",
            "gym_name": "Studio Move",
            "days_left": "3",
            "checkout_url": "https://app.nexofitness.cl/billing/reactivate",
        },
    },
    {
        "key": "license_expiring",
        "name": "Licencia por vencer",
        "description": "Aviso al owner cuando la licencia activa vence pronto.",
        "subject": "Tu licencia de Nexo Fitness vence el {{expires_at}}",
        "body_html": (
            "<p>Hola {{owner_name}},</p>"
            "<p>La licencia de <strong>{{gym_name}}</strong> vence el "
            "<strong>{{expires_at}}</strong>. Renueva con un click para mantener todo activo.</p>"
            "<p><a href=\"{{checkout_url}}\">Renovar ahora</a></p>"
            "<p>— Equipo Nexo Fitness</p>"
        ),
        "body_text": (
            "Hola {{owner_name}},\n\n"
            "La licencia de {{gym_name}} vence el {{expires_at}}.\n"
            "Renueva aquí: {{checkout_url}}\n\n"
            "— Equipo Nexo Fitness"
        ),
        "variables": {
            "owner_name": "Tomás Vergara",
            "gym_name": "Studio Move",
            "expires_at": "18 may 2026",
            "checkout_url": "https://app.nexofitness.cl/billing/reactivate",
        },
    },
    {
        "key": "payment_failed",
        "name": "Pago rechazado",
        "description": "Aviso cuando un cobro automático falla.",
        "subject": "No pudimos cobrar tu plan {{plan_name}}",
        "body_html": (
            "<p>Hola {{owner_name}},</p>"
            "<p>El cobro de tu plan <strong>{{plan_name}}</strong> por "
            "<strong>{{amount}}</strong> fue rechazado.</p>"
            "<p>Por favor revisa el medio de pago o reintenta en "
            "<a href=\"{{checkout_url}}\">{{checkout_url}}</a>.</p>"
        ),
        "body_text": (
            "Hola {{owner_name}},\n\n"
            "El cobro de tu plan {{plan_name}} por {{amount}} fue rechazado.\n"
            "Reintenta aquí: {{checkout_url}}"
        ),
        "variables": {
            "owner_name": "Tomás Vergara",
            "plan_name": "Mensual",
            "amount": "$34.990",
            "checkout_url": "https://app.nexofitness.cl/billing/reactivate",
        },
    },
    {
        "key": "welcome",
        "name": "Bienvenida",
        "description": "Email de bienvenida al activar la cuenta.",
        "subject": "Bienvenido a Nexo Fitness, {{owner_name}}",
        "body_html": (
            "<p>Hola {{owner_name}},</p>"
            "<p>Tu cuenta de <strong>{{gym_name}}</strong> está lista. "
            "Empieza por configurar tus planes y publicar tu tienda online en "
            "<a href=\"{{dashboard_url}}\">{{dashboard_url}}</a>.</p>"
            "<p>Cualquier duda, escríbenos a contacto@nexofitness.cl.</p>"
        ),
        "body_text": (
            "Hola {{owner_name}},\n\n"
            "Tu cuenta de {{gym_name}} está lista.\n"
            "Empieza acá: {{dashboard_url}}"
        ),
        "variables": {
            "owner_name": "Tomás Vergara",
            "gym_name": "Studio Move",
            "dashboard_url": "https://app.nexofitness.cl/dashboard",
        },
    },
]


class PlatformEmailTemplateService:
    """List, get, upsert and render email templates."""

    @staticmethod
    def render(template_str: str, context: dict[str, Any]) -> str:
        def _sub(match: re.Match[str]) -> str:
            key = match.group(1)
            value = context.get(key)
            if value is None:
                return match.group(0)
            return str(value)

        return PLACEHOLDER_RE.sub(_sub, template_str or "")

    @staticmethod
    def extract_placeholders(*texts: str) -> list[str]:
        seen: list[str] = []
        for text in texts:
            if not text:
                continue
            for match in PLACEHOLDER_RE.finditer(text):
                key = match.group(1)
                if key not in seen:
                    seen.append(key)
        return seen

    @staticmethod
    async def ensure_defaults(db: AsyncSession) -> None:
        existing_keys = set(
            (await db.execute(select(PlatformEmailTemplate.key))).scalars().all()
        )
        added = 0
        for spec in DEFAULT_TEMPLATES:
            if spec["key"] in existing_keys:
                continue
            db.add(PlatformEmailTemplate(
                key=spec["key"],
                name=spec["name"],
                description=spec.get("description"),
                subject=spec["subject"],
                body_html=spec["body_html"],
                body_text=spec.get("body_text"),
                variables=spec.get("variables") or {},
                is_active=True,
            ))
            added += 1
        if added > 0:
            await db.commit()

    @staticmethod
    async def list(db: AsyncSession) -> list[dict[str, Any]]:
        await PlatformEmailTemplateService.ensure_defaults(db)
        rows = (
            await db.execute(select(PlatformEmailTemplate).order_by(PlatformEmailTemplate.key))
        ).scalars().all()
        return [PlatformEmailTemplateService._to_dict(row) for row in rows]

    @staticmethod
    async def get_by_key(db: AsyncSession, key: str) -> Optional[dict[str, Any]]:
        row = (
            await db.execute(select(PlatformEmailTemplate).where(PlatformEmailTemplate.key == key))
        ).scalar_one_or_none()
        return PlatformEmailTemplateService._to_dict(row) if row else None

    @staticmethod
    async def upsert(
        db: AsyncSession,
        *,
        key: str,
        name: str,
        subject: str,
        body_html: str,
        body_text: Optional[str] = None,
        description: Optional[str] = None,
        variables: Optional[dict[str, Any]] = None,
        is_active: bool = True,
        updated_by_user_id: Optional[UUID] = None,
    ) -> dict[str, Any]:
        row = (
            await db.execute(select(PlatformEmailTemplate).where(PlatformEmailTemplate.key == key))
        ).scalar_one_or_none()
        if row is None:
            row = PlatformEmailTemplate(key=key)
            db.add(row)
        row.name = name
        row.description = description
        row.subject = subject
        row.body_html = body_html
        row.body_text = body_text
        row.variables = variables or {}
        row.is_active = bool(is_active)
        row.updated_by_user_id = updated_by_user_id
        row.updated_at = datetime.now(timezone.utc)
        await db.flush()
        return PlatformEmailTemplateService._to_dict(row)

    @staticmethod
    def render_template(template: dict[str, Any], context: dict[str, Any]) -> dict[str, str]:
        ctx = {**(template.get("variables") or {}), **context}
        return {
            "subject": PlatformEmailTemplateService.render(template["subject"], ctx),
            "body_html": PlatformEmailTemplateService.render(template["body_html"], ctx),
            "body_text": PlatformEmailTemplateService.render(template.get("body_text") or "", ctx),
        }

    @staticmethod
    def _to_dict(row: PlatformEmailTemplate) -> dict[str, Any]:
        placeholders = PlatformEmailTemplateService.extract_placeholders(
            row.subject, row.body_html, row.body_text or ""
        )
        return {
            "id": str(row.id),
            "key": row.key,
            "name": row.name,
            "description": row.description,
            "subject": row.subject,
            "body_html": row.body_html,
            "body_text": row.body_text,
            "variables": row.variables or {},
            "placeholders": placeholders,
            "is_active": row.is_active,
            "updated_by_user_id": str(row.updated_by_user_id) if row.updated_by_user_id else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
