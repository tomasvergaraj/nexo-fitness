import type { QueryClient } from '@tanstack/react-query';
import type { SetURLSearchParams } from 'react-router-dom';
import type { AppNotification, Reservation, SupportInteraction } from '@/types';
import { formatDate, formatTime } from '@/utils';
import type { MemberTabId, NotificationDatePreset, NotificationFilter, NotificationPermissionState, SupportRequestForm } from './memberTypes';

export const TABS: Array<{
  id: MemberTabId;
  label: string;
  primary: boolean;
  description: string;
}> = [
  { id: 'home', label: 'Inicio', primary: true, description: 'Pase digital y accesos rápidos' },
  { id: 'agenda', label: 'Agenda', primary: true, description: 'Clases, reservas y próximas actividades' },
  { id: 'programs', label: 'Programas', primary: false, description: 'Programas de entrenamiento e inscripción personal' },
  { id: 'progress', label: 'Progreso', primary: true, description: 'Registro de medidas y evolución corporal' },
  { id: 'support', label: 'Soporte', primary: true, description: 'Ayuda, respuestas y seguimiento de tus casos' },
  { id: 'plans', label: 'Planes', primary: false, description: 'Planes disponibles y compra online' },
  { id: 'payments', label: 'Pagos', primary: false, description: 'Historial de pagos y comprobantes' },
  { id: 'notifications', label: 'Bandeja', primary: false, description: 'Avisos, recordatorios y acciones pendientes' },
  { id: 'profile', label: 'Perfil', primary: false, description: 'Cuenta, dispositivo y preferencias personales' },
];

export const SUPPORT_CHANNEL_OPTIONS: Array<{
  value: SupportInteraction['channel'];
  label: string;
  description: string;
}> = [
  { value: 'whatsapp', label: 'WhatsApp', description: 'Para que te respondan más rápido por chat.' },
  { value: 'email', label: 'Correo', description: 'Si prefieres una respuesta más detallada.' },
  { value: 'phone', label: 'Teléfono', description: 'Para que te contacten directamente.' },
  { value: 'in_person', label: 'Presencial', description: 'Si quieres resolverlo al llegar al gimnasio.' },
];

export const MEMBER_AGENDA_PAGE_SIZE = 100;
export const MEMBER_AUTO_RENEW_AVAILABLE = false;

// ─── Navigation ───────────────────────────────────────────────────────────────

export function getActiveTab(searchParams: URLSearchParams): MemberTabId {
  const value = searchParams.get('tab');
  return TABS.some((tab) => tab.id === value) ? (value as MemberTabId) : 'home';
}

export function setTab(
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
  tab: MemberTabId,
) {
  const next = new URLSearchParams(searchParams);
  next.set('tab', tab);
  setSearchParams(next, { replace: true });
}

export function getTabFromAction(actionUrl?: string | null): MemberTabId | null {
  if (!actionUrl) return null;
  if (actionUrl.includes('agenda/class/')) return 'agenda';
  if (actionUrl.includes('support')) return 'support';
  if (actionUrl.includes('payments')) return 'payments';
  if (actionUrl.includes('checkout') || actionUrl.includes('store')) return 'plans';
  if (actionUrl.includes('account/profile')) return 'profile';
  return actionUrl.startsWith('nexofitness://') ? 'notifications' : null;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function refreshMemberQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['member-wallet'] }),
    queryClient.invalidateQueries({ queryKey: ['member-tenant-profile'] }),
    queryClient.invalidateQueries({ queryKey: ['member-plans'] }),
    queryClient.invalidateQueries({ queryKey: ['member-programs'] }),
    queryClient.invalidateQueries({ queryKey: ['member-classes'] }),
    queryClient.invalidateQueries({ queryKey: ['member-reservations'] }),
    queryClient.invalidateQueries({ queryKey: ['member-payments'] }),
    queryClient.invalidateQueries({ queryKey: ['member-support-interactions'] }),
    queryClient.invalidateQueries({ queryKey: ['member-notifications'] }),
    queryClient.invalidateQueries({ queryKey: ['member-web-push-config'] }),
    queryClient.invalidateQueries({ queryKey: ['member-push-subscriptions'] }),
  ]);
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export function getMemberSnapshotStorageKey(userId: string) {
  return `nexo.member.snapshot.${userId}`;
}

export function loadMemberSnapshot<T>(userId?: string | null): T | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getMemberSnapshotStorageKey(userId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveMemberSnapshot<T extends object>(
  userId: string,
  partialSnapshot: Partial<T>,
  updatedAt?: string,
) {
  if (typeof window === 'undefined') return;
  try {
    const current = loadMemberSnapshot<T>(userId) ?? ({} as T);
    const next = { ...current, ...partialSnapshot, updatedAt: updatedAt || new Date().toISOString() };
    window.localStorage.setItem(getMemberSnapshotStorageKey(userId), JSON.stringify(next));
  } catch {
    // Ignore quota/storage errors.
  }
}

export function clearMemberSnapshot(userId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getMemberSnapshotStorageKey(userId));
  } catch {
    // Ignore storage errors on logout cleanup.
  }
}

// ─── Agenda ───────────────────────────────────────────────────────────────────

export function getAgendaDateKey(date: string | Date) {
  const value = typeof date === 'string' ? new Date(date) : date;
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getAgendaDayMeta(date: string | Date) {
  const value = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const weekdayLabel = formatDate(value, { weekday: 'long' });

  if (getAgendaDateKey(value) === getAgendaDateKey(today)) {
    return {
      title: 'Hoy',
      subtitle: formatDate(value, { weekday: 'long', day: '2-digit', month: 'short' }),
    };
  }
  if (getAgendaDateKey(value) === getAgendaDateKey(tomorrow)) {
    return {
      title: 'Mañana',
      subtitle: formatDate(value, { weekday: 'long', day: '2-digit', month: 'short' }),
    };
  }
  return {
    title: `${weekdayLabel.charAt(0).toUpperCase()}${weekdayLabel.slice(1)}`,
    subtitle: formatDate(value, { day: '2-digit', month: 'short', year: 'numeric' }),
  };
}

export function formatAgendaTimeRange(startTime: string, endTime: string) {
  return `${formatTime(startTime)} a ${formatTime(endTime)}`;
}

export function formatAgendaAvailabilityLabel(currentBookings: number, maxCapacity: number) {
  const availableSpots = Math.max(maxCapacity - currentBookings, 0);
  if (!availableSpots) return 'Sin cupos disponibles';
  return `${availableSpots} de ${maxCapacity} disponibles`;
}

export function getReservationStatusLabel(reservation: Reservation) {
  if (reservation.status === 'waitlisted') {
    return reservation.waitlist_position
      ? `Lista de espera · #${reservation.waitlist_position}`
      : 'Lista de espera';
  }
  if (reservation.status === 'attended') return 'Asististe';
  if (reservation.status === 'no_show') return 'No asististe';
  return 'Reserva confirmada';
}

export function isDateKeyWithinRange(value: string, from: string, to: string) {
  return value >= from && value <= to;
}

// ─── Support ──────────────────────────────────────────────────────────────────

export function sanitizeSupportContactValue(value?: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (['none', 'null', 'undefined', 'n/a', 'na'].includes(normalized.toLowerCase())) return null;
  return normalized;
}

export function normalizeWhatsAppPhone(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('56') && digits.length >= 11 && digits.length <= 15) return digits;
  if (digits.length === 9 && digits.startsWith('9')) return `56${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

export function buildSupportWhatsAppUrl(phone?: string | null, tenantName?: string | null) {
  const digits = normalizeWhatsAppPhone(phone);
  if (!digits) return null;
  const message = encodeURIComponent(
    `Hola, necesito ayuda con mi cuenta en ${tenantName || 'el gimnasio'}.`,
  );
  return `https://wa.me/${digits}?text=${message}`;
}

export function buildSupportCallUrl(phone?: string | null) {
  if (!phone) return null;
  const normalized = phone.replace(/[^\d+]/g, '');
  return normalized ? `tel:${normalized}` : null;
}

export function buildSupportEmailUrl(email?: string | null, tenantName?: string | null) {
  if (!email) return null;
  const subject = encodeURIComponent(`Soporte ${tenantName || 'Nexo Fitness'}`);
  const body = encodeURIComponent(
    `Hola, necesito ayuda con mi cuenta en ${tenantName || 'el gimnasio'}.`,
  );
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export function createSupportRequestForm(
  channel: SupportRequestForm['channel'] = 'whatsapp',
): SupportRequestForm {
  return { channel, subject: '', notes: '' };
}

// ─── Notifications ────────────────────────────────────────────────────────────

export function getNotificationPresetDateRange(
  preset: Exclude<NotificationDatePreset, 'custom'>,
) {
  const to = new Date();
  const from = new Date(to);
  const daysBack = preset === '7d' ? 6 : preset === '90d' ? 89 : 29;
  from.setDate(to.getDate() - daysBack);
  return { from: getAgendaDateKey(from), to: getAgendaDateKey(to) };
}

export function getNotificationDateRangeSummary(from: string, to: string) {
  return `entre el ${formatDate(from)} y el ${formatDate(to)}`;
}

export function getNotificationTypeMeta(type: AppNotification['type']) {
  if (type === 'success') {
    return {
      label: 'Confirmación',
      badgeClass: 'badge-success',
      panelIconClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
    };
  }
  if (type === 'warning') {
    return {
      label: 'Importante',
      badgeClass: 'badge-warning',
      panelIconClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
    };
  }
  if (type === 'error') {
    return {
      label: 'Urgente',
      badgeClass: 'badge-danger',
      panelIconClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
    };
  }
  return {
    label: 'Aviso',
    badgeClass: 'badge-info',
    panelIconClass: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200',
  };
}

export function getNotificationActionLabel(actionUrl?: string | null) {
  const nextTab = getTabFromAction(actionUrl);
  if (nextTab === 'agenda') return 'Ver agenda';
  if (nextTab === 'payments') return 'Ver pagos';
  if (nextTab === 'plans') return 'Ver planes';
  if (nextTab === 'profile') return 'Ver perfil';
  return actionUrl?.startsWith('http') ? 'Abrir enlace' : 'Abrir aviso';
}

export function getNotificationEmptyStateTitle(filter: NotificationFilter, query: string) {
  if (query.trim()) return 'No encontramos avisos con esa búsqueda';
  if (filter === 'unread') return 'No tienes avisos nuevos';
  if (filter === 'read') return 'Todavía no hay avisos leídos';
  if (filter === 'actionable') return 'No hay avisos con acción';
  return 'Tu bandeja está vacía';
}

export function getNotificationEmptyStateDescription(
  filter: NotificationFilter,
  query: string,
  rangeSummary: string,
) {
  if (query.trim()) return 'Prueba con otra palabra o revisa los filtros para encontrar el aviso que buscas.';
  if (filter === 'unread') return `No hay avisos nuevos ${rangeSummary}.`;
  if (filter === 'read') return `Todavía no hay avisos leídos ${rangeSummary}.`;
  if (filter === 'actionable') return `No hay avisos con acción ${rangeSummary}.`;
  return `No encontramos avisos ${rangeSummary}.`;
}

// ─── PWA / Device ─────────────────────────────────────────────────────────────

export function getInstallHint({
  isStandalone,
  canPromptInstall,
}: {
  isStandalone: boolean;
  canPromptInstall: boolean;
}) {
  if (isStandalone) {
    return 'La app ya está instalada y puedes abrirla directo desde la pantalla principal del teléfono.';
  }
  if (canPromptInstall) {
    return 'Toca Instalar para guardar esta app en tu dispositivo y abrirla más rápido.';
  }
  if (typeof navigator === 'undefined') {
    return 'Instala esta app desde el menú del navegador para tener una experiencia móvil más directa.';
  }
  const userAgent = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(userAgent)) {
    return 'En Safari usa Compartir y luego Agregar a pantalla de inicio para instalar esta app.';
  }
  return 'En Chrome o Edge usa el menu del navegador y elige Instalar app para guardar este acceso.';
}

export function getNotificationPermissionMeta(permission: NotificationPermissionState) {
  if (permission === 'granted') return { label: 'Avisos permitidos', tone: 'success' as const };
  if (permission === 'denied') return { label: 'Avisos bloqueados', tone: 'warning' as const };
  if (permission === 'default') return { label: 'Permiso pendiente', tone: 'info' as const };
  return { label: 'Avisos no disponibles', tone: 'neutral' as const };
}
