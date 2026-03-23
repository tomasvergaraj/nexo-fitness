"""Tenant middleware — extracts tenant context from JWT and enforces isolation."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.security import decode_token


class TenantMiddleware(BaseHTTPMiddleware):
    """Extracts tenant_id from JWT and attaches to request state."""

    EXEMPT_PATHS = {"/health", "/docs", "/redoc", "/openapi.json", "/api/v1/auth/login",
                    "/api/v1/auth/register-gym", "/api/v1/auth/refresh"}

    async def dispatch(self, request: Request, call_next):
        # Skip auth for exempt paths
        if request.url.path in self.EXEMPT_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        # Extract token
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                payload = decode_token(token)
                request.state.user_id = payload.get("sub")
                request.state.tenant_id = payload.get("tenant_id")
                request.state.role = payload.get("role")
            except ValueError:
                pass  # Let the dependency handle auth errors

        return await call_next(request)
