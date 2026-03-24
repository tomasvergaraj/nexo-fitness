# Avances mobile - 2026-03-23

## Objetivo de esta iteracion
Dejar una base Expo mas real para la Fase 3 del roadmap: una app central multitenant para clientes, conectada a la misma API FastAPI y alineada con el storefront publico por gimnasio.

## Lo implementado
- Se modularizo `mobile/` en `screens/` y `ui/` para dejar `App.tsx` como shell de tabs y evitar que la app siga creciendo sobre una sola pantalla.
- Se agrego una capa de cliente API propia en `mobile/src/lib/api.ts`.
- Se agregaron tipos mobile/public/auth en `mobile/src/types.ts`.
- Se creo `useMobileApp` en `mobile/src/hooks/useMobileApp.ts` para concentrar estado y flujos.
- Se evoluciono la UI Expo para soportar:
  - carga de tenant publico por `slug`
  - lectura de branding, clases y planes del storefront
  - login de cliente sobre `POST /api/v1/auth/login`
  - sincronizacion de wallet sobre `GET /api/v1/mobile/wallet`
  - agenda autenticada de clases sobre `GET /api/v1/classes`
  - listado de reservas del miembro sobre `GET /api/v1/reservations`
  - reserva y cancelacion de clases sobre `POST /api/v1/reservations` y `DELETE /api/v1/reservations/{id}`
  - historial de pagos del miembro sobre `GET /api/v1/mobile/payments`
  - generacion de checkout session por plan sobre `POST /api/v1/public/tenants/{slug}/checkout-session`
  - registro manual de push token sobre `POST /api/v1/mobile/push-subscriptions`
- Se preparo el scheme `nexofitness` en `mobile/app.json` para comenzar a resolver deep links de checkout/app.
- Se conecto el manejo de deep links entrantes `nexofitness://checkout/success` y `nexofitness://checkout/cancel` para resincronizar wallet, reservas y pagos cuando la app vuelve desde checkout con sesion en memoria.
- Se agrego persistencia local segura de `API base URL`, `tenant slug` y snapshot de sesion usando `expo-secure-store`, con restauracion automatica al abrir la app y fallback web a `localStorage`.
- Se integraron `expo-notifications`, `expo-device` y `expo-constants` para pedir permisos, disparar notificaciones locales de prueba y obtener el Expo push token real cuando el entorno lo permite.
- Se separo la UI mobile en tabs `Inicio`, `Agenda`, `Checkout`, `Pagos` y `Cuenta` para aislar setup, uso diario y flujos comerciales.
- Se agregaron filtros client-side por sede y modalidad dentro de Agenda, y el detalle de clase paso a una pantalla dedicada con acciones de reserva/cancelacion y apertura de link online.
- Se monto un stack interno liviano para mobile con rutas dedicadas de `detalle de clase` y `perfil`, mas parsing app-level de deep links como `nexofitness://agenda/class/{id}` y `nexofitness://account/profile`.
- Se conecto el contrato de notificaciones con `action_url` para que mobile pueda abrir rutas internas tanto desde el listado `GET /api/v1/notifications` como desde payloads de push/local notifications.
- Se agrego en Perfil una bandeja liviana de notificaciones con carga, marcado leido/no leido y apertura del destino asociado.
- Se corrigio `mobile/app.json` con `android.package` e `ios.bundleIdentifier` para destrabar la apertura nativa del proyecto Expo.
- Se agrego el script `npm run typecheck` en `mobile/package.json`.
- Se agrego en backend el listado `GET /api/v1/reservations` y se corrigio la validacion de permisos para que un cliente no pueda reservar a nombre de otro usuario.
- Se agrego en backend `GET /api/v1/mobile/payments` para exponer historial de pagos sin reutilizar el endpoint de staff.
- Se completo en backend el wiring de `POST /api/v1/public/tenants/{slug}/checkout-session` para propagar `success_url` y `cancel_url` al checkout remoto y dejar defaults web hacia `/store/{slug}`.
- Se actualizo el storefront web para generar checkout con return URLs reales y mostrar feedback cuando vuelve desde checkout.
- Se amplio `GET /api/v1/mobile/wallet` con `membership_id`, `plan_id` y `auto_renew` para que mobile pueda disparar renovacion sobre el plan actual.
- Se agrego en mobile un CTA de renovacion desde wallet y apertura de comprobantes cuando `receipt_url` existe en el historial de pagos.
- Se actualizo la seccion de push en mobile para registrar el token real del dispositivo y dejar el ingreso manual solo como fallback.
- Se conecto mobile con `POST /api/v1/mobile/push-preview` para disparar una push remota real via backend/Expo y reutilizar el mismo `action_url` que usa el timeline de notificaciones.
- Se agrego lectura de `GET /api/v1/mobile/push-subscriptions` dentro de mobile para mostrar subscriptions registradas, activas/inactivas y detectar rapido si el usuario realmente quedo listo para push remota.
- Se agregaron pruebas backend para `push_notification_service`, cubriendo token invalido, desactivacion por `DeviceNotRegistered` y errores de transporte contra Expo.
- Se agrego en `frontend/src/pages/clients/ClientsPage.tsx` un composer staff-facing por cliente para crear notificaciones reales sobre `POST /api/v1/notifications`, con opcion de envio push, presets de `action_url` y feedback de deliveries/tickets devueltos por Expo.
- Se agrego en backend `POST /api/v1/notifications/broadcast` para crear notificaciones por lote y disparar push remotas a multiples clientes, con respuesta agregada por destinatario y conteos de deliveries aceptadas/error.
- Se habilito el rol `marketing` para consultar clientes del tenant y reutilizar esa base como audiencia operativa del composer.
- Se evoluciono `frontend/src/pages/marketing/MarketingPage.tsx` para que cada campana pueda abrir un composer de broadcast, seleccionar clientes activos, reutilizar el contenido comercial y actualizar metricas base de la campana al enviar.
- Se corrigio el contrato de campanas para devolver `subject`, `content`, `segment_filter` y `scheduled_at` de forma consistente al frontend.
- Se agrego en Marketing la persistencia de audiencia base por campana (`segment_filter` con estado/busqueda) y programacion (`scheduled_at`) para reutilizarla automaticamente al abrir el composer de broadcast.
- Se dejo fallback backend para resolver destinatarios desde el `segment_filter` guardado de la campana cuando un broadcast se dispara sin lista explicita de `user_ids`.
- Se extendio el contrato de campanas para persistir `notification_type`, `action_url` y `send_push`, de modo que el payload reusable no quede solo en el composer manual.
- Se agrego un servicio backend reutilizable para despachar broadcasts de campanas tanto manuales como programados, evitando duplicar la logica entre endpoint y worker.
- Se monto ejecucion programada real de campanas con Celery: el worker procesa campanas `scheduled` vencidas y `celery beat` las revisa periodicamente usando Redis.
- Se ajusto Marketing web para editar el payload reusable completo de la campana y dejar claro si la ejecucion automatica intentara push remoto o solo bandeja interna.
- Se agrego observabilidad basica por campana para el scheduler y envios manuales: `last_dispatch_trigger`, timestamps de inicio/fin, `last_dispatch_error` y contador `dispatch_attempts`.
- Se mejoro el servicio de campanas para dejar trazas de exito/error por ejecucion y reprogramar automaticamente la campana si una corrida programada falla.
- Se actualizo Marketing web para mostrar en cada campana el ultimo intento, la ultima ejecucion exitosa y el error mas reciente sin salir de la tarjeta o modal de edicion.
- Se agrego persistencia backend de `push_deliveries` por notificacion/subscription, guardando `ticket_id`, estado inicial y receipt posterior de Expo.
- Se implemento polling de receipts contra Expo con Celery beat para cerrar el tracking asincronico de deliveries aceptadas por ticket.
- Se agrego `GET /api/v1/notifications/{id}/dispatch` con opcion de refrescar receipts al vuelo, de modo que staff pueda inspeccionar una notificacion puntual sin depender solo del resultado inmediato del POST.
- Se actualizo `frontend/src/pages/clients/ClientsPage.tsx` para distinguir tickets aceptados vs receipts entregados/pendientes/error y permitir refresco manual del tracking Expo.
- Se agrego tracking backend de engagement por notificacion con `campaign_id`, `opened_at` y `clicked_at`, de modo que cada notificacion creada desde una campana pueda devolver aperturas/clicks reales en vez de depender solo de contadores editados a mano.
- Se extendio `PATCH /api/v1/notifications/{id}` para registrar lectura, apertura y click en una sola llamada idempotente, recalculando `total_opened` y `total_clicked` de la campana asociada dentro de la misma transaccion.
- Se conecto mobile para que al abrir el destino de una notificacion desde la bandeja o desde una push se registre automaticamente engagement real en backend, y Perfil ahora muestra aperturas/clicks por item.
- Se actualizo Marketing web para exponer `CTR`, clicks agregados por campana y tasas derivadas sobre `sent`, tomando los nuevos contadores reales del backend.

## Experiencia que ya queda disponible
1. El usuario puede apuntar la app a una `API base URL`.
2. Puede cargar un gimnasio por `tenant slug` y ver su contexto comercial publico.
3. Puede iniciar sesion con un cliente real del backend.
4. Puede consultar su wallet con plan, estado, vencimiento, QR y proxima clase.
5. Puede cargar la agenda autenticada, reservar clases y cancelar sus propias reservas.
6. Puede consultar su historial de pagos desde la app.
7. Puede seleccionar un plan publico y generar una checkout session lista para abrir.
8. Puede volver a abrir la app y recuperar `API base URL`, tenant reciente y sesion guardada.
9. Puede volver desde checkout por deep link y refrescar wallet, reservas y pagos dentro de la app incluso tras relanzar si el token sigue vigente.
10. Puede iniciar una renovacion de membresia desde la wallet usando el plan actual.
11. Puede abrir comprobantes de pago cuando el backend expone `receipt_url`.
12. Puede disparar una notificacion local de prueba para validar permisos y canal en el dispositivo.
13. Puede registrar el Expo push token real cuando corre en un dispositivo compatible.
14. Puede dejar el ingreso manual del token como fallback operativo.
15. Puede navegar la base mobile por tabs sin depender de una sola vista vertical gigante.
16. Puede filtrar la Agenda por sede/modalidad y abrir el detalle de cada clase como pantalla dedicada.
17. Puede abrir Perfil y Detalle de clase como rutas internas preparadas para futuros deep links de notificaciones.
18. Puede cargar notificaciones del backend, abrir su `action_url` dentro de mobile y marcar su estado de lectura.
19. Puede tocar una notificacion local/push con `action_url` y navegar a la ruta interna correspondiente.
20. Puede disparar desde la app una push remota real pasando por backend y Expo para validar el circuito completo end-to-end.
21. Puede revisar desde Cuenta cuantas subscriptions push tiene registradas el miembro y si siguen activas tras los envios remotos.
22. El staff puede abrir un cliente en web y enviarle una notificacion/push real viendo al instante si Expo acepto, rechazo o no pudo enrutar los deliveries.
23. El staff de marketing puede enviar una campana como broadcast a multiples clientes activos, viendo resumen agregado y resultado por destinatario sin salir del modulo Marketing.
24. El staff puede guardar una audiencia reusable dentro de la campana y reaplicarla luego en el composer, sin reconstruir manualmente la seleccion cada vez.
25. El staff puede dejar una campana realmente programada para una fecha futura y permitir que backend la ejecute solo, usando el payload guardado sin reabrir el composer.
26. El staff puede ver cuando fue el ultimo intento de envio de una campana, si lo disparo el scheduler o un envio manual, cuantas veces se intento y cual fue el ultimo error registrado.
27. El staff puede revisar el tracking de una notificacion push individual, ver si Expo solo acepto el ticket o si ya devolvio receipt final, y refrescar ese estado desde la pantalla de Clientes.
28. El miembro puede abrir una notificacion desde mobile y dejar registrada la apertura/click sobre la notificacion original, incluyendo las que nacieron desde un broadcast de campana.
29. Marketing puede ver `open rate` y `CTR` reales por campana desde el panel, sin depender solo de valores cargados manualmente.

## Endpoints utilizados por esta base
- `POST /api/v1/auth/login`
- `GET /api/v1/public/tenants/{slug}/profile`
- `GET /api/v1/public/tenants/{slug}/plans`
- `POST /api/v1/public/tenants/{slug}/checkout-session`
- `GET /api/v1/mobile/wallet`
- `GET /api/v1/classes`
- `GET /api/v1/reservations`
- `POST /api/v1/reservations`
- `DELETE /api/v1/reservations/{id}`
- `GET /api/v1/mobile/payments`
- `GET /api/v1/mobile/wallet` con datos de renovacion
- `GET /api/v1/notifications`
- `POST /api/v1/notifications`
- `GET /api/v1/notifications/{id}/dispatch`
- `POST /api/v1/notifications/broadcast`
- `PATCH /api/v1/notifications/{id}` para `is_read`, `mark_opened` y `mark_clicked`
- `GET /api/v1/campaigns`
- `POST /api/v1/campaigns`
- `PATCH /api/v1/campaigns/{id}`
- `POST /api/v1/mobile/push-subscriptions`
- `GET /api/v1/mobile/push-subscriptions`
- `POST /api/v1/mobile/push-preview`

## Archivos principales tocados
- `mobile/App.tsx`
- `mobile/src/screens/HomeScreen.tsx`
- `mobile/src/screens/AgendaScreen.tsx`
- `mobile/src/screens/StoreScreen.tsx`
- `mobile/src/screens/PaymentsScreen.tsx`
- `mobile/src/screens/AccountScreen.tsx`
- `mobile/src/screens/ClassDetailScreen.tsx`
- `mobile/src/screens/ProfileScreen.tsx`
- `mobile/src/hooks/useMobileApp.ts`
- `mobile/src/navigation/types.ts`
- `mobile/src/ui/components.tsx`
- `mobile/src/ui/styles.ts`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/deepLinks.ts`
- `mobile/src/lib/push.ts`
- `mobile/src/lib/storage.ts`
- `mobile/src/lib/formatters.ts`
- `mobile/src/types.ts`
- `mobile/AVANCES.md`
- `backend/app/api/v1/endpoints/operations.py`
- `backend/app/models/business.py`
- `backend/app/schemas/business.py`
- `backend/app/schemas/platform.py`
- `backend/app/services/push_notification_service.py`
- `backend/app/services/campaign_service.py`
- `backend/migrations/versions/20260324_1500_add_notification_engagement_tracking.py`
- `backend/tests/test_push_notification_service.py`
- `frontend/src/pages/marketing/MarketingPage.tsx`
- `frontend/src/types/index.ts`
- `backend/tests/test_campaign_service.py`
- `backend/tests/test_push_notification_service.py`
- `backend/app/schemas/platform.py`
- `backend/app/schemas/business.py`
- `backend/app/api/v1/endpoints/public.py`
- `backend/app/models/platform.py`
- `backend/app/services/campaign_service.py`
- `backend/app/services/public_checkout_service.py`
- `backend/app/services/push_notification_service.py`
- `backend/app/tasks/__init__.py`
- `backend/app/tasks/campaigns.py`
- `backend/app/tasks/push_receipts.py`
- `backend/migrations/versions/20260324_0900_add_campaign_delivery_fields.py`
- `backend/migrations/versions/20260324_1100_add_campaign_dispatch_observability.py`
- `backend/migrations/versions/20260324_1300_create_push_deliveries.py`
- `backend/tests/test_public_checkout_service.py`
- `frontend/src/pages/public/TenantStorefrontPage.tsx`
- `backend/app/api/v1/endpoints/classes.py`
- `backend/app/api/v1/endpoints/clients.py`
- `backend/app/api/v1/endpoints/operations.py`
- `frontend/src/pages/marketing/MarketingPage.tsx`
- `frontend/src/pages/clients/ClientsPage.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/types/index.ts`
- `mobile/app.json`
- `mobile/package-lock.json`
- `mobile/package.json`

## Verificacion realizada
- `python -m py_compile backend/app/api/v1/endpoints/classes.py`
- `python -m py_compile backend/app/api/v1/endpoints/operations.py`
- `python -m py_compile backend/app/schemas/platform.py backend/app/api/v1/endpoints/operations.py backend/app/api/v1/endpoints/clients.py`
- `python -m py_compile backend/app/schemas/business.py backend/app/schemas/platform.py backend/app/api/v1/endpoints/operations.py`
- `npm run typecheck` en `mobile/`
- `npm run build` en `frontend/`
- `python -m py_compile backend/tests/test_push_notification_service.py backend/app/services/push_notification_service.py`
- `python -m py_compile backend/tests/test_campaign_service.py backend/migrations/versions/20260324_0900_add_campaign_delivery_fields.py`
- `python -m py_compile backend/app/models/business.py backend/app/services/campaign_service.py backend/app/api/v1/endpoints/operations.py backend/migrations/versions/20260324_1100_add_campaign_dispatch_observability.py backend/tests/test_campaign_service.py`
- `npm run build` en `frontend/` tras agregar observabilidad de scheduler en Marketing
- `python -m py_compile backend/app/models/platform.py backend/app/models/__init__.py backend/app/services/push_notification_service.py backend/app/api/v1/endpoints/operations.py backend/app/schemas/platform.py backend/app/tasks/__init__.py backend/app/tasks/push_receipts.py backend/migrations/versions/20260324_1300_create_push_deliveries.py backend/tests/test_push_notification_service.py`
- `npm run build` en `frontend/` tras agregar tracking de receipts Expo en Clientes
- `npm install` ejecutado en `mobile/` para dejar disponibles dependencias y lockfile del esqueleto Expo
- `npm install expo-secure-store` ejecutado en `mobile/`
- `npx expo install expo-notifications expo-device expo-constants expo-secure-store react-native react-dom react-native-web @expo/metro-runtime`
- `npx expo install --dev typescript`
- `npx expo config --type public` en `mobile/`

## Limites actuales de esta entrega
- No hay storage offline ni manejo de refresh token automatico aun.
- Si el access token ya expiro, la restauracion local limpia la sesion porque todavia no hay refresh token automatico.
- El push remoto no funciona en Expo Go Android desde SDK 53; para obtener el token real en Android hace falta un development build y un `projectId` de EAS configurado.
- La app ya tiene stack interno y rutas dedicadas, pero todavia no hay navegacion nativa con gestos/headers del sistema ni persistencia explicita del estado de ruta.
- El contrato push/listado hoy reutiliza `action_url`; todavia no hay payload push homologado con una taxonomia mas rica de eventos.
- La app y staff ya tienen tracking basico de Expo con receipts y engagement de apertura/click, pero todavia no hay embudo completo `delivery -> open -> click -> conversion` por dispositivo o por variante creativa.
- El broadcast por lote ya existe y actualiza metricas base de campana, pero todavia no hay segmentacion persistente mas rica ni exclusion dinamica por comportamiento reciente.
- La programacion de campanas ya tiene trazas basicas por campana, pero por ahora usa un poller simple con `celery beat`; todavia no hay retries avanzados, dead-letter queue ni metricas agregadas de scheduler.
- La renovacion hoy reutiliza el plan actual via checkout publico; todavia no hay cambio de plan, prorrateo ni reglas de upgrade/downgrade.
- Los comprobantes solo se pueden abrir cuando `receipt_url` viene informado desde backend; todavia no hay descarga offline ni reintento de pagos fallidos.

## Siguiente iteracion sugerida
- Avanzar en metricas agregadas del scheduler y en un embudo mas rico de conversion por campana (`delivery -> open -> click -> checkout`), o decidir si conviene migrar este stack interno a `expo-router`/`react-navigation` antes de crecer mas la navegacion.
