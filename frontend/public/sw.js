// Service Worker — Nexo Fitness Member PWA
// Scope registrado: /member (ver frontend/src/lib/pwa.ts)
// Solo intercepta requests bajo /member — no afecta al dashboard de admin ni rutas públicas.

const CACHE_VERSION = 'v5';
const ICON_VERSION = '20260409-2';
const MANIFEST_PATH = `/manifest.webmanifest?v=${ICON_VERSION}`;
const SYSTEM_ICON_PATH = `/icon.png?v=${ICON_VERSION}`;
const PWA_ICON_192_PATH = `/icons/icon-192.png?v=${ICON_VERSION}`;
const PWA_ICON_512_PATH = `/icons/icon-512.png?v=${ICON_VERSION}`;
const APP_SHELL_CACHE = `nexo-fitness-member-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `nexo-fitness-member-static-${CACHE_VERSION}`;
const PUBLIC_CACHE = `nexo-fitness-member-public-${CACHE_VERSION}`;
const KNOWN_CACHES = [APP_SHELL_CACHE, STATIC_CACHE, PUBLIC_CACHE];

// Shell mínima para que la PWA cargue offline desde /member
const APP_SHELL = [
  '/member',
  MANIFEST_PATH,
  SYSTEM_ICON_PATH,
  PWA_ICON_192_PATH,
  PWA_ICON_512_PATH,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !KNOWN_CACHES.includes(key)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Solo GET — dejar pasar mutaciones directamente
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Navegación (HTML): network-first con fallback a /member
  // Con el scope /member, solo recibimos navigates a URLs que empiezan con /member
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_SHELL_CACHE, '/member'));
    return;
  }

  // Requests a orígenes externos: dejar pasar sin caché
  if (url.origin !== self.location.origin) {
    return;
  }

  // API pública del gimnasio: network-first con caché corta (datos públicos como clases)
  if (isPublicApiRequest(url)) {
    event.respondWith(networkFirst(request, PUBLIC_CACHE));
    return;
  }

  // Assets estáticos (JS, CSS, fonts, imágenes): stale-while-revalidate
  if (isStaticAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

// ─── Push notifications ───────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  const title = payload.title || 'Nexo Fitness';
  const targetUrl = payload.url || payload.action_url || '/member?tab=notifications';

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: payload.body || payload.message || 'Tienes una nueva novedad en tu cuenta.',
        icon: payload.icon || PWA_ICON_192_PATH,
        badge: payload.badge || PWA_ICON_192_PATH,
        tag: payload.tag || 'nexo-member-web-push',
        data: { url: targetUrl },
      }),
      broadcastToClients({
        type: 'member-push-received',
        payload: {
          title,
          url: targetUrl,
          notificationId: payload.notification_id || payload.id || null,
        },
      }),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  const targetUrl = event.notification.data?.url || '/member?tab=notifications';
  event.notification.close();

  event.waitUntil(
    Promise.all([
      broadcastToClients({
        type: 'member-notification-clicked',
        payload: { url: targetUrl },
      }),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if ('focus' in client && client.url.includes(self.location.origin)) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
    ]),
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPublicApiRequest(url) {
  return url.pathname.startsWith('/api/v1/public/');
}

function isStaticAssetRequest(request, url) {
  if (['style', 'script', 'worker', 'font', 'image'].includes(request.destination)) {
    return true;
  }
  return [
    '/manifest.webmanifest',
    '/icon.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
  ].includes(url.pathname);
}

async function networkFirst(request, cacheName, fallbackPath) {
  const cache = await caches.open(cacheName);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;
    if (fallbackPath) {
      const fallback = await cache.match(fallbackPath);
      if (fallback) return fallback;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => cachedResponse || Response.error());

  return cachedResponse || networkPromise;
}

function readPushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

async function broadcastToClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => {
    client.postMessage(message);
  });
}
