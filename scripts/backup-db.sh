#!/usr/bin/env bash
# Backup diario de Postgres NexoFitness.
#
# Hace:
#   1. pg_dump custom-format (gzipeado nativo, restore selectivo).
#   2. Guarda local en /var/www/nexofitness/backups/.
#   3. Sube a Cloudflare R2 (off-site) si rclone remote "r2-backups" existe.
#   4. Retención local: 7 días. Retención R2: 30 días.
#
# Pensado para correr como cron 03:00 daily.
# Log: /var/log/nexofitness-backup.log
#
# Uso manual:
#   ./scripts/backup-db.sh
#   ./scripts/backup-db.sh --skip-remote   # solo local
#
# Requisitos en el VPS:
#   - docker compose con servicio "db" corriendo
#   - rclone instalado y remote "r2-backups" configurado (opcional para off-site)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS_DIR="${PROJECT_ROOT}/backups"
LOG_FILE="/var/log/nexofitness-backup.log"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
R2_REMOTE="r2-backups"
R2_BUCKET="nexofitness-backups"
R2_PATH="${R2_BUCKET}/postgres"
LOCAL_RETENTION_DAYS=7
REMOTE_RETENTION_DAYS=30

SKIP_REMOTE=0
for arg in "$@"; do
    case "$arg" in
        --skip-remote) SKIP_REMOTE=1 ;;
        *) echo "Flag desconocido: $arg"; exit 1 ;;
    esac
done

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

mkdir -p "$BACKUPS_DIR"
touch "$LOG_FILE"

TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
FILENAME="db-${TIMESTAMP}.dump"
LOCAL_PATH="${BACKUPS_DIR}/${FILENAME}"

log "── Inicio backup ──────────────────────────────────────────────"
log "Destino local: $LOCAL_PATH"

# pg_dump custom format (-Fc) — comprimido + permite restore selectivo de tablas.
if ! docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U nexo -Fc nexo_fitness > "$LOCAL_PATH"; then
    log "ERROR: pg_dump falló"
    rm -f "$LOCAL_PATH"
    exit 1
fi

SIZE=$(du -h "$LOCAL_PATH" | cut -f1)
log "Backup local OK ($SIZE)"

# Off-site a R2
if [ "$SKIP_REMOTE" -eq 0 ]; then
    if rclone listremotes 2>/dev/null | grep -q "^${R2_REMOTE}:"; then
        log "Subiendo a $R2_REMOTE:$R2_PATH/..."
        if rclone copy "$LOCAL_PATH" "${R2_REMOTE}:${R2_PATH}/" 2>>"$LOG_FILE"; then
            log "Upload R2 OK"
        else
            log "WARN: upload R2 falló (backup local intacto)"
        fi
    else
        log "WARN: rclone remote '$R2_REMOTE' no configurado. Skip off-site."
    fi
fi

# Retención local: borrar .dump más viejos que N días
log "Cleanup local (retención ${LOCAL_RETENTION_DAYS} días)..."
find "$BACKUPS_DIR" -maxdepth 1 -name "db-*.dump" -type f -mtime "+${LOCAL_RETENTION_DAYS}" -print -delete | tee -a "$LOG_FILE" || true

# Retención R2: borrar dumps remotos más viejos que N días
if [ "$SKIP_REMOTE" -eq 0 ] && rclone listremotes 2>/dev/null | grep -q "^${R2_REMOTE}:"; then
    log "Cleanup R2 (retención ${REMOTE_RETENTION_DAYS} días)..."
    rclone delete --min-age "${REMOTE_RETENTION_DAYS}d" "${R2_REMOTE}:${R2_PATH}/" 2>>"$LOG_FILE" || log "WARN: cleanup R2 falló"
fi

log "── Backup completado ──────────────────────────────────────────"
