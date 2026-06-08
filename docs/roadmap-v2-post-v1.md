# Roadmap v2 — Post v1.0.0

Fecha de redacción: 2026-05-20
Tag base: `v1.0.0` (snapshot de producción a esa fecha)
Stack: FastAPI + React + Postgres 15 + Celery, deploy en VPS único.

Este documento agrupa las mejoras detectadas tras cerrar v1.0.0, ordenadas por fases. Cada item tiene esfuerzo estimado y valor de negocio. La idea es ejecutar de arriba abajo, marcando "DONE" al cerrar, y revisar el orden cuando aparezcan datos de uso reales.

---

## Convenciones

- **Esfuerzo:** S (≤1 día), M (1-3 días), L (1-2 semanas), XL (1+ mes).
- **Valor:** ⭐ a ⭐⭐⭐⭐⭐ (impacto en retención/ingresos/diferenciación).
- **Prio:** P0 = ahora, P1 = sprint siguiente, P2 = backlog, P3 = idea/backlog largo.
- Cada feature debería ir como branch `feature/<slug>` desde `develop`, PR a `develop`, merge a `main` cuando se libere.

---

## Fase 6 — Quick wins comerciales (P0)

Objetivo: aumentar conversión, retención y diferenciación con cambios chicos que abren TAM o reducen churn. Ninguna requiere reescribir nada.

### 6.1 — WhatsApp transaccional ⭐⭐⭐⭐⭐ · M

**Problema:** Email tiene ~20% open rate. WhatsApp ~95%. Notificaciones críticas (renovación, clase mañana, no-show) no llegan.

**Solución:**
- Integrar Twilio o WhatsApp Cloud API (Meta).
- Plantillas: `renovacion_proxima`, `clase_recordatorio_24h`, `pago_recibido`, `clase_cancelada`.
- Toggle por tenant en settings (`features.whatsapp_enabled`).
- Costo por mensaje: ~CLP 30. Cobrar como add-on (CLP 9.990/mes con 500 msgs incluidos).

**Implementación:**
- `backend/app/integrations/whatsapp/` (nuevo paquete).
- Adapter pattern: misma interfaz que `email_service`.
- Tareas Celery: `send_whatsapp_renewal_reminder`, etc. Reusa beat schedule.
- Frontend: tab "Notificaciones" en Settings con templates configurables.

**Métrica de éxito:** % renovaciones automáticas que se concretan +20pp.

---

### 6.2 — Punch passes + Drop-in ⭐⭐⭐⭐⭐ · M — **DONE v1.1.0 (2026-05-20, SHA 68e88df)**

Modelo `Plan.plan_kind` (SUBSCRIPTION | PUNCH_PASS | DROP_IN) + `Plan.total_uses` + `Membership.uses_remaining`. Check-in decrementa y marca EXPIRED al agotar. UI PlansPage con selector de 3 tipos. 11 tests nuevos.

**Descripción original:**

**Problema:** Solo se venden membresías mensuales. Pierdes mercado de:
- Cliente que quiere probar 1 día.
- Clase abierta / hot yoga / pilates que vende paquetes "10 clases".
- Turista o cliente esporádico.

**Solución:**
- Agregar `Plan.total_uses` (int nullable) y `Plan.plan_kind` enum: `subscription | punch_pass | drop_in`.
- En check-in:
  - `subscription`: chequea `expires_at`.
  - `punch_pass`: decrementa `Membership.uses_remaining`, expira a 0.
  - `drop_in`: crea membership de 24h.
- UI: nuevo tipo de plan en `PlansPage` con campos condicionales.
- Reportes: separar revenue por `plan_kind`.

**Migración:** Agregar columna sin default, los planes existentes quedan `subscription`. Backfill con `UPDATE plans SET plan_kind = 'subscription'`.

**Métrica:** % nuevos clientes que entran por drop-in en mes 1.

---

### 6.3 — Waitlist clases llenas ⭐⭐⭐⭐ · S — **DONE (pre-v1.0.0)**

**Auditoría 2026-05-20:** ya implementado en producción al revisar el código.

Lo que existe:
- `Reservation.status = WAITLISTED` + `waitlist_position` (orden FIFO).
- `GymClass.waitlist_enabled` (toggle por clase, default true).
- POST /reservations: cuando clase llena Y waitlist_enabled → crea waitlisted con posición incremental.
- Cancel reservation: promociona primer waitlist a CONFIRMED + manda push "¡Tienes lugar!" via `create_and_dispatch_notification`.
- Bulk-cancel: notifica a CONFIRMED + WAITLISTED si `notify_members=true`.
- UI staff (ClassesPage): toggle `waitlist_enabled` al crear/editar + counter en stats.
- UI miembro (AgendaTab): botón "Unirse a lista de espera" cuando llena + toast "En lista de espera (posición N)".

**Mejoras posibles (opcionales, P3):**
- Endpoint `GET /classes/{id}/my-waitlist-position` para ver posición actualizada (hoy solo en respuesta inicial de reserva).
- Auto-expire waitlist 30min antes de la clase si no se promovió (evita falsa expectativa).
- Mostrar count de waitlisted en card pública ("3 en lista de espera").

---

### 6.4 — Member referral codes ⭐⭐⭐⭐ · S — **DONE v1.2.0 (2026-05-20, SHA 23299a9)**

`users.referral_code` (NOMBRE-XXXXX, generado al primer pago COMPLETED) + `users.referrer_user_id` (FK self). `GET /api/v1/mobile/refer` retorna code/share_url/referred_count. Storefront captura `?ref=CODE` y lo envía al checkout. ProfileTab MemberApp tiene card "Invita y gana" con copy + share API. **Pendiente Fase 6.4b**: aplicación automática de crédito al referrer (hoy es manual).

**Descripción original:**

**Problema:** Hoy no hay incentivo para que clientes traigan amigos. CAC es 100% pagado.

**Solución:**
- Cada cliente recibe `User.referral_code` único al activarse membresía.
- Página `/invita`: muestra link público `nexofitness.cl/r/{code}`.
- Visitante usa link → al inscribirse, `PromoCode` se aplica automático (10% off primer mes).
- Cuando referido completa primer pago, referrer recibe crédito (1 mes gratis o CLP 5000 en wallet).
- Tabla `Referral` con `referrer_user_id`, `referred_user_id`, `status`, `reward_applied_at`.

**Métrica:** % nuevos clientes con `referrer_id != null`.

---

### 6.5 — NPS post-clase ⭐⭐⭐⭐ · S

**Problema:** No hay loop de feedback. Cliente insatisfecho se va sin avisar.

**Solución:**
- 24h después de check-in, push: "¿Cómo estuvo la clase con [instructor]? 0-10".
- Si ≤6 → drawer con "¿Qué te molestó?" → guarda en `FeedbackSubmission` + notifica owner.
- Si ≥9 → "¡Genial! ¿Conoces a alguien que quiera probar?" → manda a `/invita`.
- Detractores y promotores se ven en `/reports/nps` (nuevo).

**Implementación:** Reusa `FeedbackSubmission`. Tarea Celery beat horaria.

**Métrica:** NPS rolling 30 días. Detección de instructores problema.

---

### 6.6 — Gift cards ⭐⭐⭐ · M

**Problema:** Día de la madre / cumpleaños = cero opciones para regalar membresía.

**Solución:**
- Endpoint `POST /api/v1/gift-cards` con monto + email destinatario.
- Genera código + email con instrucciones de redención.
- Destinatario usa código al inscribirse → crédito aplicado.
- Modelo `GiftCard` con `code`, `amount`, `redeemed_by`, `redeemed_at`.

**Pricing:** CLP 10k, 25k, 50k, 100k.

**Métrica:** Revenue de gift cards en diciembre.

---

### 6.7 — Booking widget embebible ⭐⭐⭐⭐ · M

**Problema:** Gym tiene su propio sitio web y querría mostrar el calendario de clases ahí, sin que cliente salga a nuestra app.

**Solución:**
- `GET /embed/{tenant_slug}/classes` retorna HTML standalone con catálogo de clases + botón "Reservar" (abre nueva pestaña a app).
- Iframe-friendly headers (`X-Frame-Options: ALLOW-FROM`).
- Snippet copy-paste: `<iframe src="..." />`.

**Métrica:** Conversión de visitantes web del gym a reservas.

---

## Fase 7 — Plataforma + B2B (P1)

Objetivo: agregar features que abren mercados nuevos (corporativo, familias) y mejoran ergonomía para gyms grandes.

### 7.1 — Webhooks Stripe/WebPay reales ⭐⭐⭐⭐ · M

**Problema:** Hoy hay polling de estado de transacciones. Latencia + costo DB.

**Solución:**
- Endpoint `POST /api/v1/webhooks/stripe` con verificación de firma `Stripe-Signature`.
- Endpoint `POST /api/v1/webhooks/webpay` con verificación HMAC.
- Eventos: `payment_intent.succeeded`, `customer.subscription.deleted`, etc.
- Idempotency via `webhook_events` table (event_id único).

**Implementación:** Reemplaza tareas Celery de polling.

---

### 7.2 — Free trial conversion funnel ⭐⭐⭐⭐ · L

**Problema:** No sabes en qué paso del onboarding pierdes gyms del free trial.

**Solución:**
- Eventos PostHog ya hay (Fase 4 owner panel). Agregar:
  - `trial_started` (signup)
  - `first_branch_created`
  - `first_plan_created`
  - `first_client_created`
  - `first_sale_completed`
  - `first_class_held`
  - `trial_converted_paid`
- Dashboard `/superadmin/funnel` con conversion rate por paso.
- Identificar fricción → ajustar UX.

**Stretch:** Email/WhatsApp automático cuando un tenant lleva 3 días sin completar paso N.

---

### 7.3 — Digital waiver / consentimiento ⭐⭐⭐⭐ · L

**Problema:** Gym debe tener consentimiento legal firmado de cada cliente (responsabilidad civil, manejo de datos). Hoy se hace en papel o se ignora.

**Solución:**
- Template configurable por tenant (markdown → render PDF).
- Cliente firma con dedo/mouse en canvas, se exporta a PNG.
- PDF final: template + firma + timestamp + IP + hash sha256.
- Storage en R2 (bucket privado).
- Bloquear primer check-in hasta firma.

**Compliance:** Útil para Ley 19.628 (datos personales CL) y RGPD.

---

### 7.4 — API pública v1 ⭐⭐⭐ · L

**Problema:** Integraciones de terceros (Zapier, Make, custom integrations) imposibles.

**Solución:**
- `TenantApiKey` model: key (hash sha256), `tenant_id`, `scopes`, `last_used_at`, `revoked_at`.
- Header `X-API-Key: nf_live_...`.
- Endpoints read-only inicialmente: `GET /api/v1/public/clients`, `/classes`, `/payments`.
- Rate limit estricto: 60 req/min.
- Documentación OpenAPI auto.

**Stretch:** Webhooks salientes (cliente nuevo → POST a URL del gym).

---

### 7.5 — Family / corporate accounts ⭐⭐⭐⭐ · L

**Problema:** Empresa quiere comprar 50 cupos. Familia quiere 1 membresía para 4 personas.

**Solución:**
- Modelo `MembershipGroup`: `name`, `tenant_id`, `seats_total`, `seats_used`, `owner_user_id`, `plan_id`.
- Cada User puede tener `membership_group_id` opcional.
- `MembershipGroup` paga; miembros individuales son hijos.
- UI: `/groups` page para owner del gym. Empresa entra a portal limitado para invitar empleados.

**Pricing:** Descuento por volumen configurable.

---

### 7.6 — Audit log UI ⭐⭐⭐ · S

**Problema:** `audit_service` ya registra acciones críticas. No hay forma de verlas.

**Solución:**
- `/audit` page con tabla filtrable por: actor, action, entity_type, date range.
- Útil para investigar "quién canceló esta membresía".
- Read-only, solo `owner` role.

---

### 7.7 — Cache Redis para reports ⭐⭐⭐ · S

**Problema:** `/reports/overview` ejecuta 7+ queries pesadas (~800ms en tenants con data).

**Solución:**
- Cache con key `reports:overview:{tenant_id}:{range_key}`, TTL 5min.
- Invalidar en: nueva venta, nuevo check-in, nuevo gasto.
- Decorator `@cached_for(ttl=300, invalidate_on=["payment.created"])`.

**Métrica:** p95 latencia `/reports/overview` 800ms → 50ms.

---

### 7.8 — Equipment booking ⭐⭐⭐ · M

**Problema:** Gym CrossFit / boutique tiene squat racks limitados. Cliente quiere reservar el rack 18:00-19:00, no la clase.

**Solución:**
- Modelo `Equipment`: `tenant_id`, `name`, `branch_id`, `available_from`, `available_to`.
- `Reservation.equipment_id` opcional (mutex con `gym_class_id`).
- UI: tab `/equipment` con calendario semanal por equipo.

---

### 7.9 — Trainer availability + sesiones 1:1 ⭐⭐⭐⭐ · L

**Problema:** Personal training hoy no se vende dentro del sistema. Trainer maneja por WhatsApp.

**Solución:**
- `TrainerAvailability` model: `user_id`, `weekday`, `start_time`, `end_time`.
- Cliente entra a `/trainers/{id}` → ve slots libres → reserva.
- Se crea `GymClass` con `max_capacity=1`, `instructor_id`, `class_type=personal`.
- Plan tipo `personal_training` con N sesiones.

**Métrica:** % gyms con al menos 1 sesión PT creada.

---

## Fase 8 — Diferenciación AI + integraciones (P2)

Objetivo: features que mueven NexoFitness de "otro software de gym" a "el más moderno".

### 8.1 — AI: generador de plan de entrenamiento ⭐⭐⭐⭐⭐ · XL

**Problema:** Trainer pasa 2-4h/semana armando rutinas manualmente. Pain real, validado en encuestas de mercado.

**Solución:**
- Form: objetivo (hipertrofia/fuerza/pérdida grasa/movilidad), nivel, días/semana, equipo disponible, restricciones físicas.
- LLM (Anthropic Claude o GPT) recibe prompt + `ExerciseLibrary` del tenant.
- Output: plan estructurado JSON → render como `TrainingProgram` con `schedule`.
- Cliente puede editar manualmente.
- Caching de planes similares para reducir costo.

**Pricing:** Premium add-on CLP 14.990/mes. Trainerize cobra USD 20/mes.

**Riesgo:** Costo API si se usa mucho. Limit 50 generaciones/mes por gym base.

---

### 8.2 — AI: churn prediction ML ⭐⭐⭐⭐ · XL

**Problema:** Hoy churn detection es heurística (`_compute_risk`). Funciona pero impreciso.

**Solución:**
- Pipeline mensual entrenamiento modelo (XGBoost o LightGBM).
- Features: check-ins últimas 4/8/12 semanas, days_since_last_checkin, payments_late, antigüedad, plan_type, frecuencia vs su promedio histórico, mes del año (estacionalidad).
- Target: `churned` (no renovó dentro de 30 días tras expirar).
- Output: probability score por cliente actual. Reemplaza heurística.
- Self-hosted (no API externa): scikit-learn corre en Celery.

**Requiere:** Mínimo 6 meses de data histórica por tenant. Mientras tanto, dejar heurística.

---

### 8.3 — Wearables OAuth (Strava / Garmin / Whoop) ⭐⭐⭐⭐ · L

**Problema:** Cliente entrena fuera del gym, registro queda incompleto. Trainer no ve esfuerzo total.

**Solución:**
- OAuth flow por cliente: `/integrations/strava/connect`.
- Webhook Strava → guarda activities como `Workout` model nuevo.
- UI cliente: timeline de todos sus entrenamientos (en gym + fuera).
- UI trainer: ve compliance del plan.

**Empezar por Strava** (API gratis, OAuth simple). Garmin requiere partnership.

---

### 8.4 — Native mobile app ⭐⭐⭐⭐ · XL

**Problema:** PWA funciona pero clientes piden ícono nativo en home screen y notificaciones nativas confiables.

**Solución:**
- Capacitor wrap del PWA existente.
- App Store + Play Store con bundle de Nexo (no por gym; cada gym apunta a su slug).
- Push nativo via FCM (Android) + APNs (iOS).
- Login deep links.

**Riesgo:** App store rejection (especialmente Apple). Maintenance burden.

**Alternativa low-cost:** Mejor PWA + Add to Home Screen prompt + bundle Bubblewrap (TWA Android, gratis).

---

### 8.5 — Marketplace gimnasios ⭐⭐⭐⭐⭐ · XL

**Problema/oportunidad:** Cliente final no sabe qué gym elegir. Modelo ClassPass: 1 suscripción → acceso a varios gyms.

**Solución:**
- Tier comercial: gyms aceptan ser parte del marketplace, ofrecen X clases/mes.
- Cliente paga a Nexo, Nexo distribuye a gyms.
- Cambia modelo de negocio: B2B2C → B2C también.

**Risk:** Aleja del foco core. Reflejar mucho antes de empezar.

---

## Fase 9 — Deuda técnica (transversal, ongoing)

### 9.6 — Backups automáticos Postgres — **DONE v1.0.0 (2026-05-20)**

`scripts/backup-db.sh` corre diario 03:00 via cron. Doble destino: local `/var/www/nexofitness/backups/` (retención 7d) + Cloudflare R2 `nexofitness-backups/postgres/` (retención 30d). Rclone remote `r2-backups` configurado con token bucket-scoped (`no_check_bucket=true`). `scripts/restore-db.sh` con confirmación. Docs en `docs/backups.md`.

**Descripción original:**

Estas no son features pero son críticas para sostener el ritmo a 1 año.

### 9.1 — Tests para mobile.py ⭐⭐⭐ · M

**Problema:** [mobile.py](backend/app/api/v1/endpoints/operations/mobile.py) tiene 1045 L, 0 tests directos. Riesgo alto en cada cambio.

**Solución:**
- Baseline: ~15 tests cubriendo endpoints clave (wallet, reservas, check-in QR, push subscriptions, progress photos).
- Fixtures FakeAsyncSession ya existen en `test_feedback_api.py`.
- Target coverage: 60% del archivo.

---

### 9.2 — Pre-commit hooks ⭐⭐⭐ · S

**Problema:** PRs con errores tontos (lint, typecheck) llegan a CI cuando deberían bloquearse local.

**Solución:**
- `.pre-commit-config.yaml`: ruff check + format + tsc --noEmit (frontend).
- Install: `pre-commit install` (developer onboarding).
- Documentar en CLAUDE.md.

---

### 9.3 — E2E Playwright (golden paths) ⭐⭐⭐⭐ · M

**Problema:** Cero tests E2E. Bugs de integración (auth → reserva → check-in) solo se atrapan con QA manual.

**Solución:**
- 5 tests críticos:
  1. Owner signup → first branch → first plan → first client.
  2. Cliente: login → reserva clase → recibe push.
  3. Recepción: check-in QR → fraud detection.
  4. POS: agregar producto → vender → ver en reportes.
  5. Billing: SaaS trial expirado → reactivar pago.
- Playwright + GitHub Actions.

---

### 9.4 — DB indexes audit ⭐⭐⭐ · S

**Problema:** Tablas `Reservation`, `CheckIn`, `Payment` crecen. Queries pueden volverse lentas sin warning.

**Solución:**
- Para cada endpoint con `>p95 200ms`, correr `EXPLAIN ANALYZE`.
- Agregar índices compuestos típicos: `(tenant_id, created_at)`, `(tenant_id, user_id, status)`.
- Migración Alembic con todos los nuevos índices.

---

### 9.5 — N+1 queries en reports ⭐⭐⭐ · M

**Problema:** `reports.py overview` ejecuta queries separadas para payments, memberships, plans, classes, etc.

**Solución:**
- `selectinload` para relaciones FK.
- Combinar queries cuando filtros sean iguales.
- Benchmark antes/después con tenant grande.

---

### 9.6 — Backups automáticos Postgres ⭐⭐⭐⭐⭐ · S

**Crítico:** Pregunta abierta. Si hoy no hay backup automatizado, **urgente**.

**Solución:**
- Cron en VPS: `pg_dump` diario → upload a R2 con retención 30 días.
- Script `backup.sh` + entry en crontab.
- Test de restore mensual en local.

---

### 9.7 — Sentry frontend wiring ⭐⭐ · S

**Problema:** `VITE_SENTRY_DSN` en env, posiblemente no wired.

**Solución:**
- Verificar `frontend/src/main.tsx` inicializa Sentry con DSN.
- Captura errores no atrapados + breadcrumbs PostHog.

---

### 9.8 — Performance budget Lighthouse ⭐⭐ · M

**Problema:** Bundle frontend crece sin watchdog. Cliente con 4G rural se queda con loading 8s.

**Solución:**
- Lighthouse CI corre en cada PR contra `frontend/dist`.
- Budget: LCP <2.5s, FID <100ms, bundle main <300KB gzip.
- Falla CI si excede.

---

## Resumen ejecutivo

| Fase | Items | Esfuerzo total | Cuándo |
|------|-------|----------------|--------|
| 6 — Quick wins comerciales | 7 (6 done, solo WhatsApp pend.) | DONE 2026-06-08 | ✅ |
| 7 — Plataforma + B2B | 9 | ~2 meses | Q3 2026 |
| 8 — AI + integraciones | 5 | ~3-4 meses | Q4 2026 / Q1 2027 |
| 9 — Deuda técnica | 8 (1 done) | ongoing | Intercalado con cada fase |

## Estado Fase 6 — COMPLETA salvo WhatsApp (2026-06-08)

- 6.1 WhatsApp — **pendiente** (bloqueado por setup Twilio/Meta, 24-48h aprobación plantillas).
- **6.2 Punch passes + Drop-in — DONE v1.1.0**.
- **6.3 Waitlist — DONE (pre-v1.0.0)**.
- **6.4 Member referral codes — DONE v1.2.0**.
- **6.4b crédito auto al referrer — DONE v1.4.0** (opt-in por gym, días gratis).
- **6.5 NPS post-clase — DONE v1.3.0**.
- **6.6 Gift cards — DONE v1.6.0** (+ checkout online WebPay/TUU post-v1.6.0).
- **6.7 Booking widget — DONE v1.5.0** (`/embed/:slug`).

## Próximos candidatos (Fase 7 — Plataforma + B2B)

1. **7.1 Webhooks Stripe/WebPay reales** (M, ⭐⭐⭐⭐) — reemplaza polling; complementa el checkout de gift cards recién agregado.
2. **7.6 Audit log UI** (S, ⭐⭐⭐) — `audit_logs` ya existe, falta el visor.
3. **7.7 Cache Redis para reports** (S, ⭐⭐⭐).
4. **6.1 WhatsApp transaccional** (bloqueado por Twilio/Meta).

## Cómo usar este doc

- Antes de cada sprint, mover items a "En curso" en GitHub Projects.
- Cuando se cierre uno, marcar **DONE** acá con SHA del merge a main.
- Si aparecen nuevas ideas, agregar como sub-item en la fase apropiada con `[NEW yyyy-mm-dd]`.
- Revisar prioridades cada 2 meses con datos de uso reales (PostHog) en mano.

---

**Referencias internas:**
- [CLAUDE.md](../CLAUDE.md) — arquitectura general.
- [docs/plan-sistema-completo.md](plan-sistema-completo.md) — visión original v1.
- [docs/MEJORAS.md](MEJORAS.md) — sugerencias anteriores (pre-v1).
- Tag `v1.0.0` — snapshot de prod a 2026-05-20.
