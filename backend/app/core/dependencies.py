from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import decode_token
from app.models.tenant import Tenant
from app.models.user import User
from app.services.tenant_access_service import enforce_tenant_access

security_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate the current user from JWT."""
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return user


async def get_current_tenant(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Optional[Tenant]:
    """Get the tenant for the current user. Superadmins may not have a tenant."""
    if current_user.is_superadmin:
        # Superadmins can specify tenant via header or default to None
        return None

    if not current_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User has no tenant assigned")

    result = await db.execute(
        select(Tenant).options(selectinload(Tenant.users)).where(Tenant.id == current_user.tenant_id)
    )
    tenant = result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant not found or suspended")

    await enforce_tenant_access(db, tenant, current_user, now=datetime.now(timezone.utc))

    return tenant


def require_roles(*allowed_roles: str):
    """Dependency factory to enforce role-based access."""
    async def _check_role(current_user: User = Depends(get_current_user)):
        if current_user.is_superadmin:
            return current_user
        if current_user.role not in allowed_roles:
            role_name = getattr(current_user.role, "value", str(current_user.role))
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role_name}' not authorized for this action",
            )
        return current_user
    return _check_role


def require_superadmin():
    """Only allow platform superadmins."""
    async def _check(current_user: User = Depends(get_current_user)):
        if not current_user.is_superadmin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superadmin access required")
        return current_user
    return _check


class TenantContext:
    """Provides tenant-scoped database filtering."""

    def __init__(self, tenant: Optional[Tenant], user: User):
        self.tenant = tenant
        self.user = user
        self.tenant_id: Optional[UUID] = tenant.id if tenant else None
        self.is_superadmin = user.is_superadmin

    def enforce_tenant_filter(self, query, model):
        """Add tenant_id filter to any query. Superadmins bypass."""
        if self.is_superadmin:
            return query
        if hasattr(model, "tenant_id"):
            return query.where(model.tenant_id == self.tenant_id)
        return query


async def get_tenant_context(
    current_user: User = Depends(get_current_user),
    tenant: Optional[Tenant] = Depends(get_current_tenant),
) -> TenantContext:
    return TenantContext(tenant=tenant, user=current_user)
