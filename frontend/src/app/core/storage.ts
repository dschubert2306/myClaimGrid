/** Browser storage that never throws (private mode, blocked site data, previews). */
type Kind = 'local' | 'session';

function area(kind: Kind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function storageGet(kind: Kind, key: string): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(kind: Kind, key: string, value: string): void {
  try {
    area(kind)?.setItem(key, value);
  } catch {
    /* the page works without storage */
  }
}

export function storageRemove(kind: Kind, key: string): void {
  try {
    area(kind)?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Reads a value once and removes it. */
export function storageTake(kind: Kind, key: string): string | null {
  const value = storageGet(kind, key);
  if (value !== null) storageRemove(kind, key);
  return value;
}

export const STORAGE_KEYS = {
  theme: 'mcg.theme',
  language: 'mcg.lang',
  dateFormat: 'mcg.dateFormat',
  timeFormat: 'mcg.timeFormat',
  returnTo: 'mcg.returnTo',
  signedOut: 'mcg.signedOut',
  session: 'mcg.session',
} as const;
