# Comandos Utiles

Guia rapida para trabajar en Nexo Fitness desde la raiz del proyecto:

```bash
cd /var/www/nexofitness
```

## Docker y servicios

```bash
# Levantar todo
docker compose up -d

# Ver estado de los servicios
docker compose ps
docker compose ps --services

# Reiniciar un servicio puntual
docker compose restart backend
docker compose restart frontend

# Si cambiaste variables en backend/.env, recrea el contenedor para releer env_file
docker compose up -d --force-recreate backend
docker compose up -d --force-recreate backend worker beat

# Ver logs recientes
docker compose logs --tail=100 backend
docker compose logs --tail=100 frontend
docker compose logs --tail=100 worker

# Seguir logs en vivo
docker compose logs -f backend
docker compose logs -f frontend
```

## Salud y diagnostico

```bash
# Health check local
curl -s http://127.0.0.1:8000/health

# Backend dentro del contenedor
docker compose exec -T backend python -c "import os; print(os.getenv('APP_ENV'))"

# Ver credenciales cargadas sin imprimirlas completas
docker compose exec -T backend python -c "import os; print((os.getenv('WEBPAY_COMMERCE_CODE') or '')[:6]); print((os.getenv('FINTOC_SECRET_KEY') or '')[:8])"
```

## Base de datos

```bash
# Entrar a Postgres
docker compose exec db psql -U nexo -d nexo_fitness

# Listar tenants recientes
docker compose exec -T db psql -U nexo -d nexo_fitness -c "select id, name, slug, created_at from tenants order by created_at desc limit 10;"

# Ver transacciones Webpay recientes
docker compose exec -T db psql -U nexo -d nexo_fitness -c "select id, flow_type, status, response_code, transaction_status, token, created_at from webpay_transactions order by created_at desc limit 10;"

# Ver planes SaaS
docker compose exec -T db psql -U nexo -d nexo_fitness -c "select key, name, price, is_public, is_active from saas_plans order by created_at asc;"
```

## Migraciones y seeds

```bash
# Aplicar migraciones
docker compose exec backend alembic upgrade head

# Ver heads de Alembic
docker compose exec backend alembic heads

# Crear una nueva migracion
docker compose exec backend alembic revision --autogenerate -m "descripcion_del_cambio"

# Revertir la ultima migracion
docker compose exec backend alembic downgrade -1

# Cargar datos demo
docker compose exec backend python -m seeds.run

# Cargar subsets de seeds
docker compose exec backend python -m seeds.run --only tenants
docker compose exec backend python -m seeds.run --only users
docker compose exec backend python -m seeds.run --only plans
docker compose exec backend python -m seeds.run --only classes
```

## Backend

```bash
# Ejecutar tests
docker compose run --rm backend pytest -q

# Ejecutar un test puntual
docker compose run --rm backend pytest -q tests/test_fintoc_service.py
docker compose run --rm backend pytest -q tests/test_webpay_service.py

# Compilar un archivo para detectar errores rapidos de sintaxis
docker compose exec backend python -m py_compile app/api/v1/endpoints/public.py

# Abrir shell en backend
docker compose exec backend sh
```

## Frontend

```bash
# Instalar dependencias localmente
cd frontend && npm install

# Desarrollo local
cd frontend && npm run dev

# Lint
cd frontend && npm run lint

# Build
cd frontend && npm run build

# Typecheck usando el build del proyecto
cd frontend && npx tsc --noEmit
```

## Calidad y build en contenedores

```bash
# Build de frontend en contenedor limpio
docker run --rm -v /var/www/nexofitness/frontend:/app -w /app node:20-alpine sh -lc "npm run build"

# Tests backend en contenedor efimero
docker compose run --rm backend pytest -v --tb=short
```

## Pagos

```bash
# Verificar configuracion Fintoc cargada
docker compose exec -T backend python -c "import os; print('FINTOC_SECRET_KEY:', (os.getenv('FINTOC_SECRET_KEY') or '')[:8]); print('FINTOC_WEBHOOK_SECRET:', (os.getenv('FINTOC_WEBHOOK_SECRET') or '')[:11])"

# Verificar configuracion Webpay cargada
docker compose exec -T backend python -c "import os; print('WEBPAY_ENVIRONMENT:', os.getenv('WEBPAY_ENVIRONMENT')); print('WEBPAY_COMMERCE_CODE:', (os.getenv('WEBPAY_COMMERCE_CODE') or '')[:6])"

# Ver el ultimo payload Webpay guardado
docker compose exec -T db psql -U nexo -d nexo_fitness -c "select id, status, provider_response_json from webpay_transactions order by created_at desc limit 1;"
```

## Worker y tareas

```bash
# Revisar logs de celery worker y beat
docker compose logs --tail=100 worker
docker compose logs --tail=100 beat

# Reiniciar procesos async
docker compose restart worker
docker compose restart beat
```

## Tips

- Ejecuta estos comandos desde la raiz del repo.
- Si cambias variables en `backend/.env`, usa `docker compose up -d --force-recreate backend` porque `restart` no relee `env_file`.
- Si el frontend no toma cambios o entra en loop, revisa `docker compose logs frontend`.
- Para errores de pagos, primero mira `backend`, luego la tabla `webpay_transactions` o los webhooks de Fintoc.
