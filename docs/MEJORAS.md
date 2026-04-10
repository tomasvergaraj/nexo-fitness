# Roadmap de Mejoras — NexoFitness

> Generado: 2026-04-09 | Actualizado: 2026-04-10 | Estado: Sprint 6 completado (parcial)

---

## Estado actual del sistema

### Owner (gimnasio)
Dashboard · Clases con recurrencia y listas de espera · Clientes (búsqueda, tags, CSV) · Planes con descuentos · Pagos manuales · Check-in QR · Reservas · Reportes de ingresos · Campañas de marketing · Multi-sucursal · Soporte al cliente · Branding / personalización

### Cliente (PWA mobile-first)
Pase digital con QR · Agenda de clases y reservas · Historial de pagos · Planes y compra online (Stripe) · Bandeja de notificaciones · Soporte básico · Perfil y ajustes · Modo offline

---

## Sprints

### ✅ Sprint 0 — Base (completado)
- Sistema multi-tenant SaaS completo
- Autenticación, roles y permisos
- Módulo de campañas de marketing mejorado
- Descuento `discount_pct` en planes (owner y super admin)
- PWA con navegación tipo Facebook (drawer izquierdo + bottom nav)
- Alerta de trial por vencer (Celery task)

---

### ✅ Sprint 1 — Retención e impacto inmediato (completado)

| # | Feature | Tipo | Estado |
|---|---------|------|--------|
| S1-1 | Push al ascender de lista de espera | Backend | ✅ deployed |
| S1-2 | Recordatorio automático 2h antes de clase | Backend (Celery) | ✅ deployed |
| S1-3 | Alerta automática membresía próxima a vencer (7d) | Backend (Celery) | ✅ deployed |
| S1-4 | Badge "Expira pronto" en lista de clientes | Full-stack | ✅ deployed |
| S1-5 | Contador de reservas restantes en PWA | Full-stack | ✅ deployed |

#### S1-1: Push al ascender de lista de espera
**Archivos**: `backend/app/api/v1/endpoints/classes.py`
Cuando se cancela una reserva confirmada, se promueve al primer cliente en waitlist. Ahora se envía un push inmediato al cliente promovido informando que tiene su lugar confirmado.

#### S1-2: Recordatorio 2h antes de clase
**Archivos**: `backend/app/tasks/class_reminders.py`
Tarea Celery que corre cada 15 minutos. Detecta reservas confirmadas cuya clase empieza en 90–120 minutos y envía un push: "Tu clase empieza en 2 horas". Evita reenvíos con campo `reminder_sent_at` en `Reservation`.

#### S1-3: Alerta membresía por vencer
**Archivos**: `backend/app/tasks/membership_alerts.py`
Tarea Celery diaria (9am UTC). Detecta membresías activas que vencen en exactamente 7 días (ventana de 12h). Envía push al miembro y notificación en la app con link directo a planes.

#### S1-4: Badge "Expira pronto" en lista de clientes
**Archivos**: `backend/app/api/v1/endpoints/clients.py`, `backend/app/schemas/auth.py`, `frontend/src/pages/clients/ClientsPage.tsx`
El endpoint `/clients` ahora incluye `membership_status` y `membership_expires_at` de la membresía activa más reciente. El frontend muestra un badge naranja en clientes con vencimiento ≤7 días.

#### S1-5: Contador de reservas restantes
**Archivos**: `backend/app/api/v1/endpoints/operations.py`, `backend/app/schemas/platform.py`, `frontend/src/pages/member/MemberAppPage.tsx`
El wallet endpoint ahora incluye `weekly_reservations_used`, `monthly_reservations_used`, `max_reservations_per_week`, `max_reservations_per_month`. La pestaña Agenda de la PWA muestra una barra de progreso con reservas usadas vs. límite del plan.

---

### ✅ Sprint 2 — Operación diaria (completado)

| # | Feature | Tipo | Estado |
|---|---------|------|--------|
| S2-1 | Membresía freeze/pausa | Full-stack | ✅ deployed |
| S2-2 | Estadísticas de asistencia por cliente | Full-stack | ✅ deployed |
| S2-3 | Notas internas en membresías | Full-stack + DB | ✅ deployed |
| S2-4 | Reporte de asistencia por clase/instructor | Full-stack | ✅ deployed |
| S2-5 | Cancelación con motivo | Full-stack + DB | ✅ deployed |

#### S2-1: Membresía freeze/pausa
**Archivos**: `backend/app/schemas/auth.py`, `backend/app/api/v1/endpoints/clients.py`, `frontend/src/pages/clients/ClientsPage.tsx`
Agregado `membership_id` en `UserClientResponse`. El owner puede pausar membresías (con fecha opcional) o reactivarlas directamente desde la lista de clientes. Badge "Pausada" con ícono Snowflake en la columna de estado.

#### S2-2: Estadísticas de asistencia por cliente
**Archivos**: `backend/app/api/v1/endpoints/clients.py`, `frontend/src/pages/clients/ClientsPage.tsx`
Nuevo endpoint `GET /clients/{id}/stats`: reservas confirmadas, check-ins, tasa de asistencia, cancelaciones, última visita. Modal accesible desde BarChart2 icon en cada fila del cliente.

#### S2-3: Notas internas en membresías
**Archivos**: `backend/app/models/business.py`, `backend/app/schemas/platform.py`, `backend/migrations/versions/20260409_1000_add_notes_to_memberships.py`, `frontend/src/pages/clients/ClientsPage.tsx`
Columna `notes TEXT` en `memberships`. Botón FileText (ámbar si hay nota) abre modal con textarea. Las notas no son visibles para el cliente.

#### S2-4: Reporte de asistencia por clase/instructor
**Archivos**: `backend/app/api/v1/endpoints/operations.py`, `frontend/src/pages/reports/ReportsPage.tsx`
Nuevo endpoint `GET /reports/attendance`. ReportsPage tiene nueva sección con ranking de clases por ocupación (barra de progreso coloreada) y ranking de instructores por check-ins.

#### S2-5: Cancelación con motivo
**Archivos**: `backend/app/models/business.py`, `backend/app/schemas/business.py`, `backend/app/api/v1/endpoints/classes.py`, `backend/migrations/versions/20260409_1100_add_cancel_reason_to_reservations.py`, `frontend/src/services/api.ts`, `frontend/src/pages/member/MemberAppPage.tsx`
Columna `cancel_reason VARCHAR(500)` en `reservations`. Endpoint `DELETE /reservations/{id}?cancel_reason=...`. PWA muestra modal de confirmación con campo opcional de motivo antes de cancelar.

---

### ✅ Sprint 3 — Fidelización (completado)

| # | Feature | Tipo | Estado |
|---|---------|------|--------|
| S3-1 | Feed iCal / Google Calendar | Full-stack | ✅ deployed |
| S3-2 | Historial de planes del cliente | Full-stack | ✅ deployed |
| S3-3 | Cumpleaños en campañas | Full-stack | ✅ deployed |
| S3-4 | Instructor en tarjeta de clase (PWA) | Full-stack | ✅ deployed |
| S3-5 | Dark mode por defecto | Frontend | ✅ deployed |

#### S3-1: Feed iCal
**Archivos**: `backend/app/api/v1/endpoints/operations.py`, `frontend/src/services/api.ts`, `frontend/src/pages/member/MemberAppPage.tsx`
Endpoint `GET /mobile/calendar.ics` genera un archivo `.ics` con reservas confirmadas/waitlisted futuras del miembro (próximos 60 días) e incluye una alerta 1 hora antes de cada clase. Botón "Guardar en calendario" en la pestaña Agenda de la PWA.

#### S3-2: Historial de planes del cliente
**Archivos**: `backend/app/api/v1/endpoints/clients.py`, `frontend/src/services/api.ts`, `frontend/src/pages/clients/ClientsPage.tsx`
Endpoint `GET /clients/{id}/membership-history` devuelve todas las membresías pasadas. Modal accesible desde ícono History en cada fila de cliente.

#### S3-3: Cumpleaños en campañas
**Archivos**: `backend/app/api/v1/endpoints/clients.py`, `backend/app/schemas/auth.py`, `frontend/src/pages/clients/ClientsPage.tsx`
Filtro `birthday_month=true` en `/clients`. `UserClientResponse` incluye `date_of_birth`. Filtro "🎂 Cumpleaños" en ClientsPage muestra clientes con cumpleaños este mes con badge (especial si es hoy).

#### S3-4: Instructor en tarjeta de clase (PWA)
**Archivos**: `backend/app/schemas/business.py`, `backend/app/api/v1/endpoints/classes.py`, `backend/app/api/v1/endpoints/public.py`, `frontend/src/types/index.ts`, `frontend/src/pages/member/MemberAppPage.tsx`
`GymClassResponse` incluye `instructor_name`. Los endpoints `/classes` y público enriquecen con nombre del instructor. La tarjeta de clase en la PWA muestra nombre del instructor en el subtítulo y en el grid de detalles.

#### S3-5: Dark mode por defecto
**Archivos**: `frontend/src/stores/themeStore.ts`
`getStoredDarkPreference()` ahora hace fallback a `window.matchMedia('(prefers-color-scheme: dark)').matches` cuando no hay preferencia guardada.

---

### ✅ Sprint 4 — Diferenciación (completado — 2026-04-10)

| # | Feature | Tipo | Estado |
|---|---------|------|--------|
| S4-1 | Códigos promocionales | Full-stack + DB | ✅ deployed |
| S4-2 | Multi-sucursal en check-in | Frontend | ✅ deployed |
| S4-3 | Sesiones entrenamiento personal (1:1) | Frontend | ✅ deployed |
| S4-4 | Panel del día para owner | Full-stack | ✅ deployed |

#### S4-1: Códigos Promocionales
**Archivos**: `backend/migrations/versions/20260410_1000_add_promo_codes_table.py`, `backend/app/models/business.py`, `backend/app/schemas/platform.py`, `backend/app/api/v1/endpoints/operations.py`, `frontend/src/pages/promo/PromoCodesPage.tsx`, `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/pages/member/MemberAppPage.tsx`
Tabla `promo_codes` con unicidad `(tenant_id, code)`. Modelo `PromoCode` con `discount_type` (percent|fixed), `discount_value`, `max_uses`, `uses_count`, `expires_at`, `plan_ids` (JSON, NULL = todos los planes). 5 endpoints: `GET/POST /promo-codes`, `PATCH/DELETE /promo-codes/{id}`, `POST /promo-codes/validate`. Admin: CRUD completo con toggle activo/inactivo y enlace en Sidebar (ícono `Tag`). PWA: campo de código promo por plan en la pantalla de compra, muestra descuento calculado y precio final, pasa `promo_code_id` al crear sesión Stripe.

#### S4-2: Multi-sucursal en check-in
**Archivos**: `frontend/src/pages/checkin/CheckInPage.tsx`
Selector dropdown de sucursal en la cabecera del módulo de Check-in. Sólo se muestra si el tenant tiene >1 sucursal activa. Pasa `branch_id` tanto en check-in manual como en scan QR. El backend ya aceptaba `branch_id` en ambos endpoints (`/checkins` y `/checkins/scan`).

#### S4-3: Sesiones entrenamiento personal (1:1)
**Archivos**: `frontend/src/pages/classes/ClassesPage.tsx`
Nuevo preset "Sesión Personal (1:1)" con `class_type='personal_training'`, `max_capacity=1`, duración 60 min y color violeta. Al seleccionarlo la capacidad se fija en 1 automáticamente. Las vistas de tarjeta, lista y agenda muestran "⚡ Sesión 1:1". Sin migration — `class_type` ya existía como columna libre.

#### S4-4: Panel del día para owner
**Archivos**: `backend/app/api/v1/endpoints/dashboard.py`, `frontend/src/pages/dashboard/DashboardPage.tsx`, `frontend/src/services/api.ts`, `frontend/src/types/index.ts`
Nuevo endpoint `GET /dashboard/today` → clases de hoy (con instructor, ocupación, estado), pagos completados hoy (con nombre del pagador y monto), cumpleaños del día, conteo de check-ins, revenue hoy. Sección "Panel del Día" en Dashboard con 3 columnas: clases con barra de ocupación coloreada rojo/verde, pagos con total recaudado, cumpleaños + check-ins. Auto-refresh cada 60s.

---

### ✅ Sprint 5 — Premium (completado — 2026-04-10)

| # | Feature | Tipo | Estado |
|---|---------|------|--------|
| S5-1 | Módulo de progreso personal | Full-stack + DB | ✅ deployed |
| S5-2 | Segmentación inteligente / churn | Full-stack | ✅ deployed |
| S5-3 | Cobro recurrente automático | Backend (Celery) | ✅ deployed |

#### S5-1: Módulo de progreso personal
**Archivos**: `backend/migrations/versions/20260410_1100_add_body_measurements_table.py`, `backend/app/models/business.py` (`BodyMeasurement`), `backend/app/schemas/platform.py` (`BodyMeasurementCreate/Response`), `backend/app/api/v1/endpoints/operations.py` (mobile + progress routes), `frontend/src/pages/member/MemberAppPage.tsx`, `frontend/src/types/index.ts`, `frontend/src/services/api.ts`
Tabla `body_measurements` con peso, % grasa, masa muscular y circunferencias (pecho, cintura, cadera, brazo, muslo). Endpoints de self-service en `/mobile/progress` (GET, POST, DELETE) y vista de owner en `/progress/{user_id}`. Nueva pestaña "Progreso" en la bottom nav y en el drawer de la PWA. Muestra historial de mediciones por fecha, resumen de evolución de peso (inicial/actual/cambio), y modal para registrar nuevas mediciones con todos los campos opcionales excepto la fecha.

#### S5-2: Segmentación inteligente / churn
**Archivos**: `backend/app/api/v1/endpoints/clients.py`, `backend/app/schemas/auth.py`, `frontend/src/types/index.ts`, `frontend/src/pages/clients/ClientsPage.tsx`
Cálculo de churn risk por cliente basado en: días desde último check-in y estado de membresía. Scores: `high` (membresía vencida/cancelada, o sin actividad ≥30d), `medium` (sin actividad 14–29d), `low` (activo en últimos 14d). Campo `churn_risk` en `UserClientResponse`. Filtros "En riesgo" y "Riesgo medio" en ClientsPage. Badges visuales en rojo/ámbar en la lista. Backend hace batch-fetch del último check-in por cliente en la misma query de `list_clients`.

#### S5-3: Cobro recurrente automático
**Archivos**: `backend/app/tasks/auto_renewal.py`, `backend/app/tasks/__init__.py`, `backend/app/schemas/platform.py`, `backend/app/api/v1/endpoints/public.py`
Tarea Celery `process_auto_renewals` que corre diariamente a las 8am UTC. Detecta membresías con `auto_renew=True` que vencen ese día, extiende la membresía al siguiente período según `duration_type` del plan (días, mensual, anual), crea un pago `PENDING` para trazabilidad, y notifica al miembro por push. El cobro efectivo sigue siendo via Fintoc/Stripe (no se carga automáticamente sin gateway configurado). Además, `promo_code_id` se pasa a través de los metadatos de Fintoc y se incrementa `uses_count` en el webhook de confirmación de pago.

---

### ✅ Sprint 6 — Módulo de progreso avanzado (completado — 2026-04-10)

| # | Feature | Tipo | Estado |
|---|---------|------|--------|
| S6-2 | Fotos de progreso | Full-stack + DB | ✅ deployed |
| S6-3 | Marcas personales (PRs) | Full-stack + DB | ✅ deployed |

#### S6-2: Fotos de progreso
**Archivos**: `backend/migrations/versions/20260410_1200_add_personal_records_and_progress_photos.py`, `backend/app/models/business.py` (`ProgressPhoto`), `backend/app/schemas/platform.py` (`ProgressPhotoResponse`), `backend/app/api/v1/endpoints/operations.py` (mobile endpoints), `frontend/src/types/index.ts`, `frontend/src/services/api.ts`, `frontend/src/pages/member/MemberAppPage.tsx`
Tabla `progress_photos` con `file_path`, `recorded_at` y `notes`. Subida via `POST /mobile/progress/photos` (multipart, hasta 10 MB, JPEG/PNG/WebP). Las fotos se almacenan en `uploads/progress_photos/{tenant_id}/{user_id}/`. Nuevo sub-tab "Fotos" en la sección Progreso de la PWA: galería 2 columnas con overlay hover (fecha, nota, botón eliminar). Modal de subida con selector de archivo, fecha y notas.

#### S6-3: Marcas personales (PRs)
**Archivos**: `backend/migrations/versions/20260410_1200_add_personal_records_and_progress_photos.py`, `backend/app/models/business.py` (`PersonalRecord`), `backend/app/schemas/platform.py` (`PersonalRecordCreate/Response`), `backend/app/api/v1/endpoints/operations.py` (mobile + `personal_records_router`), `backend/app/main.py`, `frontend/src/types/index.ts`, `frontend/src/services/api.ts`, `frontend/src/pages/member/MemberAppPage.tsx`
Tabla `personal_records` con `exercise_name`, `record_value`, `unit` (kg/reps/seg/min/metros/km), `recorded_at` y `notes`. CRUD vía `/mobile/personal-records` (GET con filtro por ejercicio, POST, DELETE). Vista owner en `GET /personal-records/{user_id}`. Sub-tab "Récords" en la sección Progreso de la PWA: búsqueda por ejercicio, tarjetas con valor + unidad + trofeo dorado, modal para crear. El tab Progreso ahora tiene 3 sub-tabs: Medidas · Fotos · Récords.

### 📋 Sprint 7+ (pendiente)

| # | Feature | Descripción |
|---|---------|-------------|
| S7-1 | API pública para integraciones | OAuth + rate limiting para wearables / apps externas |

---

## Decisiones técnicas

- **Notifications**: Se usa `create_and_dispatch_notification()` de `push_notification_service.py` para todas las notificaciones push + in-app
- **Celery tasks**: Todas las tareas periódicas van en `backend/app/tasks/`. Registrar en `__init__.py` tanto en `include` como en `beat_schedule`
- **Esquema de clientes**: La lista de clientes incluye la membresía más reciente via LEFT JOIN para no romper compatibilidad
- **No se rompe retrocompatibilidad**: Todos los campos nuevos son `Optional` con `None` por defecto
