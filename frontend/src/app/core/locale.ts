import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localeEnGb from '@angular/common/locales/en-GB';

export type Lang = 'de' | 'en';
export type AppLocale = 'de-DE' | 'en-GB';

export const LANGS: readonly Lang[] = ['de', 'en'];
export const LOCALES: Record<Lang, AppLocale> = { de: 'de-DE', en: 'en-GB' };

registerLocaleData(localeDe, 'de-DE');
registerLocaleData(localeEnGb, 'en-GB');

export function isLang(value: unknown): value is Lang {
  return value === 'de' || value === 'en';
}

/** Stored choice first, then the browser language, English otherwise. */
export function initialLang(stored: string | null, browser: string | undefined): Lang {
  if (isLang(stored)) return stored;
  return browser?.toLowerCase().startsWith('de') ? 'de' : 'en';
}
