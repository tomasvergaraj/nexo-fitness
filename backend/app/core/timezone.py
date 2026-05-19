"""Helpers de timezone para operar con la zona horaria del tenant.

Centraliza la conversión UTC ↔ zona local del tenant. Antes estaban duplicados
en endpoints/classes.py y services/class_bulk_service.py. Ver memoria
`feedback_tenant_timezone`: SIEMPRE convertir a tenant.timezone antes de
strftime para texto visible.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.dependencies import TenantContext


def tenant_zone(ctx: TenantContext) -> ZoneInfo:
    tenant_timezone = ctx.tenant.timezone if ctx.tenant and ctx.tenant.timezone else "UTC"
    try:
        return ZoneInfo(tenant_timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def tenant_local_day_bounds(day: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """Devuelve [start, end) UTC del día `day` en `zone`."""
    day_start_local = datetime.combine(day, time.min, tzinfo=zone)
    next_day_local = day_start_local + timedelta(days=1)
    return day_start_local.astimezone(timezone.utc), next_day_local.astimezone(timezone.utc)


def shift_in_zone(dt_utc: datetime, days_delta: int, zone: ZoneInfo) -> datetime:
    """Shift `dt_utc` por N días preservando la hora de pared en `zone`.

    Why: timedelta(days=N) sobre UTC son 24h exactas. Si hay transición DST
    entre origen y destino, la hora local drifta 1h. Recomputar la fecha
    en hora local mantiene una clase 20:00 a 20:00 a través de DST.
    """
    local = dt_utc.astimezone(zone)
    new_date = local.date() + timedelta(days=days_delta)
    new_local = datetime.combine(new_date, local.time(), tzinfo=zone)
    return new_local.astimezone(timezone.utc)
