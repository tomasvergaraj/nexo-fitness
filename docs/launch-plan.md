# Nexo Fitness — Plan de Lanzamiento

> Estado al 7 de abril de 2026

---

## Resumen Ejecutivo

Nexo Fitness es una plataforma SaaS B2B multitenant para la gestión de gimnasios. El núcleo de negocio está completo y funcional. Los gaps principales son operacionales: CI/CD, monitoreo, testing ampliado y preparación legal/comercial.

**Tiempo estimado al primer cliente pagador: 3–5 semanas.**

---

## Estado Actual

### Lo que ya funciona

| Módulo | Estado |
|--------|--------|
| Arquitectura multitenant (row-level isolation) | Completo |
| Autenticación y roles (RBAC, 7 roles) | Completo |
| Gestión de clases (presencial, online, híbrido) | Completo |
| Reservas de clases y lista de espera | Completo |
| Control de asistencia (check-in) | Completo |
| Planes y membresías | Completo |
| Pagos Stripe + MercadoPago | Completo |
| Dashboard de KPIs | Completo |
| Campañas de email/push con scheduler | Completo |
| Notificaciones push (Expo + Web Push VAPID) | Completo |
| PWA para miembros (instalable, offline-ready) | Completo |
| Tienda pública del gimnasio (checkout) | Completo |
| Gestión de sucursales | Completo |
| Reportes y exportación | Completo |
| Panel superadmin (tenants, planes SaaS) | Completo |
| Sistema de soporte interno | Completo |
| Docker Compose + Nginx (configuración prod) | Completo |
| Seeds de demostración | Completo |
| Migraciones Alembic (7 versiones) | Completo |

---

## Tareas Pendientes

Las tareas están clasificadas por prioridad. **Bloquean el lanzamiento** las marcadas con 🔴. Las demás son importantes pero no bloquean.

---

### FASE 1 — Infraestructura Crítica (Semana 1–2)

#### 🔴 1.1 Deployment en producción

- [ ] Provisionar servidor (Hetzner CX32 o DO Droplet: 4vCPU / 8GB / 80GB SSD, ~$20–24/mes)
- [ ] Configurar dominio y DNS (app.nexofitness.com, api.nexofitness.com)
- [ ] Configurar SSL con Cloudflare (proxy + certificado)
- [ ] Dockerizar en producción con `docker compose --profile production`
- [ ] Configurar PostgreSQL gestionado (Supabase, Railway, o Neon — tier gratuito viable para inicio)
- [ ] Configurar Redis gestionado (Upstash free tier o co-ubicado)
- [ ] Validar variables de entorno de producción (`.env.production`)
- [ ] Correr migraciones en BD de producción (`alembic upgrade head`)
- [ ] Correr seed del superadmin en producción

#### 🔴 1.2 Claves y servicios externos en producción

- [ ] Activar cuenta Stripe en modo live + configurar webhook (`/api/v1/payments/stripe/webhook`)
- [ ] Activar cuenta MercadoPago en modo producción + configurar webhook
- [ ] Configurar SendGrid (o Resend) con dominio verificado para emails transaccionales
- [ ] Generar claves VAPID para Web Push de producción
- [ ] Configurar `STRIPE_PRICE_ID_MONTHLY` y `STRIPE_PRICE_ID_ANNUAL` con precios reales

#### 🔴 1.3 Backup y recuperación

- [ ] Activar backups automáticos diarios en PostgreSQL (snapshot del proveedor o `pg_dump` via cron)
- [ ] Documentar procedimiento de restauración
- [ ] Probar restauración al menos una vez antes de tener clientes

---

### FASE 2 — Calidad y Seguridad (Semana 1–2)

#### 🔴 2.1 Flujos críticos validados end-to-end

- [ ] Flujo completo: registro de gimnasio → onboarding → primer pago SaaS (Stripe)
- [ ] Flujo completo: creación de miembro → asignación de membresía → pago → check-in
- [ ] Flujo completo: miembro instala PWA → reserva clase → recibe notificación push
- [ ] Flujo de recuperación de contraseña (si existe; agregar si no)
- [ ] Webhook Stripe: suscripción activa, pago fallido, cancelación
- [ ] Checkout público del gimnasio (storefront → pago MercadoPago/Stripe)

#### 2.2 Error tracking

- [x] Integrar **Sentry** en backend (`sentry-sdk[fastapi]`) y frontend (`@sentry/react`)
- [ ] Configurar alertas para errores 5xx y transacciones lentas (requiere cuenta Sentry)
- [x] Agregar `SENTRY_DSN` a variables de entorno

#### 2.3 Logging estructurado

- [x] Reemplazar `print()` del backend por `structlog`
- [x] Logs JSON a stdout (Docker los captura automáticamente)
- [ ] Opcional: enviar logs a Logtail / BetterStack (plan free disponible)

#### 2.4 Revisión de seguridad básica

- [ ] Verificar que `DEBUG=false` en producción
- [ ] Verificar que `SECRET_KEY` no es el valor por defecto del ejemplo
- [ ] Revisar CORS: solo permitir dominios propios en producción
- [ ] Confirmar que endpoints de superadmin requieren rol `superadmin`
- [ ] Rate limiting activo en Nginx (ya configurado — validar que esté habilitado)
- [ ] Headers de seguridad en Nginx (ya configurados — validar con [securityheaders.com](https://securityheaders.com))

---

### FASE 3 — CI/CD y Automatización (Semana 2–3)

#### 3.1 GitHub Actions

- [x] Pipeline `test.yml`: correr `pytest` en cada PR
- [x] Pipeline `deploy.yml`: deploy automático a producción en push a `main`
- [ ] Secrets en GitHub: `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_SSH_KEY`, `PRODUCTION_APP_DIR`
- [ ] Badge de estado del pipeline en README

#### 3.2 Entorno de staging

- [ ] Configurar subdominio staging (staging.nexofitness.com)
- [ ] Staging con datos de seed — nunca con datos reales
- [ ] Todos los cambios pasan por staging antes de producción

---

### FASE 4 — Onboarding y UX (Semana 2–3)

#### 🔴 4.1 Flujo de registro de gimnasio

- [ ] Revisar y probar la página `/register` end-to-end con Stripe
- [ ] Email de bienvenida automático al registrarse (template en SendGrid)
- [ ] Email de aviso cuando el trial está por vencer (7 días y 1 día antes)
- [ ] Página de trial expirado con CTA de upgrade

#### 4.2 Guía de inicio rápido para admins

- [ ] Checklist in-app de primeros pasos (crear sucursal → agregar plan → agregar miembro)
- [ ] Video de 3 minutos o tour guiado (Intercom / Userflow / Shepherd.js)
- [ ] FAQ básica en pantalla de settings

#### 4.3 Página de pricing pública

- [x] Sección de pricing integrada en `/site` con toggle mensual/anual y CTA de prueba gratuita
- [x] Conectar con `/api/v1/billing/public/plans`

---

### FASE 5 — Legal y Comercial (Semana 2–3)

#### 🔴 5.1 Documentos legales

- [ ] **Términos y Condiciones** de uso del servicio
- [ ] **Política de Privacidad** (GDPR / LGPD / ley local según mercado objetivo)
- [ ] **Política de cookies** si aplica
- [ ] Enlace visible en footer de landing y en registro
- [ ] Aceptación explícita en el flujo de registro (checkbox)

#### 5.2 Facturación y compliance

- [ ] Definir persona jurídica para cobrar (factura electrónica, país de incorporación)
- [ ] Stripe Tax o equivalente si corresponde
- [ ] Política de reembolsos documentada y visible

#### 5.3 Dominio y marca

- [ ] Registrar dominio principal
- [ ] Logo final y favicon en la app
- [ ] Open Graph tags en landing (preview en WhatsApp/redes)

---

### FASE 6 — Testing Ampliado (Semana 3)

> El proyecto tiene 5 archivos de tests. Antes de escalar, cubrir:

- [ ] Tests de integración para endpoints de auth (login, refresh, expiración)
- [ ] Tests para flujo de membresía (crear → pagar → expirar → renovar)
- [ ] Tests para webhook de Stripe (pago ok, pago fallido, cancelación)
- [ ] Tests de aislamiento multitenant (un tenant no puede ver datos de otro)
- [ ] Test de carga básico: simular 50 usuarios concurrentes reservando clases (locust o k6)

---

### FASE 7 — Monitoreo de Producción (Semana 3–4)

- [ ] **Uptime monitoring**: UptimeRobot o Better Uptime (gratuito, alerta en < 2 min)
- [x] **Health check endpoint** en backend: `GET /health` con estado de BD y Redis
- [ ] **Alertas de error**: Sentry notifica a Slack/email en errores críticos
- [ ] **Dashboard de métricas**: Opcional — Grafana + Prometheus, o usar métricas del proveedor
- [ ] Revisar métricas de uso semanalmente (sesiones, conversiones, errores)

---

### FASE 8 — Funcionalidades Incompletas (Post-launch inmediato)

Estas no bloquean el lanzamiento pero deben completarse en el primer mes:

| Feature | Estado | Prioridad |
|---------|--------|-----------|
| Recuperación de contraseña | ✅ Implementado | ~~Alta~~ |
| Flujo de reembolso parcial | No implementado | Alta |
| Upgrade/downgrade de plan con prorrateo | No implementado | Media |
| Exportación de datos de miembro (GDPR) | No implementado | Media |
| WhatsApp (envío real de mensajes) | Infraestructura lista, envío no | Media |
| SMS (Twilio/Vonage) | No implementado | Baja |
| Notificaciones push con imagen/media | No implementado | Baja |
| Soporte i18n (inglés completo) | Parcial | Baja |

---

### FASE 9 — Roadmap Comercial (Mes 2–3)

Una vez con los primeros clientes:

- [ ] **Métricas de negocio**: MRR, churn, CAC, LTV (dashboard de superadmin)
- [ ] **Programa de referidos**: descuento por gym referido
- [ ] **Integraciones**: Zapier, Google Calendar, Zoom para clases online
- [ ] **PWA staff**: QR check-in para recepcionistas desde el navegador móvil
- [ ] **PWA mejoras avanzadas**: checkout offline, sincronización en background
- [ ] **Segmentación avanzada**: campañas por comportamiento (última visita, plan activo, etc.)
- [ ] **Reportes avanzados**: retención por cohorte, NPS, curvas de ocupación
- [ ] **Dominio personalizado por tenant**: `app.migimnasio.com`
- [ ] **Marketplace de integraciones**: webhooks salientes, API pública para partners

---

## Prioridad de Implementación

```
Semana 1   → Infraestructura producción + servicios externos + backup
Semana 2   → Validación E2E + seguridad + legal
Semana 3   → CI/CD + onboarding + testing crítico
Semana 4   → Monitoreo + ajustes post-primer-cliente
Mes 2+     → Features adicionales + escala
```

---

## Costo Mensual Estimado (primer cliente)

| Servicio | Costo |
|---------|-------|
| VPS (Hetzner CX32) | ~$20/mes |
| PostgreSQL (Railway Hobby) | ~$5/mes |
| Redis (Upstash free) | $0 |
| Cloudflare (free) | $0 |
| SendGrid (free hasta 100/día) | $0 |
| Sentry (free tier) | $0 |
| UptimeRobot (free) | $0 |
| **Total** | **~$25/mes** |

---

## Preguntas Abiertas

Estas decisiones están pendientes y afectan el roadmap:

1. **Mercado objetivo**: ¿LATAM solamente o también España? Afecta: idioma, procesador de pagos, legal.
2. **Precio del SaaS**: ¿Cuánto cuesta Nexo Fitness por mes a un gimnasio?
3. **Trial**: ¿Cuántos días? (actualmente configurable via `TRIAL_DAYS`)
4. **Canal de ventas**: ¿Self-service (registro directo) o ventas asistidas?
5. **Soporte**: ¿Email, WhatsApp, o chat en vivo (Intercom/Crisp)?
6. **PWA**: ¿Agregar banner de instalación guiada en iOS/Android? ¿Publicar wrapper en stores vía PWABuilder?

---

## Criterios de "Listo para Vender"

La plataforma está lista para el primer cliente pagador cuando:

- [x] Flujo de clases, reservas y check-in funciona
- [x] Pagos de membresías (Stripe + MercadoPago) funcionan
- [x] PWA del miembro es instalable y funcional
- [ ] Deployment en producción estable
- [ ] Backup automático activo
- [ ] Sentry integrado (saber si algo falla)
- [ ] Uptime monitoring activo
- [ ] Términos y Condiciones y Privacidad publicados
- [ ] Flujo de registro end-to-end probado
- [ ] Al menos un gimnasio en staging probado completamente

---

*Documento generado el 7 de abril de 2026 a partir de auditoría completa del repositorio.*
