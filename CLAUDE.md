# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NexoFitness — SaaS multitenant platform for gym management. Stack: FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL 15 backend, React 18 + Vite + TypeScript + Tailwind CSS frontend, Celery + Redis for background tasks, Nginx as reverse proxy.

## Commands

### Frontend

```bash
cd frontend

# IMPORTANT: Nginx serves the static dist/ folder. After ANY frontend change you must rebuild.
node_modules/.bin/vite build          # Production build (npm not in PATH on this server)

# Local dev
node_modules/.bin/vite                # Dev server on port 3000

# Type check + lint (CI runs both)
npx tsc --noEmit
npm run lint                          # ESLint
```

### Backend

```bash
cd backend
source venv/bin/activate

uvicorn app.main:app --reload --port 8000   # Dev server

# Tests
pytest -v                                   # All tests
pytest tests/test_auth_service.py           # Single file
pytest tests/test_auth_service.py::test_fn  # Single test

# Linting / types
ruff check app/
mypy app --strict

# Migrations
alembic revision --autogenerate -m "description"
alembic upgrade head
alembic downgrade -1
```

### Docker

```bash
docker compose up                           # Dev stack
docker compose exec backend alembic upgrade head
docker compose exec backend pytest -v
```

## Architecture

### Multitenancy

Shared database, shared schema. Every domain table has a `tenant_id` column. Isolation is enforced at three layers:

1. **Middleware** (`backend/app/middleware/tenant.py`): extracts `tenant_id` from the JWT and sets `request.state.tenant_id`. Exempt prefixes: `/api/v1/public/`, `/api/v1/billing/public/`, `/health`, `/docs`, `/uploads/`.
2. **Dependencies** (`backend/app/core/dependencies.py`): injects `current_user`, `tenant_id`, and `AsyncSession` into every route handler.
3. **Service layer**: every query filters by `tenant_id`. Never omit this filter when writing new queries.

### Backend layers

```
endpoints/   → thin route handlers, input validation, call one service
services/    → all business logic; 22+ service files, one per domain
models/      → SQLAlchemy ORM (async); files: tenant, user, business, platform, pos
schemas/     → Pydantic v2 request/response models
integrations/→ email (Resend), payments (Stripe/WebPay/Fintoc/MercadoPago), WhatsApp
tasks/       → Celery background jobs (auto_renewal, notifications)
```

`operations.py` and `classes.py` are the largest endpoint files (~163KB and ~91KB). Prefer searching them rather than assuming structure.

### Frontend layers

```
pages/       → one folder per domain; page components are colocated with their sub-components
components/  → shared UI (components/ui/) and layout (components/layout/)
services/api.ts → single Axios instance; request interceptor attaches Bearer token;
                  response interceptor handles 401 (refresh flow) and 403 billing redirect
stores/      → Zustand: authStore (persisted, tokens + user), themeStore
types/index.ts → all TypeScript interfaces (~32KB, single source of truth)
router.tsx   → React Router v6; AuthGuard wraps protected routes; role-based redirects
```

### Auth flow

JWT access token (30 min) + refresh token (7 days). Axios interceptor on 401 calls `POST /api/v1/auth/refresh`, retries the original request, or redirects to login on failure. On 403 with `billing_status` field, redirects to `/billing/expired`.

### SaaS billing

- `Tenant` model holds `status` (TRIAL/ACTIVE/SUSPENDED/CANCELLED), `license_type`, `license_expires_at`, `trial_ends_at`, and a `features` JSON blob (stores active plan key, plan name, feature flags).
- `PlatformBillingPayment` records every payment transaction.
- `SaaSPlanDefinition` in `saas_plan_service.py` defines plan tiers (monthly/quarterly/semi_annual/annual) with pricing, discount, limits, and checkout provider flags.
- Tax: 19% IVA on CLP; other currencies: 0%.
- Checkout providers: Stripe (primary), WebPay, Fintoc, manual transfer.
- `POST /billing/reactivate` generates a checkout URL for expired tenants.

### Nginx / deployment

- Nginx (`nginx/nginx.conf`) serves `frontend/dist/` as static files, proxies `/api/v1/` to `backend:8000`.
- SPA fallback: all non-asset requests → `index.html`.
- Asset caching: JS/CSS/fonts → 1 year immutable; `index.html` and `sw.js` → no-cache.
- **Always run `node_modules/.bin/vite build` after frontend changes** — the dev server is not used in production.

### Testing patterns

Backend tests use `pytest` with `asyncio_mode = "auto"`. Factory functions (e.g. `make_tenant(**overrides)`) build model instances with sensible defaults. DB is mocked via a `DummyDb` fixture. Tests live in `backend/tests/`, one file per service. CI requires `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `JWT_SECRET_KEY`, `APP_ENV=testing`.

## Key conventions

- **Spanish UI**: all user-visible strings are in Spanish (es-CL locale).
- **Line length**: 120 chars (backend), standard ESLint (frontend).
- **Async everywhere**: backend uses `async def` and `await` throughout; SQLAlchemy sessions are `AsyncSession`.
- **Config**: `backend/app/core/config.py` uses Pydantic Settings with `.env`. All secrets via env vars; production mode rejects insecure defaults.
- Sidebar navigation roles: `owner` and `admin` see management pages; `reception` sees check-in and classes; `trainer` sees assigned classes; members use the `/member/` routes (separate public-facing layout).
