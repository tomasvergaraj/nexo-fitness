import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/services/api';
import type { User } from '@/types';

const STORAGE_KEY = 'nexo-impersonation-original';

interface ImpersonationOriginalSnapshot {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
}

interface ImpersonationClaims {
  active: boolean;
  byEmail: string | null;
  byUserId: string | null;
  reason: string | null;
}

function decodeJwtPayload<T = Record<string, unknown>>(token: string | null): T | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as T;
  } catch {
    return null;
  }
}

export function getImpersonationClaims(token?: string | null): ImpersonationClaims {
  const t = token ?? useAuthStore.getState().accessToken;
  const payload = decodeJwtPayload<{
    impersonated_by_user_id?: string;
    impersonated_by_email?: string;
    impersonation_reason?: string;
  }>(t);
  if (!payload?.impersonated_by_user_id) {
    return { active: false, byEmail: null, byUserId: null, reason: null };
  }
  return {
    active: true,
    byEmail: payload.impersonated_by_email ?? null,
    byUserId: payload.impersonated_by_user_id,
    reason: payload.impersonation_reason ?? null,
  };
}

export async function startImpersonation(token: string): Promise<void> {
  const store = useAuthStore.getState();
  const snapshot: ImpersonationOriginalSnapshot = {
    user: store.user,
    accessToken: store.accessToken,
    refreshToken: store.refreshToken,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));

  // Swap to impersonated token first so the /auth/me request hits as the owner
  store.setTokens(token, '');

  try {
    const meResponse = await authApi.me();
    store.setAuth(meResponse.data as User, token, '');
  } catch (err) {
    sessionStorage.removeItem(STORAGE_KEY);
    if (snapshot.accessToken && snapshot.refreshToken && snapshot.user) {
      store.setAuth(snapshot.user, snapshot.accessToken, snapshot.refreshToken);
    } else {
      store.logout();
    }
    throw err;
  }
}

export function stopImpersonation(): boolean {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    useAuthStore.getState().logout();
    return false;
  }
  try {
    const snap = JSON.parse(raw) as ImpersonationOriginalSnapshot;
    sessionStorage.removeItem(STORAGE_KEY);
    if (snap.user && snap.accessToken && snap.refreshToken) {
      useAuthStore.getState().setAuth(snap.user, snap.accessToken, snap.refreshToken);
      return true;
    }
  } catch {
    /* fall through */
  }
  useAuthStore.getState().logout();
  return false;
}

export function hasImpersonationSnapshot(): boolean {
  return Boolean(sessionStorage.getItem(STORAGE_KEY));
}
