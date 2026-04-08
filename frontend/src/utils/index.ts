import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const DEFAULT_PRIMARY_COLOR = '#06b6d4';
export const DEFAULT_SECONDARY_COLOR = '#0f766e';
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * Extracts a human-readable message from a FastAPI/Pydantic error response.
 * Handles both string details and Pydantic v2 array validation errors.
 */
export function getApiError(error: unknown, fallback = 'Ocurrió un error inesperado'): string {
  const detail = (error as any)?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: any) => {
        const field = Array.isArray(e.loc) ? e.loc.filter((l: any) => l !== 'body').join('.') : '';
        return field ? `${field}: ${e.msg}` : e.msg;
      })
      .join(' · ');
  }
  return fallback;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getPublicAppOrigin(): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  return (configured || window.location.origin).replace(/\/$/, '');
}

export function normalizeCustomDomain(value?: string | null): string | null {
  const raw = value?.trim().toLowerCase().replace(/\.$/, '');
  if (!raw) return null;

  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (!parsed.hostname || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash || parsed.port) {
      return null;
    }
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

export function buildTenantStorefrontUrl(tenantSlug: string, customDomain?: string | null): string {
  const normalizedDomain = normalizeCustomDomain(customDomain);
  if (normalizedDomain) {
    return `https://${normalizedDomain}`;
  }
  return `${getPublicAppOrigin()}/store/${tenantSlug}`;
}

export function isCustomStorefrontHost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const currentHost = window.location.hostname.toLowerCase();
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    return false;
  }

  const appHost = normalizeCustomDomain(getPublicAppOrigin());
  return Boolean(appHost && currentHost !== appHost);
}

export function normalizeHexColor(value?: string | null, fallback?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) {
    return fallback ?? null;
  }
  if (!HEX_COLOR_PATTERN.test(raw)) {
    return fallback ?? null;
  }
  return raw.toLowerCase();
}

export function hexToRgbString(value: string): string {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return '15,23,42';
  }
  const hex = normalized.slice(1);
  return `${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)}`;
}

export function withAlpha(hexColor: string, alpha: number): string {
  return `rgba(${hexToRgbString(hexColor)}, ${alpha})`;
}

export function parseApiNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function formatCurrency(amount: number, currency = 'CLP'): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount);
}

export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('es-CL', options ?? { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(date: string | Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

export function toDateInputValue(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function formatDurationLabel(durationType: string, durationDays?: number | null): string {
  if (durationType === 'annual') return 'Anual';
  if (durationType === 'monthly') return 'Mensual';
  if (durationType === 'perpetual') return 'Perpetuo';
  if (durationDays) return `${durationDays} días`;
  return 'Personalizado';
}

export function formatRelative(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes}m`;
  if (hours < 24) return `Hace ${hours}h`;
  if (days < 7) return `Hace ${days}d`;
  return formatDate(d);
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function classStatusColor(status: string): string {
  const map: Record<string, string> = {
    scheduled: 'badge-info',
    in_progress: 'badge-warning',
    completed: 'badge-success',
    cancelled: 'badge-danger',
  };
  return map[status] ?? 'badge-neutral';
}

export function membershipStatusColor(status: string): string {
  const map: Record<string, string> = {
    active: 'badge-success',
    expired: 'badge-danger',
    cancelled: 'badge-danger',
    frozen: 'badge-warning',
    pending: 'badge-info',
  };
  return map[status] ?? 'badge-neutral';
}

export function paymentStatusColor(status: string): string {
  const map: Record<string, string> = {
    completed: 'badge-success',
    pending: 'badge-warning',
    failed: 'badge-danger',
    refunded: 'badge-info',
    cancelled: 'badge-neutral',
  };
  return map[status] ?? 'badge-neutral';
}

export function occupancyColor(rate: number): string {
  if (rate >= 90) return 'text-red-500';
  if (rate >= 70) return 'text-amber-500';
  return 'text-emerald-500';
}
