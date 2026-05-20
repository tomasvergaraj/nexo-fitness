#!/usr/bin/env bash
# Deploy de producción para NexoFitness.
#
# Corre en el VPS, dentro de /var/www/nexofitness/, en branch main.
#
# Pasos:
#   1. git pull origin main
#   2. docker compose -f docker-compose.prod.yml up -d --build  (backend, worker, beat)
#   3. alembic upgrade head
#   4. vite build (frontend)
#   5. Recargar nginx (opcional, no requerido salvo cambios en nginx/)
#
# Uso:
#   ./deploy.sh                    # deploy completo
#   ./deploy.sh --skip-build       # solo pull + migrations (cambios sólo backend, sin frontend)
#   ./deploy.sh --skip-migrations  # sin alembic (rebuild rápido sin tocar DB)

set -euo pipefail

cd "$(dirname "$0")"

SKIP_BUILD=0
SKIP_MIGRATIONS=0
for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=1 ;;
        --skip-migrations) SKIP_MIGRATIONS=1 ;;
        *) echo "Flag desconocido: $arg"; exit 1 ;;
    esac
done

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "ERROR: estás en branch '$CURRENT_BRANCH', no en main. Cambia con: git checkout main"
    exit 1
fi

echo "── 1/4 git pull ────────────────────────────────────────────────"
git pull origin main

echo "── 2/4 docker compose up --build ──────────────────────────────"
docker compose -f docker-compose.prod.yml up -d --build backend worker beat

if [ "$SKIP_MIGRATIONS" -eq 0 ]; then
    echo "── 3/4 alembic upgrade head ───────────────────────────────────"
    docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head
else
    echo "── 3/4 alembic upgrade head (SKIPPED) ─────────────────────────"
fi

if [ "$SKIP_BUILD" -eq 0 ]; then
    echo "── 4/4 vite build ──────────────────────────────────────────────"
    cd frontend
    node_modules/.bin/vite build
    cd ..
else
    echo "── 4/4 vite build (SKIPPED) ────────────────────────────────────"
fi

echo ""
echo "✅ Deploy listo. SHA: $(git rev-parse --short HEAD)"
echo ""
docker compose -f docker-compose.prod.yml ps --format "table {{.Service}}\t{{.Status}}"
