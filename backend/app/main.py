"""Nexo Fitness — Main FastAPI Application."""

import logging
from contextlib import asynccontextmanager

import os
from pathlib import Path

import sentry_sdk
import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import engine
from app.core.exceptions import ActionRequiredError
from app.api.v1.endpoints import auth, billing, dashboard, classes, clients, external, operations, public
from app.middleware.tenant import TenantMiddleware

settings = get_settings()

# ---------------------------------------------------------------------------
# Structured logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(message)s",
)
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.JSONRenderer() if not settings.DEBUG
        else structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        logging.DEBUG if settings.DEBUG else logging.INFO
    ),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

logger = structlog.get_logger()

# ---------------------------------------------------------------------------
# Sentry
# ---------------------------------------------------------------------------
if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.APP_ENV,
        integrations=[
            FastApiIntegration(),
            SqlalchemyIntegration(),
        ],
        traces_sample_rate=0.2,
        send_default_pii=False,
    )
    logger.info("sentry_enabled", dsn_prefix=settings.SENTRY_DSN[:30])


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("app_startup", app=settings.APP_NAME, env=settings.APP_ENV)
    yield
    logger.info("app_shutdown", app=settings.APP_NAME)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title=settings.APP_NAME,
    description="SaaS Multitenant para Gimnasios",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS
app.add_middleware(TenantMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Tenant-ID"],
)


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------
@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    logger.warning("validation_error", path=request.url.path, detail=str(exc))
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": str(exc)},
    )


@app.exception_handler(ActionRequiredError)
async def action_required_error_handler(request: Request, exc: ActionRequiredError):
    logger.warning("action_required", path=request.url.path, detail=exc.detail, next_action=exc.next_action)
    return JSONResponse(status_code=exc.status_code, content=exc.to_response())


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.error("unhandled_exception", path=request.url.path, exc_info=exc)
    if settings.DEBUG:
        return JSONResponse(status_code=500, content={"detail": str(exc)})
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health", tags=["ops"])
async def health():
    checks: dict = {"db": "unknown", "redis": "unknown"}

    # Database ping
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as exc:
        logger.error("health_db_fail", exc_info=exc)
        checks["db"] = "error"

    # Redis ping
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as exc:
        logger.error("health_redis_fail", exc_info=exc)
        checks["redis"] = "error"

    overall = "healthy" if all(v == "ok" for v in checks.values()) else "degraded"
    http_status = 200 if overall == "healthy" else 503
    return JSONResponse(
        status_code=http_status,
        content={"status": overall, "app": settings.APP_NAME, "checks": checks},
    )


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
prefix = settings.API_V1_PREFIX
app.include_router(auth.router, prefix=prefix)
app.include_router(billing.router, prefix=prefix)
app.include_router(dashboard.router, prefix=prefix)
app.include_router(classes.router, prefix=prefix)
app.include_router(clients.clients_router, prefix=prefix)
app.include_router(clients.plans_router, prefix=prefix)
app.include_router(clients.payments_router, prefix=prefix)
app.include_router(operations.branches_router, prefix=prefix)
app.include_router(operations.memberships_router, prefix=prefix)
app.include_router(operations.campaigns_router, prefix=prefix)
app.include_router(operations.support_router, prefix=prefix)
app.include_router(operations.staff_router, prefix=prefix)
app.include_router(operations.upload_router, prefix=prefix)
app.include_router(operations.programs_router, prefix=prefix)
app.include_router(operations.settings_router, prefix=prefix)
app.include_router(operations.reports_router, prefix=prefix)
app.include_router(operations.notifications_router, prefix=prefix)
app.include_router(operations.payment_accounts_router, prefix=prefix)
app.include_router(operations.mobile_router, prefix=prefix)
app.include_router(operations.promo_codes_router, prefix=prefix)
app.include_router(operations.progress_router, prefix=prefix)
app.include_router(operations.personal_records_router, prefix=prefix)
app.include_router(external.oauth_router, prefix=prefix)
app.include_router(external.api_clients_router, prefix=prefix)
app.include_router(external.external_router, prefix=prefix)
app.include_router(public.public_router, prefix=prefix)
app.include_router(public.platform_router, prefix=prefix)

# Serve uploaded files (logos, etc.) — in prod nginx handles this directly
_uploads_dir = Path(os.getenv("UPLOADS_DIR", "uploads"))
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")
