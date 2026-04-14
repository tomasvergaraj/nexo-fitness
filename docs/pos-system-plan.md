# Plan POS — Tienda Interna del Gym

**Estado:** Planificación  
**Fecha:** 2026-04-14  
**Scope:** Módulo de punto de venta para owners/admins — gestión de stock (barritas, suplementos, ropa, etc.) con reportes de gastos vs ganancias.

---

## Contexto del Sistema Actual

- **Backend:** FastAPI + SQLAlchemy 2.0 async + PostgreSQL + Alembic
- **Frontend:** React 18 + TypeScript + React Query + Tailwind
- **Multitenancy:** Todas las entidades scoped por `tenant_id`
- **Pagos:** Stripe / Fintoc / Webpay / Cash / Transfer (enum `PaymentMethod` existente)
- **Reportes:** `GET /api/v1/reports/overview` con `revenue_series` via Recharts
- **Sin modelos POS existentes** — la capa de commerce actual es solo membresías

---

## Modelo de Datos (Phase 1)

### Nuevas tablas

```
products
├── id (UUID PK)
├── tenant_id (FK tenants)
├── category_id (FK product_categories, nullable)
├── name
├── description (nullable)
├── sku (nullable, unique per tenant)
├── barcode (nullable)
├── price          ← precio de venta
├── cost           ← costo de compra (para margen)
├── image_url (nullable)
├── unit (unidad: "unidad" / "kg" / "litro")
├── is_active (bool, default true)
├── created_at / updated_at

product_categories
├── id (UUID PK)
├── tenant_id (FK tenants)
├── name
├── color (hex, para UI)
├── icon (string, nombre ícono Lucide)

inventory
├── id (UUID PK)
├── tenant_id (FK tenants)
├── product_id (FK products)
├── branch_id (FK branches, nullable — null = stock global)
├── quantity (int, current stock)
├── min_stock (int — alerta bajo stock)
├── UNIQUE(product_id, branch_id)

inventory_movements
├── id (UUID PK)
├── tenant_id (FK tenants)
├── product_id (FK products)
├── branch_id (FK branches, nullable)
├── movement_type  ENUM: purchase / sale / adjustment / return / loss / transfer
├── quantity       ← positivo = entrada, negativo = salida
├── unit_cost      ← costo unitario al momento del movimiento
├── reference_id   ← FK a pos_transactions o purchase_orders (nullable)
├── reference_type ← "pos_transaction" | "purchase_order" | "manual"
├── notes (nullable)
├── created_by (FK users)
├── created_at

suppliers
├── id (UUID PK)
├── tenant_id (FK tenants)
├── name
├── contact_name (nullable)
├── email (nullable)
├── phone (nullable)
├── notes (nullable)
├── is_active (bool)

purchase_orders
├── id (UUID PK)
├── tenant_id (FK tenants)
├── supplier_id (FK suppliers, nullable)
├── branch_id (FK branches, nullable)
├── status  ENUM: draft / ordered / received / cancelled
├── total_cost     ← calculado al recibir
├── notes (nullable)
├── ordered_at (nullable)
├── received_at (nullable)
├── created_by (FK users)
├── created_at / updated_at

purchase_order_items
├── id (UUID PK)
├── purchase_order_id (FK purchase_orders)
├── product_id (FK products)
├── quantity_ordered
├── quantity_received (nullable — al marcar recibido)
├── unit_cost

pos_transactions
├── id (UUID PK)
├── tenant_id (FK tenants)
├── branch_id (FK branches, nullable)
├── cashier_id (FK users)
├── subtotal
├── discount_amount (default 0)
├── total
├── payment_method  ← reutiliza enum PaymentMethod existente
├── status  ENUM: completed / cancelled / refunded
├── notes (nullable)
├── sold_at (timestamp)

pos_transaction_items
├── id (UUID PK)
├── transaction_id (FK pos_transactions)
├── product_id (FK products)
├── product_name   ← snapshot al momento de venta
├── quantity
├── unit_price     ← precio al momento de venta
├── unit_cost      ← costo al momento de venta (para margen)
├── subtotal

expenses
├── id (UUID PK)
├── tenant_id (FK tenants)
├── branch_id (FK branches, nullable)
├── category  ENUM: rent / utilities / equipment / supplies / payroll / maintenance / marketing / other
├── amount
├── description
├── receipt_url (nullable)
├── expense_date (date)
├── created_by (FK users)
├── created_at / updated_at
```

---

## Phases

---

### Phase 1 — Modelos y Migración
**Scope:** Solo backend, sin UI.

**Archivos a crear:**
- `backend/app/models/pos.py` — todas las tablas arriba
- `backend/migrations/versions/20260415_1000_pos_system.py`

**Tareas:**
1. Crear `backend/app/models/pos.py` con todos los modelos SQLAlchemy 2.0
2. Agregar imports en `backend/app/models/__init__.py`
3. Crear migración Alembic (`alembic revision --autogenerate`)
4. Validar con `alembic upgrade head` en dev

**Dependencias:** Ninguna. Blocker para todo lo demás.

**Estimado de archivos:** 2 nuevos + 1 modificado

---

### Phase 2 — Backend API (CRUD Core)
**Scope:** Endpoints REST para gestión de productos, inventario y categorías.

**Nuevos routers en** `backend/app/api/v1/endpoints/pos.py`:

```
# Categorías
GET    /pos/categories
POST   /pos/categories
PUT    /pos/categories/{id}
DELETE /pos/categories/{id}

# Productos
GET    /pos/products              ?category_id&active&search&page&size
POST   /pos/products
GET    /pos/products/{id}
PUT    /pos/products/{id}
DELETE /pos/products/{id}         ← soft delete (is_active=false)

# Inventario
GET    /pos/inventory             ?branch_id&low_stock=true
GET    /pos/inventory/{product_id}
PUT    /pos/inventory/{product_id}  ← ajuste manual de stock
GET    /pos/inventory/movements   ?product_id&branch_id&from_date&to_date

# Proveedores
GET    /pos/suppliers
POST   /pos/suppliers
PUT    /pos/suppliers/{id}
DELETE /pos/suppliers/{id}

# Órdenes de compra
GET    /pos/purchase-orders
POST   /pos/purchase-orders
GET    /pos/purchase-orders/{id}
PUT    /pos/purchase-orders/{id}/receive  ← marca recibido + actualiza stock
DELETE /pos/purchase-orders/{id}          ← solo si draft

# Gastos
GET    /pos/expenses              ?category&from_date&to_date&branch_id
POST   /pos/expenses
PUT    /pos/expenses/{id}
DELETE /pos/expenses/{id}
```

**Schemas Pydantic** en `backend/app/schemas/pos.py`:
- Request/Response para cada entidad
- `ProductCreate`, `ProductUpdate`, `ProductOut`
- `InventoryMovementOut`, `StockAdjustmentIn`
- `PurchaseOrderCreate`, `PurchaseOrderReceiveIn`
- `ExpenseCreate`, `ExpenseOut`

**Permisos:**
- `owner` / `admin` → CRUD completo
- `reception` → solo leer inventario + crear pos_transactions
- `trainer` / `marketing` → sin acceso

**Archivos a crear/modificar:**
- `backend/app/api/v1/endpoints/pos.py` (nuevo)
- `backend/app/schemas/pos.py` (nuevo)
- `backend/app/main.py` (registrar router)

---

### Phase 3 — POS Terminal (Venta en Caja)
**Scope:** Endpoint de venta + UI de caja (la pantalla que usa recepción/owner para cobrar).

**Backend — endpoint de venta:**
```
POST /pos/transactions
Body: {
  items: [{product_id, quantity}],
  payment_method: "cash" | "transfer" | ...,
  discount_amount: 0,
  branch_id: null,
  notes: null
}
```
**Lógica atómica:**
1. Validar stock disponible para cada ítem
2. Crear `pos_transaction` + `pos_transaction_items` (con snapshot de precio/costo)
3. Crear `inventory_movements` (type=sale, quantity negativo) por cada ítem
4. Actualizar `inventory.quantity`
5. Return transaction con total e ítems

```
GET  /pos/transactions             ?from_date&to_date&cashier_id&status
GET  /pos/transactions/{id}
POST /pos/transactions/{id}/refund ← revierte stock + crea movimiento type=return
```

**Frontend — página `/pos`:**

```
Layout: dos columnas
├── Columna izquierda (60%): Catálogo de productos
│   ├── Filtro por categoría (tabs de colores)
│   ├── Búsqueda por nombre/sku/barcode
│   └── Grid de product cards (imagen, nombre, precio, stock badge)
│
└── Columna derecha (40%): Carrito
    ├── Lista de ítems con quantity controls (+/-)
    ├── Subtotal / descuento / total
    ├── Selector método de pago
    ├── Botón "Cobrar" → modal de confirmación
    └── Historial de últimas ventas (hoy)
```

**Archivos frontend a crear:**
- `frontend/src/pages/pos/POSPage.tsx`
- `frontend/src/pages/pos/components/ProductGrid.tsx`
- `frontend/src/pages/pos/components/Cart.tsx`
- `frontend/src/pages/pos/components/ProductCard.tsx`
- `frontend/src/pages/pos/components/CheckoutModal.tsx`
- Agregar ruta `/pos` en `router.tsx`
- Agregar link en `Sidebar.tsx`
- Agregar tipos en `types/index.ts`
- Agregar API calls en `services/api.ts`

---

### Phase 4 — Gestión de Inventario (UI)
**Scope:** Páginas de gestión para owners/admins.

**Nueva sección en el panel: `/inventory`**

```
/inventory
├── Tab: Productos
│   ├── Tabla con filtros (categoría, stock bajo, activo/inactivo)
│   ├── CRUD modal (crear/editar producto)
│   ├── Upload imagen producto
│   └── Badge rojo si stock < min_stock
│
├── Tab: Movimientos
│   ├── Timeline de movimientos por producto
│   ├── Filtros: tipo, producto, rango de fechas, sucursal
│   └── Export CSV
│
├── Tab: Órdenes de Compra
│   ├── Lista de purchase orders con estado badge
│   ├── Crear orden (seleccionar proveedor + ítems + cantidades + costos)
│   └── "Marcar como recibido" → actualiza stock automáticamente
│
└── Tab: Proveedores
    └── CRUD simple
```

**Archivos frontend a crear:**
- `frontend/src/pages/inventory/InventoryPage.tsx`
- `frontend/src/pages/inventory/components/ProductsTab.tsx`
- `frontend/src/pages/inventory/components/MovementsTab.tsx`
- `frontend/src/pages/inventory/components/PurchaseOrdersTab.tsx`
- `frontend/src/pages/inventory/components/SuppliersTab.tsx`
- Modals: `ProductFormModal.tsx`, `PurchaseOrderFormModal.tsx`

---

### Phase 5 — Gastos (UI)
**Scope:** Registro de gastos operacionales del gym.

**Nueva página `/expenses`**

```
/expenses
├── KPIs del mes: total gastos / gastos por categoría (pie chart)
├── Tabla de gastos con filtros (categoría, rango fechas, sucursal)
├── Botón "Registrar gasto" → modal
│   ├── Categoría (selector)
│   ├── Monto
│   ├── Descripción
│   ├── Fecha
│   ├── Sucursal (opcional)
│   └── Upload recibo (imagen/PDF)
└── Export CSV
```

**Archivos frontend:**
- `frontend/src/pages/expenses/ExpensesPage.tsx`
- `frontend/src/pages/expenses/components/ExpenseFormModal.tsx`
- `frontend/src/pages/expenses/components/ExpenseKPIs.tsx`

---

### Phase 6 — Reportes de Gastos vs Ganancias
**Scope:** Integrar ventas POS + gastos en el módulo de reportes existente.

**Backend — extender** `GET /api/v1/reports/overview`:

```json
{
  // campos existentes (memberships)...
  
  // nuevos campos POS:
  "pos_revenue": 125000,          // suma pos_transactions.total
  "pos_revenue_series": [...],    // por día/semana/mes
  "pos_cogs": 67000,              // cost of goods sold (unit_cost * qty)
  "pos_gross_profit": 58000,      // pos_revenue - pos_cogs
  "pos_gross_margin_pct": 46.4,
  "top_products": [               // top 5 por revenue
    {"name": "Barrita Proteína", "revenue": 45000, "units_sold": 90}
  ],
  
  // gastos operacionales:
  "total_expenses": 890000,
  "expenses_by_category": [
    {"category": "rent", "amount": 500000},
    {"category": "utilities", "amount": 120000}
    // ...
  ],
  
  // P&L consolidado:
  "total_revenue": 1250000,        // memberships + pos
  "net_profit": 360000,            // total_revenue - cogs - expenses
  "net_margin_pct": 28.8
}
```

**Frontend — extender** `ReportsPage.tsx`:

Nueva tab **"P&L / Finanzas"**:
```
├── Cards KPI: Ingresos Totales / Costo Mercadería / Gastos Op. / Utilidad Neta
├── Gráfico de líneas: Ingresos (membresías) vs Ingresos (POS) vs Gastos (stacked)
├── Gráfico de barras: Margen bruto POS por mes
├── Tabla: Gastos por categoría con % del total
├── Top productos por revenue (bar chart horizontal)
└── Export PDF con P&L completo (usando reportlab ya instalado)
```

**Archivos a modificar:**
- `backend/app/api/v1/endpoints/operations.py` — función `get_reports_overview`
- `frontend/src/pages/ReportsPage.tsx` — nueva tab P&L

**Nuevo endpoint adicional:**
```
GET /reports/pl-summary?year=2026&month=4
→ P&L mensual detallado para export PDF
POST /reports/pl-export?range=...
→ genera PDF con reportlab y devuelve file
```

---

## Resumen de Fases

| Phase | Descripción | Archivos Nuevos | Archivos Modificados | Blocker |
|-------|-------------|-----------------|----------------------|---------|
| 1 | Modelos + Migración | `models/pos.py`, `migrations/...` | `models/__init__.py` | Ninguno |
| 2 | Backend API CRUD | `endpoints/pos.py`, `schemas/pos.py` | `main.py` | Phase 1 |
| 3 | POS Terminal (caja) | 5 frontend components | `router.tsx`, `Sidebar.tsx`, `api.ts`, `types/index.ts` | Phase 2 |
| 4 | UI Inventario | 6 frontend components | `router.tsx`, `Sidebar.tsx`, `api.ts` | Phase 2 |
| 5 | UI Gastos | 3 frontend components | `router.tsx`, `Sidebar.tsx`, `api.ts` | Phase 2 |
| 6 | Reportes P&L | — | `operations.py`, `ReportsPage.tsx` | Phases 3-5 |

**Orden recomendado:** 1 → 2 → 3 → 4 → 5 → 6 (cada phase entregable independiente)

---

## Consideraciones Técnicas

### Multitenancy
Todos los modelos POS llevan `tenant_id`. Los queries deben filtrar por `tenant_id` del request (ya manejado por `TenantMiddleware`).

### Consistencia de Stock
Las operaciones que modifican `inventory.quantity` deben ser **atómicas** (misma transacción DB):
- Venta POS: crear transaction + items + movements + update inventory
- Recibir orden: update received_at + items received_qty + movements + update inventory
- Refund: crear movement type=return + incrementar inventory

Usar `SELECT ... FOR UPDATE` en `inventory` rows para evitar race conditions en ventas concurrentes.

### Snapshot de Precios
`pos_transaction_items` guarda `unit_price` y `unit_cost` al momento de la venta. Esto permite calcular márgenes históricos correctamente si los precios cambian después.

### Integración con Reportes Existentes
El campo `PaymentMethod` ya es enum en `Payment`. `POSTransaction` reutiliza el mismo enum para consistencia.

### Upload de Imágenes
Reutilizar el endpoint `/upload` existente para imágenes de productos y recibos de gastos.

### Alertas de Stock Bajo
Agregar tarea Celery (tipo `trial_warnings.py`) para notificar cuando `inventory.quantity <= inventory.min_stock`. Usar sistema de notificaciones push existente.

---

## Siguientes Pasos Inmediatos

1. **Aprobar este plan** con el equipo
2. **Implementar Phase 1** — modelos + migración (más rápido, desbloquea todo)
3. **Implementar Phase 2** — endpoints básicos (testeable con curl/Postman antes de UI)
4. **Implementar Phase 3** — POS terminal (la pantalla de caja es el core del feature)
5. Phases 4-6 en iteraciones siguientes

---

*Documento creado: 2026-04-14*  
*Relacionado: `docs/plan-sistema-completo.md`, `docs/MEJORAS.md`*
