# Backups de Postgres — NexoFitness

Snapshot diario automático del cluster `nexo_fitness`. Doble destino:
- **Local**: `/var/www/nexofitness/backups/` (retención 7 días).
- **Off-site (Cloudflare R2)**: `r2-backups:postgres/` (retención 30 días).

Scripts en `scripts/backup-db.sh` (corre en cron) y `scripts/restore-db.sh` (manual).

---

## Setup inicial (una sola vez en el VPS)

### 1. Configurar rclone remote para R2

```bash
rclone config

# Pasos en el wizard:
#   n) New remote
#   name> r2-backups
#   Storage> s3
#   provider> Cloudflare
#   env_auth> false
#   access_key_id> <R2 token con permisos R/W al bucket>
#   secret_access_key> <secret del token>
#   region> auto
#   endpoint> https://<ACCOUNT_ID>.r2.cloudflarestorage.com
#   location_constraint> (vacío)
#   acl> private
```

Verificar:
```bash
rclone listremotes              # debe incluir "r2-backups:"
rclone lsd r2-backups:          # debe listar buckets accesibles
```

Crear bucket `nexofitness-backups` desde el dashboard de Cloudflare R2 si no existe. Activar **Object Lifecycle Rule** opcional para borrar objetos >35d como fallback al cleanup del script.

### 2. Permisos del script

```bash
chmod +x /var/www/nexofitness/scripts/backup-db.sh
chmod +x /var/www/nexofitness/scripts/restore-db.sh
```

### 3. Probar manual primero

```bash
cd /var/www/nexofitness
./scripts/backup-db.sh

# Verificar:
ls -lh backups/                                  # debe haber db-<timestamp>.dump
rclone ls r2-backups:postgres/                   # debe mostrar el dump remoto
tail -20 /var/log/nexofitness-backup.log         # log limpio
```

### 4. Instalar cron diario

```bash
crontab -e

# Agregar línea (corre todos los días a las 03:00 hora del servidor):
0 3 * * * /var/www/nexofitness/scripts/backup-db.sh >> /var/log/nexofitness-backup.log 2>&1
```

Verificar:
```bash
crontab -l | grep backup
```

---

## Restore

### Caso 1: rollback al último backup local

```bash
cd /var/www/nexofitness
./scripts/restore-db.sh latest
```

El script pide confirmación `RESTAURAR` antes de tocar nada.

### Caso 2: restore desde R2 (si VPS fue reinstalado)

```bash
# Listar backups remotos disponibles
rclone ls r2-backups:postgres/

# Restaurar uno específico
./scripts/restore-db.sh r2:db-20260518-030000.dump
```

### Caso 3: restore parcial (solo una tabla)

`pg_dump -Fc` permite restore selectivo:

```bash
# Ver contenido del dump
docker compose -f docker-compose.prod.yml exec -T db pg_restore -l < backups/db-20260520-030000.dump

# Restaurar solo tabla "users" sobre DB actual (cuidado: agrega, no reemplaza)
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U nexo -d nexo_fitness -t users < backups/db-20260520-030000.dump
```

---

## Verificación mensual obligatoria

Una vez al mes, restaurar un dump random en un Postgres local para confirmar que no están corruptos:

```bash
# En tu laptop
docker run -d --name pg-test -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:15-alpine
# Copiar dump desde el VPS
scp root@vps:/var/www/nexofitness/backups/db-<timestamp>.dump /tmp/
# Restore
docker exec -i pg-test pg_restore -U postgres -d postgres < /tmp/db-<timestamp>.dump
# Spot-check
docker exec -it pg-test psql -U postgres -c "\dt"
docker exec -it pg-test psql -U postgres -c "SELECT count(*) FROM tenants;"
# Cleanup
docker rm -f pg-test
```

Si falla → investigar `backup-db.sh` antes de necesitar un restore real.

---

## Monitoreo

El script loguea a `/var/log/nexofitness-backup.log`. Para alertas:

```bash
# Última corrida
tail -50 /var/log/nexofitness-backup.log

# Confirmar que corrió hoy (sale empty si NO corrió, malo)
grep "$(date '+%Y-%m-%d')" /var/log/nexofitness-backup.log | grep "Backup completado"
```

**Stretch (P2):** integrar con Sentry cron monitoring (free tier) o healthchecks.io para alertar si pasa >25h sin completar.

---

## Costo R2

- Storage: USD 0.015 / GB-mes.
- Egress (download): gratis dentro de Cloudflare.

Asumiendo dump comprimido de 50MB × 30 días = ~1.5GB → **~USD 0.02/mes**. Negligible.

---

## Cuándo NO confiar en los backups

- Justo después de un cambio de schema (alembic upgrade). El backup del día previo no incluye la columna nueva. Hacer dump manual antes de migraciones grandes:
  ```bash
  ./scripts/backup-db.sh
  # ...después: alembic upgrade head
  ```
- Si el VPS pierde acceso a R2 durante días: el log avisa con "WARN: upload R2 falló". Revisar.
- Backups locales solo: si el VPS muere físicamente, el disco se va con él. Por eso R2 es obligatorio.
