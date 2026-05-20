#!/usr/bin/env bash
# Restore de un backup Postgres NexoFitness.
#
# CRÍTICO: este script SOBREESCRIBE la base de datos. Solo correr cuando
# se quiera rollback completo.
#
# Uso:
#   ./scripts/restore-db.sh /var/www/nexofitness/backups/db-20260520-030000.dump
#   ./scripts/restore-db.sh latest                              # último backup local
#   ./scripts/restore-db.sh r2:db-20260518-030000.dump          # baja desde R2 primero

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS_DIR="${PROJECT_ROOT}/backups"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
R2_REMOTE="r2-backups"
R2_PATH="postgres"

if [ $# -lt 1 ]; then
    echo "Uso: $0 <ruta-dump | latest | r2:NOMBRE>"
    exit 1
fi

TARGET="$1"

# Resolver "latest" → último .dump local
if [ "$TARGET" = "latest" ]; then
    TARGET=$(ls -1t "$BACKUPS_DIR"/db-*.dump 2>/dev/null | head -1 || true)
    if [ -z "$TARGET" ]; then
        echo "ERROR: no hay dumps en $BACKUPS_DIR"
        exit 1
    fi
    echo "→ Latest: $TARGET"
fi

# Resolver "r2:NOMBRE" → baja desde R2 a /tmp/
if [[ "$TARGET" == r2:* ]]; then
    REMOTE_NAME="${TARGET#r2:}"
    LOCAL_TMP="/tmp/${REMOTE_NAME}"
    echo "→ Bajando $REMOTE_NAME desde R2..."
    rclone copy "${R2_REMOTE}:${R2_PATH}/${REMOTE_NAME}" /tmp/
    TARGET="$LOCAL_TMP"
fi

if [ ! -f "$TARGET" ]; then
    echo "ERROR: archivo no encontrado: $TARGET"
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  RESTORE DE BASE DE DATOS — OPERACIÓN DESTRUCTIVA            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Archivo: $TARGET"
echo "║  DB target: nexo_fitness en docker compose 'db'"
echo "║                                                                "
echo "║  Esto VA A BORRAR todos los datos actuales y reemplazarlos.   "
echo "║  Asegúrate de que el backend NO está sirviendo tráfico.       "
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
read -p "Escribe 'RESTAURAR' (en mayúsculas) para continuar: " CONFIRM
if [ "$CONFIRM" != "RESTAURAR" ]; then
    echo "Abortado."
    exit 1
fi

echo ""
echo "── 1/3 Parando backend, worker, beat ──────────────────────────"
docker compose -f "$COMPOSE_FILE" stop backend worker beat

echo "── 2/3 Drop + recreate database ────────────────────────────────"
docker compose -f "$COMPOSE_FILE" exec -T db psql -U nexo -d postgres -c "DROP DATABASE IF EXISTS nexo_fitness;"
docker compose -f "$COMPOSE_FILE" exec -T db psql -U nexo -d postgres -c "CREATE DATABASE nexo_fitness;"

echo "── 3/3 pg_restore ──────────────────────────────────────────────"
docker compose -f "$COMPOSE_FILE" exec -T db pg_restore -U nexo -d nexo_fitness --no-owner --no-acl < "$TARGET"

echo ""
echo "── Levantando backend nuevamente ───────────────────────────────"
docker compose -f "$COMPOSE_FILE" start backend worker beat

echo ""
echo "✅ Restore listo. Verifica con: docker compose -f $COMPOSE_FILE logs -f backend"
