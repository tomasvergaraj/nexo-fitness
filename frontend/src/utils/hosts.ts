import type { UserRole } from '@/types';

type HostKind = 'app' | 'admin' | 'sales' | 'other';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function normalizeOrigin(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function getHostname(origin?: string | null): string | null {
  if (!origin) {
    return null;
  }

  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getCurrentOrigin(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.location.origin.replace(/\/$/, '');
}

function getCurrentHostname(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.location.hostname.toLowerCase();
}

function withPath(origin: string | null, path: string): string {
  if (!origin) {
    return path;
  }
  return new URL(path.startsWith('/') ? path : `/${path}`, `${origin}/`).toString();
}

function deriveSiblingOrigin(origin: string, subdomain: string): string {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();

  if (LOCAL_HOSTS.has(hostname)) {
    return url.origin;
  }

  const labels = hostname.split('.');
  if (labels.length < 2) {
    return url.origin;
  }

  if (['www', 'app', 'admin', 'landing'].includes(labels[0])) {
    labels.shift();
  }

  url.hostname = `${subdomain}.${labels.join('.')}`;
  return url.origin;
}

function deriveSalesOrigin(origin: string): string {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();

  if (LOCAL_HOSTS.has(hostname)) {
    return url.origin;
  }

  const labels = hostname.split('.');
  if (labels.length < 2) {
    return url.origin;
  }

  if (['www', 'app', 'admin', 'landing'].includes(labels[0])) {
    labels.shift();
  }

  url.hostname = labels.join('.');
  return url.origin;
}

export function getAppOrigin(): string | null {
  const configured = normalizeOrigin(import.meta.env.VITE_PUBLIC_APP_URL);
  if (configured) {
    return configured;
  }

  const current = getCurrentOrigin();
  const currentHostname = getCurrentHostname();
  if (current && currentHostname?.startsWith('app.')) {
    return current;
  }

  if (current && currentHostname?.startsWith('admin.')) {
    return deriveSiblingOrigin(current, 'app');
  }

  return current;
}

export function getAdminOrigin(): string | null {
  const configured = normalizeOrigin(import.meta.env.VITE_ADMIN_APP_URL);
  if (configured) {
    return configured;
  }

  const current = getCurrentOrigin();
  const currentHostname = getCurrentHostname();
  if (current && currentHostname?.startsWith('admin.')) {
    return current;
  }

  const appOrigin = getAppOrigin();
  return appOrigin ? deriveSiblingOrigin(appOrigin, 'admin') : current;
}

export function getSalesOrigin(): string | null {
  const configured = normalizeOrigin(import.meta.env.VITE_SALES_SITE_URL);
  if (configured) {
    return configured;
  }

  const current = getCurrentOrigin();
  const currentHostname = getCurrentHostname();
  if (current && currentHostname && !currentHostname.startsWith('app.') && !currentHostname.startsWith('admin.')) {
    return current;
  }

  const appOrigin = getAppOrigin();
  return appOrigin ? deriveSalesOrigin(appOrigin) : current;
}

export function getCurrentHostKind(): HostKind {
  const currentHostname = getCurrentHostname();
  if (!currentHostname) {
    return 'other';
  }

  const adminHostname = getHostname(getAdminOrigin());
  if (adminHostname && currentHostname === adminHostname) {
    return 'admin';
  }

  const appHostname = getHostname(getAppOrigin());
  if (appHostname && currentHostname === appHostname) {
    return 'app';
  }

  const salesHostname = getHostname(getSalesOrigin());
  if (salesHostname && currentHostname === salesHostname) {
    return 'sales';
  }

  return 'other';
}

export function buildAppUrl(path: string): string {
  return withPath(getAppOrigin(), path);
}

export function buildAdminUrl(path: string): string {
  return withPath(getAdminOrigin(), path);
}

export function buildSalesUrl(path = '/'): string {
  return withPath(getSalesOrigin(), path);
}

export function getPreferredPlatformUrlForRole(role?: UserRole | null, path = '/'): string {
  if (role === 'superadmin') {
    return buildAdminUrl(path);
  }
  return buildAppUrl(path);
}
