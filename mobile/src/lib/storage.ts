import * as SecureStore from 'expo-secure-store';

import { AuthUser } from '../types';

const MOBILE_STATE_STORAGE_KEY = 'nexo-fitness.mobile.state';

export type PersistedMobileSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export type PersistedMobileState = {
  apiBaseUrl: string;
  tenantSlug: string;
  session: PersistedMobileSession | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPersistedMobileSession(value: unknown): value is PersistedMobileSession {
  if (!isRecord(value) || !isRecord(value.user)) {
    return false;
  }

  return (
    isNonEmptyString(value.accessToken) &&
    isNonEmptyString(value.refreshToken) &&
    isNonEmptyString(value.user.id) &&
    isNonEmptyString(value.user.email) &&
    isNonEmptyString(value.user.first_name) &&
    isNonEmptyString(value.user.last_name) &&
    isNonEmptyString(value.user.role) &&
    typeof value.user.is_active === 'boolean' &&
    typeof value.user.is_verified === 'boolean' &&
    isNonEmptyString(value.user.created_at)
  );
}

function isPersistedMobileState(value: unknown): value is PersistedMobileState {
  if (!isRecord(value) || !isNonEmptyString(value.apiBaseUrl) || !isNonEmptyString(value.tenantSlug)) {
    return false;
  }

  return value.session === null || isPersistedMobileSession(value.session);
}

async function canUseSecureStore() {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

function getWebStorage(): Storage | null {
  try {
    const webStorage = globalThis.localStorage;
    return webStorage ?? null;
  } catch {
    return null;
  }
}

async function readRawValue() {
  if (await canUseSecureStore()) {
    return SecureStore.getItemAsync(MOBILE_STATE_STORAGE_KEY);
  }

  return getWebStorage()?.getItem(MOBILE_STATE_STORAGE_KEY) ?? null;
}

async function writeRawValue(value: string) {
  if (await canUseSecureStore()) {
    await SecureStore.setItemAsync(MOBILE_STATE_STORAGE_KEY, value);
    return;
  }

  getWebStorage()?.setItem(MOBILE_STATE_STORAGE_KEY, value);
}

async function deleteRawValue() {
  if (await canUseSecureStore()) {
    await SecureStore.deleteItemAsync(MOBILE_STATE_STORAGE_KEY);
    return;
  }

  getWebStorage()?.removeItem(MOBILE_STATE_STORAGE_KEY);
}

export async function loadPersistedMobileState(): Promise<PersistedMobileState | null> {
  const rawValue = await readRawValue();
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    return isPersistedMobileState(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

export async function savePersistedMobileState(state: PersistedMobileState): Promise<void> {
  await writeRawValue(
    JSON.stringify({
      apiBaseUrl: state.apiBaseUrl.trim(),
      tenantSlug: state.tenantSlug.trim().toLowerCase(),
      session: state.session,
    }),
  );
}

export async function clearPersistedMobileState(): Promise<void> {
  await deleteRawValue();
}
