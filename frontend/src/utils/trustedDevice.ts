/**
 * Persistencia local del token de "este dispositivo de confianza" para 2FA.
 *
 * Guardamos el token plaintext en localStorage. El backend solo guarda su hash
 * SHA-256, así que perder el token solo hace que la próxima vez se pida MFA.
 * Validez 30 días (la fija el backend), no lo controlamos acá.
 *
 * Por simplicidad usamos una sola key (no multi-cuenta en el mismo navegador).
 * Si se necesita: cambiar a key por email.
 */

const KEY = 'nexo_trusted_device_token';

export function loadTrustedDeviceToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveTrustedDeviceToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* no-op */
  }
}

export function clearTrustedDeviceToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
