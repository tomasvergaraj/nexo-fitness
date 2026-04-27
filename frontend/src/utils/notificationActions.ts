import type { UserRole } from '@/types';
import { canAccessDashboard, getDefaultRouteForRole } from '@/utils';

type NotificationDestination =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'none' };

function isExternalUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function mapStaffTabToRoute(tab?: string | null, role?: UserRole | null) {
  if (!tab) return getDefaultRouteForRole(role);
  if (tab === 'agenda') return '/classes';
  if (tab === 'payments') return '/reports';
  if (tab === 'plans' || tab === 'store' || tab === 'checkout') return '/plans';
  if (tab === 'support') return '/support';
  if (tab === 'profile') return '/settings';
  if (tab === 'programs') return '/programs';
  if (tab === 'clients') return '/clients';
  if (tab === 'reports') return '/reports';
  if (tab === 'promo-codes') return '/promo-codes';
  if (tab === 'settings') return '/settings';
  if (tab === 'dashboard') return canAccessDashboard(role) ? '/dashboard' : getDefaultRouteForRole(role);
  return getDefaultRouteForRole(role);
}

function mapClientTabToRoute(params: URLSearchParams) {
  const nextParams = new URLSearchParams(params);
  if (!nextParams.get('tab')) {
    nextParams.set('tab', 'notifications');
  }
  return `/member?${nextParams.toString()}`;
}

function resolveQueryAction(actionUrl: string, role?: UserRole | null): NotificationDestination {
  const params = new URLSearchParams(actionUrl.replace(/^\?/, ''));
  if (role === 'client') {
    return { kind: 'internal', href: mapClientTabToRoute(params) };
  }
  return { kind: 'internal', href: mapStaffTabToRoute(params.get('tab'), role) };
}

function resolveNexoAction(actionUrl: string, role?: UserRole | null): NotificationDestination {
  const normalized = actionUrl.replace(/^nexofitness:\/\//i, '');
  const [rawPathPart, rawQuery = ''] = normalized.split('?');
  const rawPath = rawPathPart.replace(/^\/+/, '').toLowerCase();

  if (!rawPath && rawQuery) {
    return resolveQueryAction(`?${rawQuery}`, role);
  }

  if (rawPath.startsWith('platform/')) {
    return { kind: 'internal', href: `/${rawPath}${rawQuery ? `?${rawQuery}` : ''}` };
  }

  if (role === 'client') {
    const params = new URLSearchParams(rawQuery);
    if (rawPath.includes('agenda') || rawPath.includes('class')) params.set('tab', 'agenda');
    else if (rawPath.includes('support')) params.set('tab', 'support');
    else if (rawPath.includes('payments')) params.set('tab', 'payments');
    else if (rawPath.includes('store') || rawPath.includes('checkout') || rawPath.includes('plans')) params.set('tab', 'plans');
    else if (rawPath.includes('account/profile') || rawPath.includes('profile')) params.set('tab', 'profile');
    else if (rawPath.includes('program')) params.set('tab', 'programs');
    else if (rawPath.includes('progress')) params.set('tab', 'progress');
    else params.set('tab', params.get('tab') || 'notifications');
    return { kind: 'internal', href: mapClientTabToRoute(params) };
  }

  if (role === 'superadmin') {
    if (rawPath.includes('plan')) return { kind: 'internal', href: '/platform/plans' };
    if (rawPath.includes('lead')) return { kind: 'internal', href: '/platform/leads' };
    return { kind: 'internal', href: '/platform/tenants' };
  }

  if (rawPath.includes('agenda') || rawPath.includes('class')) return { kind: 'internal', href: '/classes' };
  if (rawPath.includes('support')) return { kind: 'internal', href: '/support' };
  if (rawPath.includes('payments')) return { kind: 'internal', href: '/reports' };
  if (rawPath.includes('store') || rawPath.includes('checkout') || rawPath.includes('plans')) return { kind: 'internal', href: '/plans' };
  if (rawPath.includes('account/profile') || rawPath.includes('profile')) return { kind: 'internal', href: '/settings' };
  if (rawPath.includes('program')) return { kind: 'internal', href: '/programs' };
  if (rawPath.includes('report')) return { kind: 'internal', href: '/reports' };
  if (rawPath.includes('promo')) return { kind: 'internal', href: '/promo-codes' };
  if (rawPath.includes('client')) return { kind: 'internal', href: '/clients' };
  if (rawPath.includes('setting')) return { kind: 'internal', href: '/settings' };
  if (rawPath.includes('dashboard')) {
    return { kind: 'internal', href: canAccessDashboard(role) ? '/dashboard' : getDefaultRouteForRole(role) };
  }
  return { kind: 'internal', href: getDefaultRouteForRole(role) };
}

export function resolveNotificationDestination(actionUrl?: string | null, role?: UserRole | null): NotificationDestination {
  const trimmed = actionUrl?.trim();
  if (!trimmed) {
    return { kind: 'none' };
  }

  if (isExternalUrl(trimmed)) {
    return { kind: 'external', href: trimmed };
  }

  if (trimmed.startsWith('/')) {
    if (trimmed === '/dashboard' || trimmed.startsWith('/dashboard?')) {
      return { kind: 'internal', href: canAccessDashboard(role) ? trimmed : getDefaultRouteForRole(role) };
    }
    return { kind: 'internal', href: trimmed };
  }

  if (trimmed.startsWith('?')) {
    return resolveQueryAction(trimmed, role);
  }

  if (trimmed.startsWith('nexofitness://')) {
    return resolveNexoAction(trimmed, role);
  }

  return { kind: 'internal', href: getDefaultRouteForRole(role) };
}

export function getNotificationActionLabel(actionUrl?: string | null, role?: UserRole | null) {
  const destination = resolveNotificationDestination(actionUrl, role);
  if (destination.kind === 'none') return 'Solo informativo';
  if (destination.kind === 'external') return 'Abrir enlace';
  if (destination.href === '/classes' || destination.href.includes('tab=agenda')) return 'Ver agenda';
  if (destination.href === '/support' || destination.href.includes('tab=support')) return 'Ver soporte';
  if (destination.href === '/reports' || destination.href.includes('tab=payments')) return 'Ver pagos';
  if (destination.href === '/plans' || destination.href.includes('tab=plans')) return 'Ver planes';
  if (destination.href === '/settings' || destination.href.includes('tab=profile')) return 'Ver perfil';
  if (destination.href === '/programs' || destination.href.includes('tab=programs')) return 'Ver programas';
  if (destination.href === '/clients') return 'Ver clientes';
  if (destination.href === '/promo-codes') return 'Ver códigos';
  if (destination.href.startsWith('/platform/plans')) return 'Ver planes SaaS';
  if (destination.href.startsWith('/platform/leads')) return 'Ver leads';
  if (destination.href.startsWith('/platform/tenants')) return 'Ver tenants';
  return 'Abrir destino';
}
