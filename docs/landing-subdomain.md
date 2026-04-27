# Mapa de dominios públicos

## Dominios activos

- `https://nexofitness.cl` → landing principal de ventas
- `https://www.nexofitness.cl` → redirect canónico a `https://nexofitness.cl`
- `https://app.nexofitness.cl` → plataforma de owners, staff y clientes
- `https://admin.nexofitness.cl` → acceso superadmin
- `https://landing.nexofitness.cl` → redirect legacy a `https://nexofitness.cl`

## Estructura servida

- Landing estática: `landing/`
- SPA de plataforma: `frontend/dist`
- Configuración versionada principal: `nginx/nexofitness.host.conf`
- Redirect legacy: `nginx/landing.nexofitness.host.conf`

## Integraciones relevantes

- Landing:
  - lee pricing desde `GET /api/v1/billing/public/plans`
  - envía formularios a `POST /api/v1/public/leads`
  - CTA de acceso y registro apuntan a `https://app.nexofitness.cl`
- Backend:
  - `FRONTEND_URL` y `PUBLIC_APP_URL` deben apuntar a `https://app.nexofitness.cl`
  - CORS debe contemplar apex, `www`, `app` y `admin`

## DNS esperado

En Cloudflare o el proveedor DNS:

- Tipo: `A`
- Nombre: `@`
- Valor: IP pública del VPS
- Proxy: activado si se usará el wildcard/origin cert actual

Repetir con:

- `www`
- `app`
- `admin`
- `landing` si se quiere mantener el redirect legacy

## Instalación en host

1. Copiar `nginx/nexofitness.host.conf` a `/etc/nginx/sites-available/nexofitness`
2. Copiar `nginx/landing.nexofitness.host.conf` a `/etc/nginx/sites-available/landing.nexofitness`
3. Ejecutar `nginx -t`
4. Recargar `nginx`

## Nota operativa

`app.nexofitness.cl` y `admin.nexofitness.cl` no comparten sesión automáticamente porque el frontend persiste auth por origen. El login correcto debe hacerse en el host correspondiente.
