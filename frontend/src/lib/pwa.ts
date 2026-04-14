export function registerPwaServiceWorker() {
  const isLocalPreview = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !window.isSecureContext || (!import.meta.env.PROD && !isLocalPreview)) {
    return;
  }

  window.addEventListener('load', () => {
    // Scope global para permitir que owners y miembros instalen Nexo como app.
    // El service worker resuelve internamente qué rutas cachear y cómo hacer fallback.
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.error('No se pudo registrar el service worker de la PWA.', error);
    });
  });
}
