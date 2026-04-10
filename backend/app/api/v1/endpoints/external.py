"""
External / Public API endpoints.

Authentication: OAuth2 client_credentials flow.
  POST /oauth/token   → returns a short-lived JWT (type=api_client)
  All /external/* endpoints require that JWT as Bearer token.

Rate limiting: Redis INCR-based sliding window (per client_id, 60-second windows).
"""

import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import redis as sync_redis
import structlog
from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import hash_password, verify_password
from app.models.business import ApiClient, BodyMeasurement, PersonalRecord
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.platform import (
    ApiClientCreate,
    ApiClientResponse,
    ApiClientUpdate,
    ApiClientWithSecret,
    BodyMeasurementCreate,
    BodyMeasurementResponse,
    OAuthTokenResponse,
    PersonalRecordCreate,
    PersonalRecordResponse,
)
from app.models.business import MembershipStatus

settings = get_settings()
logger = structlog.get_logger()

_API_CLIENT_TOKEN_EXPIRE_SECONDS = 3600  # 1 hour

oauth_router = APIRouter(prefix="/oauth", tags=["OAuth"])
api_clients_router = APIRouter(prefix="/api-clients", tags=["API Clients"])
external_router = APIRouter(prefix="/external", tags=["External API"])

_bearer = HTTPBearer()

# ─── Helpers ──────────────────────────────────────────────────────────────────

_ALPHABET = string.ascii_letters + string.digits


def _generate_client_id() -> str:
    """nxo_ + 20 random alphanumeric chars."""
    return "nxo_" + "".join(secrets.choice(_ALPHABET) for _ in range(20))


def _generate_client_secret() -> str:
    """48 cryptographically random alphanumeric chars."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(48))


def _create_api_client_token(client_id: str, tenant_id: str, scopes: list[str]) -> str:
    expires = datetime.now(timezone.utc) + timedelta(seconds=_API_CLIENT_TOKEN_EXPIRE_SECONDS)
    payload = {
        "sub": client_id,
        "tenant_id": tenant_id,
        "scopes": scopes,
        "exp": expires,
        "type": "api_client",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _decode_api_client_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o vencido.")
    if payload.get("type") != "api_client":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tipo de token inválido.")
    return payload


def _check_scope(payload: dict, required_scope: str) -> None:
    scopes: list = payload.get("scopes", [])
    if required_scope not in scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"El token no tiene el scope requerido: {required_scope}",
        )


def _check_rate_limit(client_id: str, tenant_id: str, limit_per_minute: int) -> None:
    """Simple Redis sliding window (1-minute bucket)."""
    try:
        r = sync_redis.from_url(settings.REDIS_URL, decode_responses=True, socket_timeout=1.0)
        key = f"api_rl:{tenant_id}:{client_id}"
        count = r.incr(key)
        if count == 1:
            r.expire(key, 60)
        if count > limit_per_minute:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Límite de {limit_per_minute} solicitudes/minuto superado.",
                headers={"Retry-After": "60"},
            )
    except HTTPException:
        raise
    except Exception:
        # Redis unavailable → fail open (don't block valid requests)
        pass


def _scopes_list(scopes_str: str) -> list[str]:
    return [s.strip() for s in scopes_str.split() if s.strip()]


def _scopes_str(scopes: list[str]) -> str:
    return " ".join(scopes)


def _client_to_response(c: ApiClient) -> ApiClientResponse:
    return ApiClientResponse(
        id=c.id,
        tenant_id=c.tenant_id,
        name=c.name,
        client_id=c.client_id,
        scopes=_scopes_list(c.scopes),
        rate_limit_per_minute=c.rate_limit_per_minute,
        is_active=c.is_active,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


# ─── OAuth token endpoint ──────────────────────────────────────────────────────

@oauth_router.post("/token", response_model=OAuthTokenResponse)
async def oauth_token(
    grant_type: str = Form(...),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> OAuthTokenResponse:
    """
    OAuth2 client_credentials grant.

    Returns a Bearer token valid for 1 hour.
    """
    if grant_type != "client_credentials":
        raise HTTPException(status_code=400, detail="Solo se soporta grant_type=client_credentials.")

    client = (await db.execute(
        select(ApiClient).where(ApiClient.client_id == client_id, ApiClient.is_active.is_(True))
    )).scalars().first()

    if not client or not verify_password(client_secret, client.client_secret_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas.")

    scopes = _scopes_list(client.scopes)
    token = _create_api_client_token(
        client_id=client.client_id,
        tenant_id=str(client.tenant_id),
        scopes=scopes,
    )
    logger.info("api_client_token_issued", client_id=client_id, tenant_id=str(client.tenant_id))
    return OAuthTokenResponse(
        access_token=token,
        expires_in=_API_CLIENT_TOKEN_EXPIRE_SECONDS,
        scope=_scopes_str(scopes),
    )


# ─── API clients admin (owner) ────────────────────────────────────────────────

from app.core.dependencies import get_current_tenant, get_current_user, require_roles
from app.models.user import UserRole


@api_clients_router.get("", response_model=list[ApiClientResponse])
async def list_api_clients(
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> list[ApiClientResponse]:
    result = await db.execute(
        select(ApiClient).where(ApiClient.tenant_id == tenant.id).order_by(ApiClient.created_at.desc())
    )
    return [_client_to_response(c) for c in result.scalars().all()]


@api_clients_router.post("", response_model=ApiClientWithSecret, status_code=201)
async def create_api_client(
    body: ApiClientCreate,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> ApiClientWithSecret:
    plain_secret = _generate_client_secret()
    client = ApiClient(
        tenant_id=tenant.id,
        name=body.name,
        client_id=_generate_client_id(),
        client_secret_hash=hash_password(plain_secret),
        scopes=_scopes_str(body.scopes),
        rate_limit_per_minute=body.rate_limit_per_minute,
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)
    base = _client_to_response(client)
    return ApiClientWithSecret(**base.model_dump(), client_secret=plain_secret)


@api_clients_router.patch("/{client_uuid}", response_model=ApiClientResponse)
async def update_api_client(
    client_uuid: UUID,
    body: ApiClientUpdate,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> ApiClientResponse:
    client = (await db.execute(
        select(ApiClient).where(ApiClient.id == client_uuid, ApiClient.tenant_id == tenant.id)
    )).scalars().first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente API no encontrado.")
    if body.name is not None:
        client.name = body.name
    if body.scopes is not None:
        client.scopes = _scopes_str(body.scopes)
    if body.rate_limit_per_minute is not None:
        client.rate_limit_per_minute = body.rate_limit_per_minute
    if body.is_active is not None:
        client.is_active = body.is_active
    await db.commit()
    await db.refresh(client)
    return _client_to_response(client)


@api_clients_router.delete("/{client_uuid}", status_code=204)
async def delete_api_client(
    client_uuid: UUID,
    tenant: Tenant = Depends(get_current_tenant),
    _user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> None:
    client = (await db.execute(
        select(ApiClient).where(ApiClient.id == client_uuid, ApiClient.tenant_id == tenant.id)
    )).scalars().first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente API no encontrado.")
    await db.delete(client)
    await db.commit()


# ─── External API (wearables / integrations) ──────────────────────────────────

async def _get_api_payload_and_client(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> tuple[dict, ApiClient]:
    """Validate Bearer token, load client, check rate limit."""
    payload = _decode_api_client_token(credentials.credentials)
    client = (await db.execute(
        select(ApiClient).where(
            ApiClient.client_id == payload["sub"],
            ApiClient.is_active.is_(True),
        )
    )).scalars().first()
    if not client:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cliente API desactivado o no encontrado.")
    _check_rate_limit(client.client_id, str(client.tenant_id), client.rate_limit_per_minute)
    return payload, client


def _measurement_to_response(m: BodyMeasurement) -> BodyMeasurementResponse:
    return BodyMeasurementResponse(
        id=m.id, user_id=m.user_id, tenant_id=m.tenant_id,
        recorded_at=m.recorded_at, weight_kg=m.weight_kg, body_fat_pct=m.body_fat_pct,
        muscle_mass_kg=m.muscle_mass_kg, chest_cm=m.chest_cm, waist_cm=m.waist_cm,
        hip_cm=m.hip_cm, arm_cm=m.arm_cm, thigh_cm=m.thigh_cm,
        notes=m.notes, created_at=m.created_at,
    )


def _pr_to_response(pr: PersonalRecord) -> PersonalRecordResponse:
    return PersonalRecordResponse(
        id=pr.id, user_id=pr.user_id, tenant_id=pr.tenant_id,
        exercise_name=pr.exercise_name, record_value=pr.record_value, unit=pr.unit,
        recorded_at=pr.recorded_at, notes=pr.notes, created_at=pr.created_at,
    )


async def _resolve_member(member_id: UUID, tenant_id: UUID, db: AsyncSession) -> User:
    """Resolve member_id to a User that belongs to the tenant."""
    user = await db.get(User, member_id)
    if not user or not user.is_active or str(user.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=404, detail="Miembro no encontrado en esta cuenta.")
    return user


@external_router.get("/members/{member_id}/measurements", response_model=list[BodyMeasurementResponse])
async def external_list_measurements(
    member_id: UUID,
    auth: tuple = Depends(_get_api_payload_and_client),
    db: AsyncSession = Depends(get_db),
) -> list[BodyMeasurementResponse]:
    payload, client = auth
    _check_scope(payload, "measurements:read")
    await _resolve_member(member_id, client.tenant_id, db)
    result = await db.execute(
        select(BodyMeasurement)
        .where(BodyMeasurement.user_id == member_id, BodyMeasurement.tenant_id == client.tenant_id)
        .order_by(BodyMeasurement.recorded_at.desc())
    )
    return [_measurement_to_response(m) for m in result.scalars().all()]


@external_router.post("/members/{member_id}/measurements", response_model=BodyMeasurementResponse, status_code=201)
async def external_create_measurement(
    member_id: UUID,
    body: BodyMeasurementCreate,
    auth: tuple = Depends(_get_api_payload_and_client),
    db: AsyncSession = Depends(get_db),
) -> BodyMeasurementResponse:
    payload, client = auth
    _check_scope(payload, "measurements:write")
    await _resolve_member(member_id, client.tenant_id, db)
    from uuid import uuid4
    m = BodyMeasurement(
        id=uuid4(), user_id=member_id, tenant_id=client.tenant_id,
        recorded_at=body.recorded_at, weight_kg=body.weight_kg, body_fat_pct=body.body_fat_pct,
        muscle_mass_kg=body.muscle_mass_kg, chest_cm=body.chest_cm, waist_cm=body.waist_cm,
        hip_cm=body.hip_cm, arm_cm=body.arm_cm, thigh_cm=body.thigh_cm, notes=body.notes,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    logger.info("external_measurement_created", client_id=client.client_id, member_id=str(member_id))
    return _measurement_to_response(m)


@external_router.get("/members/{member_id}/personal-records", response_model=list[PersonalRecordResponse])
async def external_list_personal_records(
    member_id: UUID,
    auth: tuple = Depends(_get_api_payload_and_client),
    db: AsyncSession = Depends(get_db),
) -> list[PersonalRecordResponse]:
    payload, client = auth
    _check_scope(payload, "records:read")
    await _resolve_member(member_id, client.tenant_id, db)
    result = await db.execute(
        select(PersonalRecord)
        .where(PersonalRecord.user_id == member_id, PersonalRecord.tenant_id == client.tenant_id)
        .order_by(PersonalRecord.recorded_at.desc())
    )
    return [_pr_to_response(pr) for pr in result.scalars().all()]


@external_router.post("/members/{member_id}/personal-records", response_model=PersonalRecordResponse, status_code=201)
async def external_create_personal_record(
    member_id: UUID,
    body: PersonalRecordCreate,
    auth: tuple = Depends(_get_api_payload_and_client),
    db: AsyncSession = Depends(get_db),
) -> PersonalRecordResponse:
    payload, client = auth
    _check_scope(payload, "records:write")
    await _resolve_member(member_id, client.tenant_id, db)
    from uuid import uuid4
    pr = PersonalRecord(
        id=uuid4(), user_id=member_id, tenant_id=client.tenant_id,
        exercise_name=body.exercise_name.strip(), record_value=body.record_value,
        unit=body.unit.strip(), recorded_at=body.recorded_at, notes=body.notes,
    )
    db.add(pr)
    await db.commit()
    await db.refresh(pr)
    logger.info("external_pr_created", client_id=client.client_id, member_id=str(member_id))
    return _pr_to_response(pr)
