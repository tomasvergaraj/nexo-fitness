export function registerPwaServiceWorker() {
  const isLocalPreview = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !window.isSecureContext || (!import.meta.env.PROD && !isLocalPreview)) {
    return;
  }

  window.addEventListener('load', () => {
    // Scope limitado a /member para que el SW no intercepte rutas del dashboard
    // de admin ni de la landing pública.
    void navigator.serviceWorker.register('/sw.js', { scope: '/member' }).catch((error) => {
      console.error('No se pudo registrar el service worker de la PWA.', error);
    });
  });
}
