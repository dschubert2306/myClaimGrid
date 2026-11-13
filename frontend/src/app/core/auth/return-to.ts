import { STORAGE_KEYS, storageGet, storageRemove, storageSet, storageTake } from '../storage';

/** Only in-app paths are accepted, so a stored value can never redirect to another site. */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (value.startsWith('/login') || value.startsWith('/auth/')) return '/';
  return value;
}

export function rememberReturnTo(url: string): void {
  const safe = sanitizeReturnTo(url);
  if (safe === '/') storageRemove('session', STORAGE_KEYS.returnTo);
  else storageSet('session', STORAGE_KEYS.returnTo, safe);
}

export function takeReturnTo(): string {
  return sanitizeReturnTo(storageTake('session', STORAGE_KEYS.returnTo));
}

export function peekReturnTo(): string {
  return sanitizeReturnTo(storageGet('session', STORAGE_KEYS.returnTo));
}
