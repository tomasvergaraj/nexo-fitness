# Progreso PWA Miembros

Fecha: 2026-03-24

## Objetivo

Reemplazar la app movil de miembros basada en Expo por una PWA instalable dentro de `frontend`, reutilizando el backend actual y reduciendo dependencias nativas de Android.

## Estado actual

La primera version util de la app de miembros ya corre dentro del frontend web. Los usuarios `client` pueden iniciar sesion, llegar a `/member`, instalar la app, revisar su membresia, ver clases, reservar o cancelar, revisar pagos, abrir checkout y leer su bandeja de notificaciones.

## Listo

- El login y los redirects de clientes ahora llevan a `/member`.
- La base PWA ya existe con manifest, service worker, iconos e instalacion.
- Ya estan activas las tabs de inicio, agenda, planes, pagos y notificaciones.
- La vista previa de notificaciones web locales funciona desde la app instalada.
- El checkout reutiliza el flujo publico del storefront y el backend actual.
- La vista home ahora tiene un pase digital mas claro y mas movil.
- La credencial de check-in ya no se desfasa con payloads largos.
- Se agregaron accesos rapidos para agenda, planes, pagos y bandeja.
- El panel de estado del dispositivo muestra instalacion, permisos, checkout y estado del check-in.
- La navegacion inferior ahora muestra contador de no leidas.
- La agenda ahora expone ocupacion visual por clase.
- Se agrego padding safe-area para uso movil instalado.
- La app ahora guarda snapshots locales por usuario para mostrar la ultima informacion aun sin red.
- La home indica estado online/offline y fecha relativa de la ultima sincronizacion.
- El service worker ahora cachea shell y recursos publicos sin guardar respuestas privadas autenticadas.
- La PWA ya tiene soporte del lado cliente para el evento `push` del service worker.
- El backend ya acepta subscriptions `expo` y `webpush` en la misma API de push subscriptions.
- La PWA ya puede registrar la subscription del navegador cuando existe VAPID publico y el usuario concede permiso.
- El backend ya expone config publica de Web Push para la app de miembros.

## En curso

- Migracion de push remota desde Expo tokens a Web Push.
- Evolucion de la credencial actual hacia un flujo mas visual y compatible con escaneo.
- Reduccion del bundle principal despues de integrar esta primera app de miembros.
- Configurar VAPID real en el entorno y desplegar `pywebpush` en el backend runtime.

## Siguientes hitos

1. Agregar endpoints y persistencia backend para subscriptions Web Push.
2. Conectar el envio remoto de notificaciones y campanas hacia la PWA.
3. Mejorar la credencial con QR renderizado o un fallback realmente compatible con el scanner.
4. Agregar reglas de cache offline para home e inbox del miembro.
5. Sumar una vista liviana de perfil y ajustes de cuenta.

## Notas

- `mobile/` sigue existiendo, pero deberia tratarse como temporal mientras la PWA pasa a ser la app principal de miembros.
- La PWA actual ya elimina buena parte de la friccion de Expo Go y builds Android para los flujos normales del miembro.
- Conviene evitar nuevo trabajo nativo salvo que una feature futura lo haga realmente necesario.
