# Nexo Fitness — Plan Sistema Completo

> Auditoría al 8 de abril de 2026  
> Cubre: problemas técnicos, navegación PWA/móvil, arquitectura, UX por rol, y despliegue en VPS.
>
> **Última actualización de implementación: 8 de abril de 2026**

---

## 1. Estado del Sistema

### 1.1 Módulos funcionales

| Módulo | Estado | Notas |
|--------|--------|-------|
| Auth + JWT (access/refresh) | ✅ Completo | Roles: superadmin, owner, admin, reception, trainer, marketing, client |
| Multitenancy row-level | ✅ Completo | TenantMiddleware + filtros en queries |
| Clases, reservas, check-in | ✅ Completo | Presencial / Online / Híbrido |
| Planes y membresías | ✅ Completo | Monthly / Annual / Perpetual / Custom |
| Pagos (Stripe + MercadoPago) | ✅ Completo | Webhooks con firma HMAC |
| Fintoc (transferencias CLP) | ✅ Completo | Widget + webhook |
| Dashboard de KPIs | ✅ Completo | Métricas reales del backend |
| Campañas email/push + scheduler | ✅ Completo | Celery Beat |
| Push notifications (Web Push VAPID) | ✅ Completo | SW + backend pywebpush |
| PWA para miembros | ✅ Completo | Instalable, offline-ready, cache inteligente |
| Tienda pública del gimnasio | ✅ Completo | `/store/:slug` con checkout |
| Gestión de sucursales | ✅ Completo | Multi-branch por tenant |
| Reportes y exportación | ✅ Completo | Excel/PDF via openpyxl + reportlab |
| Panel superadmin | ✅ Completo | Tenants, planes SaaS, leads |
| Sistema de soporte interno | ✅ Completo | Interacciones por tenant |
| Billing wall (trial/expired) | ✅ Completo | Redirect automático + banner |
| Docker Compose + Nginx config | ✅ Completo (dev) | **Producción tiene gaps (ver Sección 2)** |
| CI/CD GitHub Actions | ✅ Completo | test.yml + deploy.yml listos, faltan secrets |
| WhatsApp (envío real) | ⚠️ Parcial | Infraestructura lista, envío sin implementar |
| Iconos PWA (PNG) | ⚠️ Parcial | Solo SVG — Android/iOS necesitan PNG |
| S3 / subida de imágenes | ⚠️ No activo | Config lista, bucket sin provisionar |

---

## 2. Problemas Identificados

### 🔴 Críticos — Bloquean producción

#### P1: Dockerfile.frontend no construye para producción

**Archivo:** `docker/Dockerfile.frontend`  
**Problema:** Solo ejecuta `npm run dev`. En producción, Nginx necesita archivos estáticos compilados.  
**Impacto:** El perfil `production` del compose arranca el dev server de Vite como si fuera prod — inseguro, lento, y sin optimización.

**Fix:** Reemplazar con Dockerfile multi-stage:
```dockerfile
# Etapa 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Etapa 2: servidor estático
FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

El `nginx-frontend.conf` debe incluir `try_files $uri $uri/ /index.html;` para que React Router funcione correctamente.

---

#### P2: Nginx sin HTTPS/SSL

**Archivo:** `nginx/nginx.conf`  
**Problema:** Solo tiene `listen 80`. El `docker-compose.yml` expone el puerto 443 pero no hay bloque de servidor HTTPS, ni configuración de certificados.  
**Impacto:** Sin HTTPS, la PWA no puede registrar service workers (requiere contexto seguro), no funciona Web Push, y los datos viajan sin cifrar.

**Fix:** Agregar bloque HTTPS con Certbot / Cloudflare (ver Sección 5 — VPS).

---

#### P3: Celery Worker y Beat sin variables de entorno del backend

**Archivo:** `docker-compose.yml` — servicios `worker` y `beat`  
**Problema:** No tienen `env_file: - ./backend/.env`. Solo tienen `DATABASE_URL` y `REDIS_URL`.  
**Impacto:** Las tareas en background (envío de emails con SendGrid, procesamiento de pagos Stripe, push notifications) fallan silenciosamente porque no tienen las API keys.

**Fix:** Agregar `env_file: - ./backend/.env` a los servicios `worker` y `beat`.

---

#### P4: Service Worker intercepta rutas de admin en móvil

**Archivo:** `frontend/public/sw.js`  
**Problema:** El SW tiene scope `/` (todo el sitio) y su handler `fetch` hace fallback a `/member` para cualquier navigate request. Si un admin (owner, recepcionista) recarga `/dashboard` en un navegador móvil donde el SW está instalado, el SW devuelve la shell de `/member` en vez del dashboard.  
**Impacto:** Admins que usen el dashboard desde móvil verán la app de miembros tras un refresh.

**Fix (opción A — recomendada):** Cambiar el scope del SW a `/member` solo:
```js
// En pwa.ts, registrar con scope específico:
navigator.serviceWorker.register('/sw.js', { scope: '/member' })
```
Y ajustar la lógica del handler de navigate para que solo intercepte rutas bajo `/member`.

**Fix (opción B):** Hacer el fallback inteligente según el JWT del usuario:
```js
// En el SW, en el handler de navigate, verificar si la ruta es del admin
if (url.pathname.startsWith('/member') || url.pathname === '/') {
  event.respondWith(networkFirst(request, APP_SHELL_CACHE, '/member'));
} else {
  // Dejar pasar al browser normalmente
  return;
}
```

---

### 🟡 Altos — Degradan UX o seguridad

#### P5: Credenciales de demo hardcodeadas en LoginPage

**Archivo:** `frontend/src/pages/auth/LoginPage.tsx:14-16`  
**Problema:** El estado inicial del form pre-rellena `owner@nexogym.cl / Owner123!`. Cualquier usuario que abra el login ve estas credenciales.  
**Fix:** Eliminar los valores por defecto:
```tsx
const initialEmail = searchParams.get('email') ?? '';
const [email, setEmail] = useState(initialEmail);
const [password, setPassword] = useState('');
```

---

#### P6: AppLayout — sidebar abierto por defecto en móvil

**Archivo:** `frontend/src/components/layout/AppLayout.tsx:67`  
**Problema:** `const [sidebarOpen, setSidebarOpen] = useState(true)` — en pantallas pequeñas el sidebar overlay tapa el contenido desde el primer render.  
**Fix:**
```tsx
const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
```

---

#### P7: Iconos PWA solo en formato SVG

**Archivo:** `frontend/public/manifest.webmanifest`  
**Problema:** Solo hay iconos SVG. Android 8 y versiones anteriores de iOS no soportan SVG en manifiestos de PWA.  
**Impacto:** La instalación a pantalla de inicio puede fallar o mostrar icono en blanco en dispositivos Android.  
**Fix:** Generar PNG 192×192 y 512×512 (herramienta: Inkscape, Sharp, o Squoosh) y agregarlos al manifest:
```json
{
  "src": "/icons/icon-192.png",
  "sizes": "192x192",
  "type": "image/png",
  "purpose": "any maskable"
}
```

---

#### P8: CI/CD deploy no depende de tests

**Archivo:** `.github/workflows/deploy.yml:16`  
**Problema:** `needs: []  # Uncomment when test job is stable: needs: [backend-tests]`  
**Fix:** Activar la dependencia ahora que hay workflows de tests:
```yaml
needs: [backend-tests]
```

---

#### P9: Deploy usa `--no-cache` — lento

**Archivo:** `.github/workflows/deploy.yml`  
**Problema:** `docker compose build --no-cache` reconstruye todo desde cero en cada deploy.  
**Fix:** Quitar `--no-cache`. Docker reutiliza capas si el contexto no cambió.

---

### 🟢 Medios — Mejoras importantes

#### P10: No hay `docker-compose.prod.yml` separado

El `docker-compose.yml` mezcla configuración de desarrollo (volúmenes, `--reload`, Vite dev) con producción. En producción el frontend debe servirse como estáticos.

**Fix:** Crear `docker-compose.prod.yml` que:
- Elimine el servicio `frontend` (Vite)
- Use Nginx para servir el build estático
- Elimine montajes de volumen para código fuente
- Cambie el comando del backend a `uvicorn` sin `--reload`

---

#### P11: Directorio `nginx/ssl` no existe

**Archivo:** `docker-compose.yml:116`  
**Problema:** `./nginx/ssl:/etc/nginx/ssl:ro` — Docker falla si el directorio no existe.  
**Fix:** Crear el directorio vacío y agregar `.gitkeep`, o usar Certbot como volumen gestionado.

---

#### P12: iOS safe-area insets faltantes en tab bar de la PWA

**Archivo:** `frontend/src/pages/member/MemberAppPage.tsx`  
**Problema:** En iPhone con notch o Dynamic Island, el tab bar inferior queda oculto bajo la barra de inicio.  
**Fix:** Agregar en el contenedor del tab bar:
```tsx
style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
```
Y en `index.html`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

---

#### P13: Carpeta `mobile/` Expo en el repositorio

**Problema:** La app React Native/Expo en `/mobile` ya no se usa (reemplazada por PWA). Confunde a colaboradores y aumenta el tamaño del repo.  
**Fix:** Eliminar la carpeta `mobile/` o moverla a un branch archivado.

---

## 3. Arquitectura y Conectividad

```
┌─────────────────────────────────────────────────────────┐
│                    INTERNET / CLIENTE                    │
└────────────────┬──────────────────┬─────────────────────┘
                 │                  │
         HTTPS:443           HTTPS:443
         (web admin)         (PWA miembro)
                 │                  │
┌────────────────▼──────────────────▼─────────────────────┐
│                    NGINX (reverse proxy)                 │
│  /api/*        → backend:8000                           │
│  /             → /usr/share/nginx/html (React SPA)      │
│  /member       → mismo SPA, SW intercepta              │
│  /store/:slug  → mismo SPA, ruta pública                │
└────────────────────────┬────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   FastAPI (backend)  │
              │   uvicorn :8000      │
              │                      │
              │  ┌────────────────┐  │
              │  │ TenantMiddleware│  │   ← extrae tenant_id del JWT
              │  └────────────────┘  │
              │  ┌────────────────┐  │
              │  │ API Routers    │  │   ← auth, billing, classes, etc.
              │  └────────────────┘  │
              │  ┌────────────────┐  │
              │  │ Services       │  │   ← lógica de negocio
              │  └────────────────┘  │
              └───┬──────┬───────────┘
                  │      │
        ┌─────────▼─┐  ┌─▼────────┐
        │ PostgreSQL │  │  Redis   │
        │ (datos)    │  │ (caché / │
        └─────────────┘  │ Celery) │
                         └──────────┘
                              │
                   ┌──────────▼──────────┐
                   │   Celery Worker      │
                   │   (tareas async)     │
                   │                      │
                   │  • Envío de emails   │ → SendGrid
                   │  • Push notifs       │ → Web Push VAPID
                   │  • Webhooks salientes│
                   └──────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │   Celery Beat        │
                   │   (cron / scheduler) │
                   │  • Campañas prog.    │
                   │  • Expiración trials │
                   └──────────────────────┘
```

### Flujo de autenticación

```
[Browser] → POST /api/v1/auth/login
         ← { access_token (30min), refresh_token (7d), user }

[Browser] → GET /api/v1/dashboard/metrics
           Header: Authorization: Bearer <access_token>
           TenantMiddleware extrae tenant_id del JWT
         ← { métricas filtradas por tenant }

[access_token expira] → POST /api/v1/auth/refresh
                        Body: { refresh_token }
                      ← { access_token nuevo, refresh_token nuevo }
```

### Flujo de billing (owner)

```
[Register] → POST /api/v1/auth/register-gym
           ← tenant creado, status=TRIAL, trial_ends_at = hoy + 14 días

[Trial activo] → GET /api/v1/billing/status
              ← { allow_access: true, status: "trial", days_remaining: 14 }

[Trial vencido] → GET /api/v1/billing/status
               ← { allow_access: false, status: "expired" }
               → AppLayout redirige a /billing/expired

[Checkout] → POST /api/v1/billing/reactivate
           ← { checkout_url: "https://checkout.stripe.com/..." }
           → Stripe Checkout → stripe webhook → tenant status = ACTIVE
```

### Flujo PWA del miembro (cliente)

```
[Login] → POST /api/v1/auth/login (role: client)
        ← JWT con tenant_id
        → React Router redirige a /member

[/member carga] → GET /api/v1/mobile/wallet
               ← { nombre, membresía activa, tenant_slug, saldo }

               → GET /api/v1/public/tenants/{slug}/profile
               ← { nombre gym, logo, horarios }

               → GET /api/v1/classes?status=scheduled
               ← [ lista de clases próximas ]

[Reserva clase] → POST /api/v1/reservations
               ← { id, status: "confirmed" }

[Checkout plan] → POST /api/v1/public/tenants/{slug}/checkout-session
               ← { checkout_url: Stripe/MercadoPago/Fintoc URL }
               → Pago externo → webhook → membresía activada

[Push notification] → SW recibe push event
                    → showNotification("Clase cancelada...")
                    → click → navigate /member?tab=notifications
```

---

## 4. UX por Rol

### 4.1 Owner (dueño del gimnasio)

**Entrada:** `/login` → `/dashboard`

**Flujo principal:**
1. **Dashboard** — vista de KPIs: ingresos del mes, clases hoy, reservas activas, check-ins
2. **Clientes** — lista CRM, crear/editar miembros, historial de pagos
3. **Clases** — calendario de clases, crear/editar/cancelar, ver reservas
4. **Planes** — CRUD de planes de membresía (mensual, anual, etc.)
5. **Pagos** — registro de pagos manuales (efectivo, transferencia)
6. **Check-in** — marcar asistencia con búsqueda rápida
7. **Marketing** — crear campañas email/push, ver stats
8. **Programas** — planificación de rutinas/entrenamientos
9. **Reportes** — ingresos, ocupación, retención, exportar Excel/PDF
10. **Configuración** — datos del gimnasio, sucursales, integraciones de pago (Stripe/Fintoc)
11. **Soporte** — interacciones internas del equipo

**Problemas UX actuales:**
- Sidebar abierto en móvil sin detección automática (P6 — ya listado)
- No hay checklist de onboarding para nuevos owners
- No hay guía de primeros pasos (crear sucursal → plan → cliente)

**Mejoras pendientes:**
- Checklist in-app: "Completa tu setup" (5 pasos)
- Tour guiado con Shepherd.js o equivalente
- Notificación de trial por vencer en email (7 días y 1 día antes)

---

### 4.2 Admin / Recepción / Entrenador / Marketing

Acceso al mismo layout que el owner, pero con permisos reducidos según rol. El AuthGuard valida el rol en cada ruta anidada. Las restricciones específicas por rol están en el backend (endpoints validan el rol del JWT).

---

### 4.3 Cliente (miembro del gimnasio) — PWA

**Entrada:** `/login` → `/member`  
**Instalación:** Banner "Agregar a inicio" en Android (BeforeInstallPromptEvent) — iOS requiere instrucción manual.

**Tabs de la PWA:**

| Tab | Contenido |
|-----|-----------|
| **Inicio** | Próximas reservas, estado de membresía, acceso rápido a QR |
| **Agenda** | Clases disponibles con filtro por fecha/modalidad, botón Reservar |
| **Planes** | Planes del gimnasio con precio, checkout directo |
| **Pagos** | Historial de pagos propios |
| **Bandeja** | Notificaciones del gimnasio (push + in-app) |
| **Perfil** | Datos personales, QR de check-in, configurar push, instalar PWA |

**Problemas UX actuales:**
- iOS safe-area insets faltantes en tab bar (P12 — ya listado)
- Iconos SVG pueden no mostrarse en Android antiguo al instalar (P7)
- Sin feedback visual de carga inicial (skeleton screens)
- El QR de check-in está en el tab "Perfil" — poco visible, debería estar también en "Inicio"

**Mejoras pendientes:**
- Agregar QR de acceso en la pantalla de Inicio
- Skeleton loaders durante la carga inicial de datos
- Mensaje de bienvenida personalizado ("Hola, Juan")
- Estado offline claro cuando no hay conexión (el SW ya maneja el caché)

---

### 4.4 Superadmin (plataforma)

**Entrada:** `/login` → `/platform/tenants`

| Sección | Función |
|---------|---------|
| Tenants | Ver todos los gimnasios, estado (trial/active/expired), activar/desactivar |
| Planes SaaS | CRUD de planes de suscripción (Básico, Pro, Enterprise) |
| Leads | Pipeline CRM de gimnasios interesados |

---

## 5. Plan de Despliegue en VPS (VULTR / OVHcloud)

### 5.1 Elección del servidor

#### VULTR (recomendado para Chile/LATAM)
- **Plan:** Cloud Compute — High Frequency, 2 vCPU / 4 GB RAM / 80 GB NVMe
- **Costo:** ~$24/mes
- **Región:** Miami (mejor latencia para Sudamérica) o Los Angeles
- **OS:** Ubuntu 22.04 LTS
- **Ventaja:** Panel simple, snapshots automáticos, red privada incluida

#### OVHcloud (alternativa económica)
- **Plan:** VPS Value o Essential — 2 vCPU / 4 GB RAM / 80 GB SSD
- **Costo:** ~$6–12/mes (precio de entrada agresivo)
- **Región:** BHS (Beauharnois, Canadá) o Miami
- **OS:** Ubuntu 22.04 LTS
- **Nota:** SLA menor, soporte más lento — conveniente para empezar

**Recomendación:** VULTR para estabilidad y soporte. OVHcloud si el presupuesto es el factor principal.

---

### 5.2 Arquitectura de producción

```
Internet
   │
   ▼
Cloudflare (DNS + proxy + SSL gratuito)
   │
   ▼ HTTPS (443)
VPS (VULTR/OVH)
├── Nginx (puerto 80 / 443)
│   ├── /api/* → backend:8000
│   └── /*     → /srv/nexo-fitness/frontend/dist (estáticos)
│
├── Docker Compose (perfil production)
│   ├── backend (FastAPI + uvicorn, sin --reload)
│   ├── db (PostgreSQL 15)
│   ├── redis (Redis 7)
│   ├── worker (Celery)
│   └── beat (Celery Beat)
│
└── Certbot (renovación automática de SSL si no se usa Cloudflare proxy)
```

---

### 5.3 Paso a paso — Primera vez

#### Paso 1: Provisionar el servidor

```bash
# En VULTR: Deploy Instance → High Frequency → Ubuntu 22.04
# En OVHcloud: Order VPS → Ubuntu 22.04
# Obtener IP pública: por ejemplo 185.x.x.x
```

#### Paso 2: Configuración inicial del servidor

```bash
# Conectar por SSH
ssh root@185.x.x.x

# Actualizar sistema
apt update && apt upgrade -y

# Crear usuario no-root
adduser nexo
usermod -aG sudo nexo
rsync --archive --chown=nexo:nexo ~/.ssh /home/nexo/

# Instalar Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker nexo

# Instalar Docker Compose plugin
apt install -y docker-compose-plugin

# Instalar Nginx + Certbot
apt install -y nginx certbot python3-certbot-nginx

# Instalar git
apt install -y git

# Configurar firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

#### Paso 3: Configurar DNS

En el panel de Cloudflare (o tu DNS provider):
```
A    app.nexofitness.com    →  185.x.x.x   (Proxied ✓)
A    api.nexofitness.com    →  185.x.x.x   (Proxied ✓)
CNAME www                  →  app.nexofitness.com
```

Si se usa Cloudflare como proxy, el SSL lo gestiona Cloudflare y no es necesario Certbot.  
Si se va directo (sin Cloudflare proxy), usar Certbot:
```bash
certbot --nginx -d app.nexofitness.com -d api.nexofitness.com
```

#### Paso 4: Clonar el repositorio

```bash
su - nexo
mkdir -p /srv/nexo-fitness
cd /srv/nexo-fitness
git clone https://github.com/tu-usuario/nexo-fitness.git .
```

#### Paso 5: Crear archivos de entorno de producción

```bash
# Backend
cp backend/.env.example backend/.env
nano backend/.env
# Rellenar TODOS los valores reales:
# - SECRET_KEY (generado: openssl rand -hex 32)
# - JWT_SECRET_KEY (generado: openssl rand -hex 32)
# - DATABASE_URL (postgres local o gestionado)
# - REDIS_URL
# - SENDGRID_API_KEY
# - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_SAAS_MONTHLY_PRICE_ID, STRIPE_SAAS_ANNUAL_PRICE_ID
# - MERCADOPAGO_ACCESS_TOKEN
# - FINTOC_SECRET_KEY, FINTOC_WEBHOOK_SECRET
# - WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY
# - FRONTEND_URL=https://app.nexofitness.com
# - CORS_ORIGINS=https://app.nexofitness.com
# - SUPERADMIN_EMAIL=admin@nexofitness.com
# - SUPERADMIN_PASSWORD=[contraseña segura]
# - APP_ENV=production
# - DEBUG=false
# - SENTRY_DSN=[opcional pero recomendado]

# Frontend
cp frontend/.env.example frontend/.env
nano frontend/.env
# VITE_API_URL=https://app.nexofitness.com/api/v1
# VITE_APP_NAME=Nexo Fitness
# VITE_PUBLIC_APP_URL=https://app.nexofitness.com
# VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
# VITE_SENTRY_DSN=[opcional]
```

#### Paso 6: Generar claves VAPID para Web Push

```bash
# Instalar web-push CLI (Node)
npm install -g web-push
web-push generate-vapid-keys
# Copiar las claves al backend/.env y frontend/.env
```

#### Paso 7: Build del frontend

```bash
cd /srv/nexo-fitness/frontend
npm ci
npm run build
# El output queda en frontend/dist/
```

#### Paso 8: Configurar Nginx para producción

Crear `/etc/nginx/sites-available/nexo-fitness`:
```nginx
server {
    listen 80;
    server_name app.nexofitness.com api.nexofitness.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.nexofitness.com;

    # SSL (Cloudflare origin cert o Certbot)
    ssl_certificate     /etc/nginx/ssl/nexo.crt;
    ssl_certificate_key /etc/nginx/ssl/nexo.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.stripe.com https://js.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com;" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Frontend estático
    root /srv/nexo-fitness/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
        # Cache para assets con hash en el nombre
        location ~* \.(js|css|png|jpg|svg|ico|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # API proxy
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location /api/v1/auth/ {
        limit_req zone=auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:8000;
    }

    # Stripe webhook — sin rate limit
    location /api/v1/payments/stripe/webhook {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Fintoc webhook
    location /api/v1/payments/fintoc/webhook {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Activar el site
ln -s /etc/nginx/sites-available/nexo-fitness /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

#### Paso 9: Levantar los servicios Docker

```bash
cd /srv/nexo-fitness

# Levantar solo los servicios de backend (BD, Redis, API, workers)
# NO levantar el servicio frontend (ya lo sirve Nginx directamente)
docker compose up -d db redis backend worker beat

# Esperar a que db esté healthy (~15s) y correr migraciones
docker compose run --rm backend alembic upgrade head

# Crear el superadmin
docker compose run --rm backend python -m app.seeds.superadmin
```

#### Paso 10: Configurar webhooks externos

En Stripe Dashboard:
```
Endpoint: https://app.nexofitness.com/api/v1/payments/stripe/webhook
Eventos: customer.subscription.*, invoice.payment_*
```

En MercadoPago Developer (si aplica):
```
Webhook URL: https://app.nexofitness.com/api/v1/payments/mp/webhook
```

En Fintoc Dashboard:
```
Webhook URL: https://app.nexofitness.com/api/v1/payments/fintoc/webhook
```

#### Paso 11: Configurar backups automáticos

```bash
# Script de backup diario de PostgreSQL
cat > /srv/nexo-fitness/scripts/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/srv/backups/postgres"
mkdir -p $BACKUP_DIR
docker exec nexo-fitness-db-1 pg_dump -U nexo nexo_fitness | gzip > $BACKUP_DIR/nexo_fitness_$DATE.sql.gz
# Mantener solo los últimos 7 días
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
EOF
chmod +x /srv/nexo-fitness/scripts/backup.sh

# Agregar al cron (diario a las 3am)
crontab -e
# Agregar: 0 3 * * * /srv/nexo-fitness/scripts/backup.sh >> /var/log/nexo-backup.log 2>&1
```

#### Paso 12: Configurar GitHub Actions secrets

En GitHub → Settings → Secrets → Actions:
```
PRODUCTION_HOST     = 185.x.x.x
PRODUCTION_USER     = nexo
PRODUCTION_SSH_KEY  = [contenido de ~/.ssh/id_ed25519 privada]
PRODUCTION_APP_DIR  = /srv/nexo-fitness
```

El deploy automático se activa con cada push a `main`.

---

### 5.4 `docker-compose.prod.yml` (crear este archivo)

```yaml
# docker-compose.prod.yml — solo servicios de backend para producción
# El frontend se sirve como estáticos via Nginx, no como contenedor
services:
  db:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: nexo_fitness
      POSTGRES_USER: nexo
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    # NO exponer puerto 5432 en producción
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nexo -d nexo_fitness"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    # NO exponer puerto 6379 en producción
    command: redis-server --save 60 1 --loglevel warning
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: ../docker/Dockerfile.backend
    restart: unless-stopped
    env_file:
      - ./backend/.env
    environment:
      DATABASE_URL: postgresql+asyncpg://nexo:${POSTGRES_PASSWORD}@db:5432/nexo_fitness
      REDIS_URL: redis://redis:6379/0
    ports:
      - "127.0.0.1:8000:8000"  # Solo localhost, Nginx hace el proxy
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2

  worker:
    build:
      context: ./backend
      dockerfile: ../docker/Dockerfile.backend
    restart: unless-stopped
    env_file:
      - ./backend/.env  # ← CRÍTICO: incluir env_file
    environment:
      DATABASE_URL: postgresql+asyncpg://nexo:${POSTGRES_PASSWORD}@db:5432/nexo_fitness
      REDIS_URL: redis://redis:6379/0
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: celery -A app.tasks worker --loglevel=info --concurrency=2

  beat:
    build:
      context: ./backend
      dockerfile: ../docker/Dockerfile.backend
    restart: unless-stopped
    env_file:
      - ./backend/.env  # ← CRÍTICO: incluir env_file
    environment:
      DATABASE_URL: postgresql+asyncpg://nexo:${POSTGRES_PASSWORD}@db:5432/nexo_fitness
      REDIS_URL: redis://redis:6379/0
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: celery -A app.tasks beat --loglevel=info

volumes:
  pgdata:
```

Levantar en producción:
```bash
docker compose -f docker-compose.prod.yml up -d
```

---

### 5.5 Script de deploy actualizado

Reemplazar el script en `.github/workflows/deploy.yml`:
```bash
set -e
cd ${{ secrets.PRODUCTION_APP_DIR }}

echo "=== Pulling latest code ==="
git pull origin main

echo "=== Building frontend ==="
cd frontend && npm ci && npm run build && cd ..

echo "=== Building backend image ==="
docker compose -f docker-compose.prod.yml build backend

echo "=== Running migrations ==="
docker compose -f docker-compose.prod.yml run --rm backend alembic upgrade head

echo "=== Restarting services ==="
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "=== Reload Nginx (nuevos estáticos) ==="
sudo systemctl reload nginx

echo "=== Health check ==="
sleep 5
curl -fsS http://127.0.0.1:8000/health | grep '"status":"healthy"' || exit 1

echo "=== Deploy complete ==="
```

---

## 6. Costos Mensuales Estimados

### Con VULTR

| Servicio | Plan | Costo |
|---------|------|-------|
| VULTR Cloud Compute HF 2vCPU/4GB | VPS único | ~$24/mes |
| Cloudflare (DNS + proxy + SSL) | Free | $0 |
| SendGrid (hasta 100 emails/día) | Free | $0 |
| Stripe (% por transacción) | 2.9% + $0.30 por pago | Variable |
| Sentry (hasta 5k errores/mes) | Free | $0 |
| UptimeRobot (hasta 50 monitores) | Free | $0 |
| **Total fijo** | | **~$24/mes** |

### Con OVHcloud

| Servicio | Plan | Costo |
|---------|------|-------|
| OVH VPS Essential 2vCPU/4GB | VPS único | ~$6/mes |
| Cloudflare | Free | $0 |
| Resto igual | — | $0 |
| **Total fijo** | | **~$6/mes** |

> Para escalar (>50 tenants activos): subir a 4vCPU/8GB (~$48/mes en VULTR) y migrar PostgreSQL a un managed service (Supabase/Railway).

---

## 7. Checklist de Prioridades

### Semana 1 — Fixes críticos (código)
- [x] **P1** — Dockerfile.frontend multi-stage para build de producción → `docker/Dockerfile.frontend`
- [x] **P2** — nginx.conf con bloque HTTPS completo → `nginx/nginx.conf` + `nginx/nginx-vps.conf` (nuevo)
- [x] **P3** — `env_file` en servicios Celery (worker + beat) → `docker-compose.yml`
- [x] **P4** — Service Worker scope limitado a `/member` → `pwa.ts` + `sw.js`
- [x] **P5** — Eliminar credenciales hardcodeadas de LoginPage → `LoginPage.tsx`
- [x] **P6** — Sidebar responsive (default cerrado en móvil) → `AppLayout.tsx`

> **Hallazgo P2:** Se crearon dos configs: `nginx/nginx.conf` (para Docker nginx service) y `nginx/nginx-vps.conf` (para nginx instalado en el host VPS). La arquitectura de producción usa el de host.
>
> **Hallazgo P4:** Al limitar el scope del SW a `/member`, también se actualizó `manifest.webmanifest` para que su scope sea `/member` — ambos son coherentes ahora.

### Semana 1 — Infraestructura
- [ ] Provisionar VPS (VULTR o OVH)
- [ ] Configurar DNS en Cloudflare
- [ ] Clonar repo y crear archivos `.env` de producción
- [ ] Generar VAPID keys (`npm install -g web-push && web-push generate-vapid-keys`)
- [ ] Build del frontend y levantar servicios con `docker-compose.prod.yml`
- [ ] Correr migraciones y seed del superadmin
- [ ] Configurar backups automáticos (cron + pg_dump)

### Semana 2 — Calidad
- [x] **P7** — Iconos PNG generados → `frontend/public/icons/icon-192.png` + `icon-512.png` (via `npm run generate:icons`)
- [x] **P8** — CI unificado con `needs: [backend-tests, frontend-lint]` antes del deploy → `.github/workflows/ci.yml`
- [x] **P9** — Quitado `--no-cache` del build en CI → `ci.yml`
- [x] **P10** — `docker-compose.prod.yml` creado
- [x] **P11** — `nginx/ssl/.gitkeep` + `.gitignore` para certificados → no se committean certs
- [x] **P12** — Safe-area insets: `viewport-fit=cover` en `index.html` + `paddingBottom` con `env(safe-area-inset-bottom)` en `MemberAppPage.tsx`
- [ ] Configurar webhooks en Stripe, MercadoPago, Fintoc
- [ ] Activar Sentry en producción (backend + frontend)
- [ ] Configurar UptimeRobot para `/health`

> **Hallazgo P7:** Se descubrió que `apple-touch-icon` en `index.html` referenciaba un SVG (iOS no lo soporta). Corregido a PNG.
>
> **Hallazgo P8/P9:** Los archivos `test.yml` y `deploy.yml` se fusionaron en un solo `ci.yml` porque `needs:` en GitHub Actions solo referencia jobs del mismo workflow. Los archivos anteriores fueron eliminados.
>
> **Hallazgo P12:** El tab bar ya tenía `env(safe-area-inset-bottom)` — lo que faltaba era `viewport-fit=cover` en el meta viewport y el `paddingBottom` del contenido principal.

### Semana 3 — UX y Onboarding
- [x] **Checklist in-app** de primeros pasos (owner) → `OnboardingChecklist.tsx` en dashboard, 4 pasos con verificación real via API, auto-dismiss al completar, descartable
- [x] **QR de check-in** en tab Inicio — ya estaba implementado (`MemberPassCard` con QR 148px)
- [x] **Skeleton loaders** en PWA → componentes `Skeleton`, `SkeletonMetricCards`, `SkeletonPassCard`, `SkeletonListItems` en `MemberAppPage.tsx`
- [x] **Email de bienvenida** al registrarse → `auth_service.register_tenant` llama `email_service.send_welcome()` (no bloqueante)
- [x] **Email de aviso trial** por vencer → `backend/app/tasks/trial_warnings.py` (Celery Beat, diario, ventanas 7d y 1d)
- [x] **P13** — Carpeta `mobile/` Expo eliminada del repositorio

### Semana 3–4 — Legal y Seguridad
- [x] **Términos y Condiciones** → `/terms` (`frontend/src/pages/legal/TermsPage.tsx`)
- [x] **Política de Privacidad** → `/privacy` (`frontend/src/pages/legal/PrivacyPage.tsx`)
- [x] Links legales en `RegisterPage` ("Al registrarte, aceptas...")
- [ ] Revisar `DEBUG=false`, `SECRET_KEY` no por defecto, CORS solo dominios propios (para hacer antes del primer deploy)
- [x] Headers CSP en Nginx (ya incluido en `nginx-vps.conf`)

> **Hallazgo Skeleton loaders:** Los skeletons solo se muestran cuando `isLoading && !data`, es decir, solo en la carga inicial sin caché. Si el usuario tiene snapshot en localStorage (primer login reciente), los datos aparecen instantáneamente.
>
> **Hallazgo Email trial:** La tarea usa ventanas de tolerancia de ±6 horas alrededor del día objetivo para evitar que el cron diario pierda el aviso por diferencias de timing.
>
> **Hallazgo páginas legales:** El contenido es una plantilla base que debe revisarse por un abogado antes del lanzamiento comercial, especialmente las secciones de ley aplicable y retención de datos.

---

## 8. Decisiones Pendientes

| Pregunta | Opciones | Impacto |
|----------|----------|---------|
| Servidor VPS | VULTR (más estable, ~$24) vs OVH (más barato, ~$6) | Costo + SLA |
| SSL | Cloudflare proxy (más simple) vs Certbot directo (más control) | Tiempo de setup |
| Base de datos | Self-hosted en el VPS vs Supabase/Railway managed | Costo vs simplicidad |
| Redis | Self-hosted (docker) vs Upstash (managed free) | Confiabilidad |
| Email | SendGrid (ya integrado) vs Resend (más moderno, free tier generoso) | Horas de migración |
| Dominio | ¿nexofitness.com ya registrado? | Bloquea DNS setup |

---

*Documento generado el 8 de abril de 2026 — auditoría completa del repositorio.*
