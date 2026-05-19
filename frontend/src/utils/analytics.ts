/**
 * Wrapper sobre posthog-js para tracking de producto.
 *
 * Idempotente y seguro: si no hay VITE_POSTHOG_KEY definido, todas las
 * funciones son no-op (no se carga el SDK ni se envía nada). Esto permite
 * usar las funciones libremente en componentes sin guardar.
 */

import posthog from 'posthog-js';

let initialized = false;

function isEnabled() {
  return Boolean(import.meta.env.VITE_POSTHOG_KEY);
}

export function initAnalytics() {
  if (initialized || !isEnabled()) return;
  const apiKey = import.meta.env.VITE_POSTHOG_KEY as string;
  const apiHost = (import.meta.env.VITE_POSTHOG_HOST as string) || 'https://us.i.posthog.com';

  posthog.init(apiKey, {
    api_host: apiHost,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: true,
    persistence: 'localStorage+cookie',
    person_profiles: 'identified_only',
  });
  initialized = true;
}

export function identifyUser(user: { id: string; email?: string; role?: string; tenant_id?: string }) {
  if (!initialized) return;
  posthog.identify(user.id, {
    email: user.email,
    role: user.role,
    tenant_id: user.tenant_id,
  });
  if (user.tenant_id) {
    posthog.group('tenant', user.tenant_id);
  }
}

export function resetAnalytics() {
  if (!initialized) return;
  posthog.reset();
}

export function capture(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.capture(event, properties);
}
