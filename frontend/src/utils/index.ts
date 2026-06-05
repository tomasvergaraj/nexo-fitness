import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { UserRole } from '@/types';
import { getCurrentHostKind } from '@/utils/hosts';

export const DEFAULT_PRIMARY_COLOR = '#06b6d4';
export const DEFAULT_SECONDARY_COLOR = '#0f766e';
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export type PlanLimitErrorPayload = {
  detail: string;
  code: 'plan_limit_reached';
  resource: 'clients' | 'branches';
  current_usage: number;
  limit: number;
  plan_key: string;
  upgrade_required: boolean;
};

/**
 * Extracts a human-readable message from a FastAPI/Pydantic error response.
 * Handles both string details and Pydantic v2 array validation errors.
 */
export function getApiError(error: unknown, fallback = 'Ocurrió un error inesperado'): string {
  const responseData = (error as any)?.response?.data;
  if (responseData && typeof responseData === 'object') {
    const responseDetail = (responseData as Record<string, unknown>).detail;
    if (responseDetail && typeof responseDetail === 'object') {
      const nestedMessage = (responseDetail as Record<string, unknown>).detail;
      if (typeof nestedMessage === 'string') {
        return nestedMessage;
      }
      const nestedAlt = (responseDetail as Record<string, unknown>).message;
      if (typeof nestedAlt === 'string') {
        return nestedAlt;
      }
    }
  }
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

export function getPlanLimitError(error: unknown): PlanLimitErrorPayload | null {
  const responseData = (error as any)?.response?.data;
  if (!responseData || typeof responseData !== 'object') {
    return null;
  }

  const candidate = responseData as Partial<PlanLimitErrorPayload> & {
    detail?: unknown;
  };
  if (candidate.code === 'plan_limit_reached' && typeof candidate.detail === 'string') {
    return candidate as PlanLimitErrorPayload;
  }

  if (candidate.detail && typeof candidate.detail === 'object') {
    const nested = candidate.detail as Partial<PlanLimitErrorPayload>;
    if (nested.code === 'plan_limit_reached' && typeof nested.detail === 'string') {
      return nested as PlanLimitErrorPayload;
    }
  }

  return null;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function canAccessDashboard(role?: UserRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'superadmin';
}

export function getDefaultRouteForRole(role?: UserRole | null): string {
  if (role === 'client') return '/member';
  if (role === 'superadmin') return '/platform/dashboard';
  if (canAccessDashboard(role)) return '/dashboard';
  if (role === 'reception') return '/reception/checkin';
  if (role === 'trainer') return '/classes';
  if (role === 'marketing') return '/marketing';
  return '/login';
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
  return `${getPublicAppOrigin()}/s/${tenantSlug}`;
}

export function isCustomStorefrontHost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const currentHost = window.location.hostname.toLowerCase();
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    return false;
  }

  const hostKind = getCurrentHostKind();
  if (hostKind === 'app' || hostKind === 'admin' || hostKind === 'sales') {
    return false;
  }

  const configuredAppHost = normalizeCustomDomain(import.meta.env.VITE_PUBLIC_APP_URL);
  if (configuredAppHost) {
    return currentHost !== configuredAppHost;
  }

  if (
    currentHost.startsWith('app.')
    || currentHost.startsWith('admin.')
    || currentHost.startsWith('www.')
    || currentHost.startsWith('landing.')
  ) {
    return false;
  }

  return true;
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

/** WCAG relative luminance (0 = black, 1 = white) of a hex color. */
export function relativeLuminance(hexColor: string): number {
  const channels = hexToRgbString(hexColor).split(',').map((value) => {
    const srgb = Number(value) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Picks a readable ink (near-black or white) for text laid over `bgHex`.
 * For a gradient, pass the lighter endpoint (the worst case for white text).
 */
export function readableInk(bgHex: string, dark = '#0f172a', light = '#ffffff'): string {
  return relativeLuminance(bgHex) > 0.18 ? dark : light;
}

function luminanceFromRgb(r: number, g: number, b: number): number {
  const lin = [r, g, b].map((c) => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio (1–21) between two hex colors. */
export function contrastRatio(hexA: string, hexB: string): number {
  const hi = Math.max(relativeLuminance(hexA), relativeLuminance(hexB)) + 0.05;
  const lo = Math.min(relativeLuminance(hexA), relativeLuminance(hexB)) + 0.05;
  return hi / lo;
}

/**
 * Nudges `brandHex` toward white (on a dark bg) or black (on a light bg) until it
 * meets `target` contrast against `bgHex`. Only shifts lightness, so brand-colored
 * text stays on-brand yet readable for any tenant color. Used for brand-as-text.
 */
export function ensureReadable(brandHex: string, bgHex: string, target = 4.5): string {
  const normalized = normalizeHexColor(brandHex);
  if (!normalized) return brandHex;
  const [r, g, b] = hexToRgbString(normalized).split(',').map(Number);
  const bgL = relativeLuminance(bgHex);
  const bgDark = bgL < 0.5;
  const toward = bgDark ? 255 : 0;
  const bgLumPlus = bgL + 0.05;
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const rr = Math.round(r + (toward - r) * t);
    const gg = Math.round(g + (toward - g) * t);
    const bb = Math.round(b + (toward - b) * t);
    const L = luminanceFromRgb(rr, gg, bb);
    const ratio = bgDark ? (L + 0.05) / bgLumPlus : bgLumPlus / (L + 0.05);
    if (ratio >= target) {
      return `#${[rr, gg, bb].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return bgDark ? '#ffffff' : '#000000';
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
  let d: Date;
  if (typeof date === 'string') {
    // Las fechas "solo día" (YYYY-MM-DD, p. ej. vencimiento de plan o fecha de
    // nacimiento) no tienen zona horaria. `new Date('2026-06-01')` las interpreta
    // como medianoche UTC y al renderizar en zona Chile (UTC-3/-4) retrocede un día,
    // mostrando una fecha menos que la real almacenada. Forzamos parseo local.
    d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date(date);
  } else {
    d = date;
  }
  return d.toLocaleDateString('es-CL', options ?? { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(date: string | Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

export function formatClassStatusLabel(status: string): string {
  if (status === 'scheduled') return 'Programada';
  if (status === 'in_progress') return 'En curso';
  if (status === 'completed') return 'Finalizada';
  if (status === 'cancelled') return 'Cancelada';
  return status;
}

export function formatClassModalityLabel(modality: string): string {
  if (modality === 'in_person') return 'Presencial';
  if (modality === 'online') return 'Online';
  if (modality === 'hybrid') return 'Híbrida';
  return modality;
}

export function formatSupportChannelLabel(channel?: string | null): string {
  if (!channel) return 'Sin canal';
  if (channel === 'whatsapp') return 'WhatsApp';
  if (channel === 'email') return 'Correo';
  if (channel === 'phone') return 'Teléfono';
  if (channel === 'in_person') return 'Presencial';
  return channel;
}

export function formatFeedbackCategoryLabel(category?: string | null): string {
  if (!category) return 'Sin categoría';
  if (category === 'suggestion') return 'Sugerencia';
  if (category === 'improvement') return 'Solicitud de mejora';
  if (category === 'problem') return 'Problema';
  if (category === 'other') return 'Otro';
  return category;
}

export function formatClassCapacityLabel(currentBookings: number, maxCapacity: number): string {
  return `${currentBookings}/${maxCapacity} cupos`;
}

export function formatMembershipStatusLabel(status?: string | null): string {
  if (!status) return 'Pendiente';
  if (status === 'active') return 'Activa';
  if (status === 'expired') return 'Vencida';
  if (status === 'cancelled') return 'Cancelada';
  if (status === 'frozen') return 'Congelada';
  if (status === 'pending') return 'Pendiente';
  if (status === 'inactive') return 'Inactiva';
  if (status === 'trial') return 'En prueba';
  return status;
}

export function formatUserRoleLabel(role?: string | null): string {
  if (!role) return 'Sin rol';
  if (role === 'superadmin') return 'Superadministrador';
  if (role === 'owner') return 'Propietario';
  if (role === 'admin') return 'Administrador';
  if (role === 'reception') return 'Recepción';
  if (role === 'trainer') return 'Entrenador';
  if (role === 'marketing') return 'Marketing';
  if (role === 'client') return 'Cliente';
  return role;
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
  if (durationType === 'custom' && durationDays === 90) return 'Trimestral';
  if (durationType === 'custom' && durationDays === 180) return 'Semestral';
  if (durationType === 'custom' && durationDays === 365) return 'Anual';
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
    inactive: 'badge-neutral',
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

export function supportChannelBadgeColor(channel?: string | null): string {
  const map: Record<string, string> = {
    whatsapp: 'badge-success',
    email: 'badge-info',
    phone: 'badge-warning',
    in_person: 'badge-neutral',
  };
  return channel ? map[channel] ?? 'badge-neutral' : 'badge-neutral';
}

export function feedbackCategoryBadgeColor(category?: string | null): string {
  const map: Record<string, string> = {
    suggestion: 'badge-info',
    improvement: 'badge-warning',
    problem: 'badge-danger',
    other: 'badge-neutral',
  };
  return category ? map[category] ?? 'badge-neutral' : 'badge-neutral';
}

export function occupancyColor(rate: number): string {
  if (rate >= 90) return 'text-red-500';
  if (rate >= 70) return 'text-amber-500';
  return 'text-emerald-500';
}
