# 🏋️ Nexo Fitness — SaaS Multitenant para Gimnasios

![Nexo Fitness](https://img.shields.io/badge/Nexo_Fitness-v1.0.0-06b6d4?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python)
![React](https://img.shields.io/badge/React-18+-61DAFB?style=for-the-badge&logo=react)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=for-the-badge&logo=postgresql)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=for-the-badge&logo=fastapi)

**Nexo Fitness** es una plataforma SaaS multitenant para la administración integral de gimnasios. Permite a múltiples gimnasios operar de forma independiente y segura desde una misma instancia, gestionando clases, reservas, planes, pagos, clientes, check-in, marketing y reportes.

---

## 📋 Tabla de Contenidos

- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalación Rápida](#instalación-rápida)
- [Variables de Entorno](#variables-de-entorno)
- [Ejecución Local](#ejecución-local)
- [Migraciones](#migraciones)
- [Seeds](#seeds)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Módulos](#módulos)
- [Despliegue](#despliegue)
- [Seguridad](#seguridad)
- [API Docs](#api-docs)

---

## 🏗 Arquitectura

### Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + Framer Motion |
| Backend | FastAPI + Python 3.11/3.12 + SQLAlchemy 2.0 + Alembic |
| Base de Datos | PostgreSQL 15+ |
| Cache | Redis |
| Cola de Tareas | Celery + Redis |
| Reverse Proxy | Nginx |
| Contenedores | Docker + Docker Compose |
| Correo | SendGrid / Resend |
| Pagos | Stripe (principal) + MercadoPago (LATAM) |

### Estrategia Multitenant

**Shared Database + Shared Schema + tenant_id**

Cada tabla de negocio incluye una columna `tenant_id` que referencia al gimnasio. Toda query se filtra automáticamente por tenant usando middleware de SQLAlchemy. El aislamiento se garantiza a nivel:

- **Middleware de autenticación**: Extrae el tenant del JWT
- **Query filters automáticos**: SQLAlchemy events + session scope
- **Row-level security**: Policies de PostgreSQL como capa adicional
- **Validación en servicio**: Cada operación verifica tenant ownership

### Decisión justificada

Se eligió shared schema porque:
- Menor costo operativo (una sola DB)
- Migraciones unificadas
- Queries cross-tenant para superadmin
- Escalable a cientos de tenants sin overhead
- Row-level security de PostgreSQL como segunda barrera

---

## 📦 Requisitos

- Docker 24+ y Docker Compose 2.20+
- Node.js 20+ y npm 10+ (para desarrollo frontend)
- Python 3.11 o 3.12 (recomendado para desarrollo backend)
- PostgreSQL 15+ (si se ejecuta sin Docker)
- Redis 7+ (si se ejecuta sin Docker)

---

## 🚀 Instalación Rápida

```bash
# Clonar repositorio
git clone https://github.com/nexo-fitness/nexo-fitness.git
cd nexo-fitness

# Ejecutar desde la raiz del proyecto y con Docker Desktop/daemon encendido
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Levantar todo con Docker Compose
docker compose up -d

# Ejecutar migraciones
docker compose exec backend alembic upgrade head

# Cargar seeds de demostración
docker compose exec backend python -m seeds.run

# La aplicación estará disponible en:
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

Si ya estabas dentro de `backend/`, vuelve primero a la raiz:

```bash
cd ..
```

---

## 🔐 Variables de Entorno

### Backend (`backend/.env`)

```env
# App
APP_NAME=NexoFitness
APP_ENV=development
SECRET_KEY=your-super-secret-key-change-in-production
DEBUG=true

# Database
DATABASE_URL=postgresql+asyncpg://nexo:nexo_password@db:5432/nexo_fitness
DATABASE_POOL_SIZE=20
DATABASE_MAX_OVERFLOW=10

# Redis
REDIS_URL=redis://redis:6379/0

# JWT
JWT_SECRET_KEY=your-jwt-secret-key
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Email
SENDGRID_API_KEY=your-sendgrid-key
EMAIL_FROM=noreply@nexofitness.com

# Payments
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
MERCADOPAGO_ACCESS_TOKEN=TEST-...

# Storage
AWS_S3_BUCKET=nexo-fitness-uploads
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1

# Rate Limiting
RATE_LIMIT_PER_MINUTE=60
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:8000/api/v1
VITE_APP_NAME=Nexo Fitness
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

---

## 🛠 Ejecución Local (sin Docker)

### Backend

```bash
cd backend
python -m venv venv
# Linux / Mac
source venv/bin/activate

# Windows PowerShell
venv\Scripts\Activate.ps1

# Windows Git Bash
source venv/Scripts/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Nota para Windows:
Si `python --version` muestra `3.13.x`, recrea el entorno con Python 3.11 o 3.12 usando el ejecutable deseado, por ejemplo:

```bash
"/c/Users/TU_USUARIO/AppData/Local/Programs/Python/Python311/python.exe" -m venv venv
source venv/Scripts/activate
python --version
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## 🗃 Migraciones

```bash
# Crear nueva migración
cd backend
alembic revision --autogenerate -m "descripcion_del_cambio"

# Aplicar migraciones
alembic upgrade head

# Revertir última migración
alembic downgrade -1
```

---

## 🌱 Seeds

```bash
# Cargar todos los seeds (crea tenants demo, usuarios, planes, clases, etc.)
python -m seeds.run

# Seeds específicos
python -m seeds.run --only tenants
python -m seeds.run --only users
python -m seeds.run --only plans
python -m seeds.run --only classes
```

---

## 📁 Estructura del Proyecto

```
nexo-fitness/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/    # Routers por módulo
│   │   ├── core/                # Config, seguridad, dependencias
│   │   ├── models/              # SQLAlchemy models
│   │   ├── schemas/             # Pydantic schemas
│   │   ├── services/            # Lógica de negocio
│   │   ├── repositories/        # Acceso a datos
│   │   ├── middleware/          # Tenant, auth, logging
│   │   ├── utils/               # Utilidades
│   │   ├── integrations/        # Pagos, email, WhatsApp
│   │   └── tasks/               # Celery background jobs
│   ├── migrations/              # Alembic
│   ├── seeds/                   # Datos de demostración
│   └── tests/                   # Tests
├── frontend/
│   ├── src/
│   │   ├── components/          # Componentes React
│   │   ├── pages/               # Páginas por módulo
│   │   ├── hooks/               # Custom hooks
│   │   ├── services/            # API clients
│   │   ├── stores/              # Estado global (Zustand)
│   │   ├── types/               # TypeScript types
│   │   ├── utils/               # Utilidades
│   │   └── styles/              # Estilos globales
│   └── public/                  # Assets estáticos
├── docker/                      # Dockerfiles
├── nginx/                       # Configuración Nginx
├── docker-compose.yml
└── README.md
```

---

## 📦 Módulos

| Módulo | Descripción |
|--------|-------------|
| Dashboard | Métricas, KPIs, gráficos, alertas operativas |
| Clases & Reservas | Gestión completa de clases físicas/online/híbridas |
| Planes | Planes de membresía con reglas de acceso |
| Programas | Programas de entrenamiento y horarios |
| Clientes | CRM de clientes con historial completo |
| Check-in | Control de asistencia y acceso |
| Pagos | Stripe + MercadoPago, suscripciones, webhooks |
| Marketing | Campañas, segmentación, email, WhatsApp |
| Reportes | Analítica completa exportable |
| Soporte | Canales de atención centralizados |
| Configuración | Settings del tenant, sedes, branding |

---

## 🌐 Despliegue

### Producción Recomendada

```
                    ┌──────────────┐
                    │   Cloudflare  │
                    │   (CDN + SSL) │
                    └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    │    Nginx     │
                    │ (Rev. Proxy) │
                    └──────┬───────┘
                    ┌──────┴───────┐
              ┌─────┤   Docker     ├─────┐
              │     │  Compose     │     │
              │     └──────────────┘     │
        ┌─────┴─────┐  ┌──────┐  ┌──────┴─────┐
        │  FastAPI   │  │Redis │  │ PostgreSQL │
        │  (Uvicorn) │  │      │  │            │
        └───────────┘  └──────┘  └────────────┘
```

**Proveedor recomendado**: Hetzner Cloud o DigitalOcean  
**VPS mínimo**: 4 vCPU, 8GB RAM, 80GB SSD  
**Costo estimado**: ~$20-40 USD/mes

---

## 🔒 Seguridad

- Bcrypt para hash de contraseñas
- JWT con access + refresh tokens
- CORS configurado por entorno
- Rate limiting por IP y endpoint
- Validación de inputs con Pydantic
- Filtro automático por tenant_id en todas las queries
- Row-Level Security en PostgreSQL
- Sanitización de outputs
- Headers de seguridad (Helmet equivalente)
- Protección CSRF para formularios
- Diseño basado en OWASP Top 10

---

## 📖 API Docs

Con el backend corriendo, accede a:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

---

## 📄 Licencia

Copyright © 2025 Nexo Fitness. Todos los derechos reservados.
