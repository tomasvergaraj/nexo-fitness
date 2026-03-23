"""Nexo Fitness — Main FastAPI Application."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.api.v1.endpoints import auth, billing, dashboard, classes, clients

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"🏋️ {settings.APP_NAME} starting in {settings.APP_ENV} mode")
    yield
    # Shutdown
    print(f"🏋️ {settings.APP_NAME} shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    description="SaaS Multitenant para Gimnasios",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global error handler
@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(exc)})


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    if settings.DEBUG:
        return JSONResponse(status_code=500, content={"detail": str(exc)})
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# Health check
@app.get("/health")
async def health():
    return {"status": "healthy", "app": settings.APP_NAME, "version": "1.0.0"}


# Mount routers
prefix = settings.API_V1_PREFIX
app.include_router(auth.router, prefix=prefix)
app.include_router(billing.router, prefix=prefix)
app.include_router(dashboard.router, prefix=prefix)
app.include_router(classes.router, prefix=prefix)
app.include_router(clients.clients_router, prefix=prefix)
app.include_router(clients.plans_router, prefix=prefix)
app.include_router(clients.payments_router, prefix=prefix)
