# Plan: Programas con Clases Completas y Reservas de Programa

**Fecha:** 2026-04-17  
**Última actualización:** 2026-04-20  
**Contexto:** Actualmente los programas son solo plantillas de horario. Las clases generadas pierden configuración per-día (modalidad, sucursal, instructor), y no existe reserva a nivel de programa — el cliente debe reservar cada clase individualmente.

**Objetivo:** (1) Enriquecer el schedule del programa para que cada día tenga todos los datos necesarios al generar clases completas. (2) Permitir al cliente reservar un programa completo (todas sus clases a la vez) con cancelación en cascada.

---

## Estado de Implementación

| Sprint | Descripción | Estado |
|--------|-------------|--------|
| Sprint 1 — Fase 1 Backend | `GenerateClassesRequest` + lógica merge per-día en `operations.py` | ✅ Completo |
| Sprint 1 — Fase 1 Frontend types | `ProgramScheduleDayConfig`, `ProgramScheduleDay` en `types/index.ts` | ✅ Completo |
| Sprint 1 — Fase 1 Frontend UI | Expander de config por día en `ProgramsPage.tsx` | ✅ Completo |
| Sprint 2 — Fase 2 Backend modelo | `ProgramBooking` model en `models/business.py` | ✅ Completo |
| Sprint 2 — Fase 2 Migración | `20260417_1000_add_program_bookings.py` — ejecutada 2026-04-20 | ✅ Completo |
| Sprint 2 — Fase 2 Schemas | `ProgramBookingCreate`, `ProgramBookingOut`, `ProgramBookingCancelRequest` | ✅ Completo |
| Sprint 2 — Fase 2 Endpoints | POST, GET list, GET single, GET reservations, DELETE en `classes.py` | ✅ Completo |
| Sprint 2 — Fase 2 api.ts | `programBookingsApi` (list, create, get, listReservations, cancel) | ✅ Completo |
| Sprint 3 — Fase 2 Frontend member | Sección "Mis Programas", modal reservar, modal cancelar en `MemberAppPage.tsx` | ✅ Completo |
| Fase 3 | Cancelación individual ya funciona (DELETE /reservations/{id} existente) | ✅ Sin cambios requeridos |
| Sprint 4 — Staff view | Pestaña "Reservas" en ProgramsPage para staff | ✅ Completo |
| Sprint 4 — Badge en reservas individuales | Indicador de origen de programa en ClassesPage | ✅ Completo |
| Sprint 4 — Notificaciones email | Email al reservar/cancelar programa | ✅ Completo |
| Sprint 4 — Deduplicación generate-classes | Evitar generar clases duplicadas si ya existe grupo para el rango | ✅ Completo |

---

## Estado Actual (Gaps Identificados)

### Gap 1 — Configuración por día incompleta

`schedule_json` actual:
```json
[{ "day": "Lunes", "focus": "Pecho", "exercises": [...] }]
```

Al generar clases, todos los días heredan los mismos valores del request:
- `branch_id` — igual para todos los días
- `instructor_id` — igual para todos los días
- `modality` — siempre `in_person` (hardcodeado)
- `max_capacity` — igual para todos los días
- `online_link` — nunca se asigna
- `cancellation_deadline_hours` — siempre default (2h)
- `restricted_plan_id` — nunca se asigna
- `color` — igual para todos los días
- `class_type` — igual para todos los días

### Gap 2 — No existe reserva de programa

- `TrainingProgramEnrollment` solo es un join user↔program, sin link a reservas
- El cliente debe reservar cada clase individualmente
- No existe cancelación en cascada de un programa
- No existe historial de "reservé el programa X y tomé N de M clases"

---

## Fase 1 — Enriquecer schedule_json por día

### 1.1 Nuevo formato de schedule_json

```json
[
  {
    "day": "Lunes",
    "focus": "Pecho y Tríceps",
    "exercises": [...],
    "class_config": {
      "branch_id": "uuid-or-null",
      "instructor_id": "uuid-or-null",
      "modality": "in_person",
      "max_capacity": 20,
      "online_link": null,
      "cancellation_deadline_hours": 2,
      "restricted_plan_id": "uuid-or-null",
      "color": "#3B82F6",
      "class_type": "fuerza"
    }
  }
]
```

`class_config` es opcional por día — si está ausente o un campo es null, se usa el valor del request general (fallback).

**Archivos a modificar:**
- `backend/app/models/business.py` — sin cambios al modelo (schedule_json sigue siendo Text/JSON)
- `backend/app/schemas/platform.py` — añadir `ProgramScheduleDayConfig` y `ProgramScheduleDay` actualizado (líneas 313-374)
- `backend/app/api/v1/endpoints/operations.py` — `GenerateClassesRequest` (líneas 600-612) y lógica de generación (líneas 1841-1901)
- `frontend/src/types/index.ts` — `ProgramScheduleDay` (líneas 490-506)
- `frontend/src/pages/programs/ProgramsPage.tsx` — UI del modal de creación/edición de programa

### 1.2 Backend: GenerateClassesRequest como fallback

```python
# operations.py ~línea 600
class ProgramScheduleDayConfig(BaseModel):
    branch_id: Optional[UUID] = None
    instructor_id: Optional[UUID] = None
    modality: str = "in_person"
    max_capacity: int = 20
    online_link: Optional[str] = None
    cancellation_deadline_hours: int = 2
    restricted_plan_id: Optional[UUID] = None
    color: Optional[str] = None
    class_type: Optional[str] = None

class GenerateClassesRequest(BaseModel):
    start_date: date
    weeks: int = Field(ge=1, le=52, default=4)
    class_time: str                          # HH:MM — fallback para días sin time propio
    duration_minutes: int = Field(ge=15, le=480)
    # Campos fallback — se usan si el día no tiene class_config
    branch_id: Optional[UUID] = None
    instructor_id: Optional[UUID] = None
    modality: str = "in_person"
    max_capacity: int = Field(ge=1, default=20)
    online_link: Optional[str] = None
    cancellation_deadline_hours: int = 2
    restricted_plan_id: Optional[UUID] = None
    color: Optional[str] = None
    class_type: Optional[str] = None
    utc_offset_minutes: int = 0
```

### 1.3 Backend: lógica de generación con merge

```python
# operations.py ~línea 1855 — dentro del loop por día
day_config = schedule_day.get("class_config", {}) or {}

resolved = {
    "branch_id":                    day_config.get("branch_id") or req.branch_id,
    "instructor_id":                day_config.get("instructor_id") or req.instructor_id,
    "modality":                     day_config.get("modality") or req.modality,
    "max_capacity":                 day_config.get("max_capacity") or req.max_capacity,
    "online_link":                  day_config.get("online_link") or req.online_link,
    "cancellation_deadline_hours":  day_config.get("cancellation_deadline_hours") or req.cancellation_deadline_hours,
    "restricted_plan_id":           day_config.get("restricted_plan_id") or req.restricted_plan_id,
    "color":                        day_config.get("color") or req.color,
    "class_type":                   day_config.get("class_type") or req.class_type or program.program_type,
}
```

### 1.4 Frontend: UI por día en ProgramsPage

En el modal de creación/edición de programa, al definir el schedule de cada día agregar un expander "Configuración de clase" con:

- Selector de **sucursal** (branch_id)
- Selector de **instructor** (instructor_id)
- Selector de **modalidad** (in_person / online / hybrid)
- **Capacidad máxima** (número)
- **Link online** (texto, visible solo si modalidad ≠ in_person)
- Selector de **plan restringido** (optional)
- **Color** del calendario (color picker)
- **Tipo de clase** (text)
- **Horas para cancelar** (número)

Si el campo queda vacío → usa el valor global del modal de generación de clases (fallback explícito).

**Archivos frontend:**
- `frontend/src/types/index.ts` — añadir `ProgramScheduleDayConfig` interface
- `frontend/src/pages/programs/ProgramsPage.tsx` — expander por día en ScheduleTab
- `frontend/src/services/api.ts` — actualizar payload de generate-classes si hay cambios

---

## Fase 2 — Reserva de Programa (ProgramBooking)

### 2.1 Nuevo modelo: ProgramBooking

```python
# backend/app/models/business.py — después de Reservation (~línea 244)

class ProgramBooking(Base):
    __tablename__ = "program_bookings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    program_id = Column(UUID(as_uuid=True), ForeignKey("training_programs.id"), nullable=False, index=True)
    recurrence_group_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="active")
    # active | cancelled
    cancelled_at = Column(DateTime, nullable=True)
    cancel_reason = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "recurrence_group_id", name="uq_program_booking_user_group"),
    )
```

**Relación:**  
`ProgramBooking` 1→N `Reservation` (linked via user_id + gym_class.recurrence_group_id)

No hay FK directa desde Reservation a ProgramBooking (evita migración compleja). La relación se resuelve por query en runtime:
```sql
SELECT r.*
FROM reservations r
JOIN gym_classes c ON r.gym_class_id = c.id
WHERE r.user_id = :user_id
  AND c.recurrence_group_id = :recurrence_group_id
  AND r.status IN ('confirmed', 'waitlisted')
```

### 2.2 Migración

```
backend/migrations/versions/20260417_XXXX_add_program_bookings.py
```

Crea tabla `program_bookings` con índices en (tenant_id, user_id, program_id, recurrence_group_id, status).

### 2.3 Schemas

```python
# backend/app/schemas/business.py

class ProgramBookingCreate(BaseModel):
    program_id: UUID
    recurrence_group_id: UUID

class ProgramBookingOut(BaseModel):
    id: UUID
    user_id: UUID
    program_id: UUID
    recurrence_group_id: UUID
    status: str
    total_classes: int          # total clases en el grupo
    reserved_classes: int       # cuántas quedaron confirmadas
    waitlisted_classes: int     # cuántas en lista de espera
    failed_classes: int         # cuántas no se pudieron reservar (clase ya pasó, etc.)
    cancelled_at: Optional[datetime]
    created_at: datetime
```

### 2.4 Endpoints

#### POST /program-bookings — Reservar un programa

```
POST /api/v1/program-bookings
Auth: member
Body: { program_id, recurrence_group_id }
```

**Lógica:**

1. Verificar que el usuario no tenga ya un ProgramBooking activo para este `recurrence_group_id`
2. Obtener todas las clases del grupo: `GymClass WHERE recurrence_group_id = X AND status != 'cancelled' AND start_time > now()`
3. Para cada clase, intentar crear una `Reservation` usando la lógica existente (respeta cupo, waitlist, restricciones de plan)
4. Crear `ProgramBooking(status="active")`
5. Retornar `ProgramBookingOut` con conteo de confirmadas/waitlisted/fallidas

**Comportamiento ante fallos parciales:**
- Si algunas clases están llenas → se reserva igual, esas clases quedan en waitlist (no falla el endpoint)
- Si la clase ya pasó → se omite silenciosamente (no cuenta como fallo)
- Si el usuario ya tiene reserva individual en alguna clase del grupo → se reutiliza esa reserva (no duplica)

#### DELETE /program-bookings/{id} — Cancelar reserva de programa

```
DELETE /api/v1/program-bookings/{id}
Auth: member (solo el dueño) o staff
Body: { cancel_reason?: string }
```

**Lógica:**

1. Verificar ownership (o rol staff)
2. Buscar todas las `Reservation` activas (confirmed/waitlisted) del usuario para clases de ese `recurrence_group_id`
3. Filtrar solo las que `start_time > now() + cancellation_deadline_hours` — respeta deadline
4. Cancelar cada Reservation usando la lógica existente (libera cupo, promueve waitlist)
5. Actualizar `ProgramBooking.status = "cancelled"`, `cancelled_at = now()`
6. Si hay clases cuyo deadline ya pasó → se reportan en la respuesta pero NO se cancelan
7. Retornar resumen: `{ cancelled: N, skipped_deadline: M, already_past: K }`

**Opción staff:** puede cancelar ignorando deadline (query param `?force=true`, solo owners/admins).

#### GET /program-bookings — Listar reservas de programa del usuario

```
GET /api/v1/program-bookings
Auth: member o staff
Query params: status (active|cancelled|all), program_id
```

Retorna lista de `ProgramBookingOut` con conteo de clases.

#### GET /program-bookings/{id}/reservations — Ver clases de una reserva de programa

```
GET /api/v1/program-bookings/{id}/reservations
Auth: member (dueño) o staff
```

Retorna las `Reservation` asociadas al ProgramBooking con detalle de cada clase.

### 2.5 Frontend: UX del cliente (MemberAppPage)

**Archivo principal:** `frontend/src/pages/member/MemberAppPage.tsx`

#### Vista de programa disponible

En la sección de programas del cliente, cada programa con clases generadas muestra:
- Nombre, instructor, días/horarios
- Botón **"Reservar programa"** (si no tiene reserva activa para ese grupo)
- Badge con estado si ya tiene reserva activa

#### Modal de confirmación de reserva de programa

Al clickar "Reservar programa":
```
┌─────────────────────────────────────────┐
│  Reservar: Fuerza Funcional             │
│                                         │
│  Se reservarán 12 clases:               │
│  ✓ Lunes 21/04 — 09:00 (2 lugares)     │
│  ✓ Miércoles 23/04 — 09:00 (5 lugares) │
│  ⏳ Viernes 25/04 — 09:00 (LLENA)       │
│  ...                                    │
│                                         │
│  Las clases llenas quedan en lista      │
│  de espera automáticamente.             │
│                                         │
│  [Cancelar]     [Confirmar reserva]     │
└─────────────────────────────────────────┘
```

#### Modal de cancelación de programa

Cuando el cliente cancela su reserva de programa:
```
┌─────────────────────────────────────────┐
│  Cancelar reserva: Fuerza Funcional     │
│                                         │
│  Se cancelarán 10 clases futuras.       │
│  2 clases no se pueden cancelar porque  │
│  comienzan en menos de 2 horas.         │
│                                         │
│  ¿Confirmar cancelación?                │
│                                         │
│  [Volver]       [Cancelar programa]     │
└─────────────────────────────────────────┘
```

#### Mis reservas de programa

Nueva sección "Mis Programas" en la app del cliente:
- Lista de ProgramBookings activos y cancelados
- Para cada uno: progreso (clases tomadas / total), próxima clase
- Botón "Cancelar programa" en los activos
- Click en programa → ver lista de clases individuales con estado

### 2.6 Frontend: UX del staff (ClassesPage / ProgramsPage)

**En ProgramsPage** — Vista del programa:
- Nueva tab o sección "Reservas" que muestra todos los ProgramBookings de ese programa
- Por grupo de recurrencia: cuántos alumnos reservaron el programa completo

**En MemberDetail** (si existe) o en ClassesPage:
- Al ver reservas de un miembro, mostrar si la reserva individual proviene de un ProgramBooking (badge "Prog.")

---

## Fase 3 — Cancelación individual de clase dentro de un programa

El cliente puede cancelar una clase individual sin cancelar todo el programa:
- La `Reservation` individual se cancela normalmente
- El `ProgramBooking` permanece activo
- Al ver "Mis Programas", la clase aparece como "Cancelada individualmente"
- El cliente puede re-reservar esa clase individual si hay cupo

Esta funcionalidad ya existe (DELETE /reservations/{id}) — no requiere cambios backend, solo asegurar que el frontend del miembro lo permita desde la vista de detalle del programa.

---

## Orden de implementación

### Sprint 1 — Clases completas desde programa (Fase 1)

1. **Backend schema** — Añadir `ProgramScheduleDayConfig` en schemas (30 min)
2. **Backend generate-classes** — Lógica de merge per-día en `operations.py` (45 min)
3. **Migración** — No requerida (schedule_json es Text, cambio es aditivo/retrocompatible)
4. **Frontend types** — Actualizar `ProgramScheduleDay` en `types/index.ts` (15 min)
5. **Frontend ProgramsPage** — Expander de config por día en el modal de schedule (2-3h)
6. **Test** — Crear programa con configs distintas por día, generar clases, verificar campos

### Sprint 2 — Modelo y endpoints de reserva de programa (Fase 2 backend)

1. **Modelo ProgramBooking** — `models/business.py` (30 min)
2. **Migración** — `add_program_bookings.py` (20 min)
3. **Schemas** — `ProgramBookingCreate`, `ProgramBookingOut` (30 min)
4. **POST /program-bookings** — lógica de bulk reservation (1.5h)
5. **DELETE /program-bookings/{id}** — cancelación en cascada (1h)
6. **GET endpoints** — list y detail (45 min)
7. **Test endpoints** — Postman/pytest (1h)

### Sprint 3 — Frontend cliente (Fase 2 frontend)

1. **api.ts** — funciones para program-bookings (30 min)
2. **types/index.ts** — tipos `ProgramBooking`, `ProgramBookingOut` (15 min)
3. **MemberAppPage** — sección "Mis Programas" + modal reservar + modal cancelar (3-4h)
4. **Test UX** — flujo completo reserva → asistencia → cancelación parcial (1h)

### Sprint 4 — Polish y edge cases

- Staff view de program bookings en ProgramsPage
- Badge en reservas individuales indicando origen de programa
- Notificación email al reservar/cancelar programa (usar `email_service.py`)
- Validar que generate-classes no duplique clases si ya existe un grupo para ese rango de fechas

---

## Reglas de negocio clave

| Regla | Comportamiento |
|-------|----------------|
| Cupo agotado al reservar programa | Clase queda en waitlist (no falla la reserva) |
| Clase ya pasó al reservar programa | Se omite, no se reserva, no se reporta como error |
| Usuario ya tiene reserva individual | Se reutiliza, no duplica |
| Deadline de cancelación excedido | Clase se omite en la cancelación (se reporta al usuario) |
| Cancelar clase individual de un programa | Solo cancela esa clase, ProgramBooking sigue activo |
| Cancelar programa | Cancela todas las clases futuras respetando deadlines |
| Staff cancelando programa | Puede ignorar deadlines con `?force=true` |
| Programa eliminado | ProgramBookings existentes permanecen; `program_id` → NULL en GymClass |
| Clase individual cancelada por staff | ProgramBooking permanece activo |

---

## Archivos impactados (resumen)

### Backend
| Archivo | Cambio |
|---------|--------|
| `backend/app/models/business.py` | Añadir `ProgramBooking` model |
| `backend/app/schemas/business.py` | Añadir schemas de ProgramBooking |
| `backend/app/schemas/platform.py` | Añadir `ProgramScheduleDayConfig` |
| `backend/app/api/v1/endpoints/operations.py` | Actualizar `GenerateClassesRequest` + lógica gen |
| `backend/app/api/v1/endpoints/classes.py` | Añadir endpoints /program-bookings |
| `backend/app/api/v1/__init__.py` o router | Registrar nuevas rutas |
| `backend/migrations/versions/` | Nueva migración `add_program_bookings` |

### Frontend
| Archivo | Cambio |
|---------|--------|
| `frontend/src/types/index.ts` | `ProgramScheduleDayConfig`, `ProgramBooking` types |
| `frontend/src/services/api.ts` | Funciones program-bookings, actualizar generate-classes |
| `frontend/src/pages/programs/ProgramsPage.tsx` | Expander config por día |
| `frontend/src/pages/member/MemberAppPage.tsx` | Sección Mis Programas, modales |
