import type { AppLocale, Lang } from './locale';

/** Date and time formats the user can pick in the settings. Pure functions, no Angular. */

export const DATE_FORMATS = ['dd.MM.yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
/** "auto" follows the language (12.03.2026 in German, 12/03/2026 in English). */
export type DatePreference = 'auto' | DateFormat;

export const TIME_FORMATS = ['24h', '12h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
export type TimePreference = 'auto' | TimeFormat;

export const isDateFormat = (value: unknown): value is DateFormat =>
  (DATE_FORMATS as readonly unknown[]).includes(value);
export const isDatePreference = (value: unknown): value is DatePreference =>
  value === 'auto' || isDateFormat(value);
export const isTimePreference = (value: unknown): value is TimePreference =>
  value === 'auto' || value === '24h' || value === '12h';

export function resolveDateFormat(preference: DatePreference, locale: AppLocale): DateFormat {
  if (preference !== 'auto') return preference;
  return locale === 'de-DE' ? 'dd.MM.yyyy' : 'dd/MM/yyyy';
}

export function resolveTimeFormat(preference: TimePreference, locale: AppLocale): TimeFormat {
  if (preference !== 'auto') return preference;
  return locale === 'de-DE' ? '24h' : '12h';
}

/** What the amount and date helpers need: the number locale and the date pattern. */
export interface Formats {
  locale: AppLocale;
  dateFormat: DateFormat;
}

export const DEFAULT_FORMATS: Record<AppLocale, Formats> = {
  'de-DE': { locale: 'de-DE', dateFormat: 'dd.MM.yyyy' },
  'en-GB': { locale: 'en-GB', dateFormat: 'dd/MM/yyyy' },
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Separator and field order of a pattern, for formatting and parsing. */
export function describeDateFormat(format: DateFormat): {
  separator: string;
  order: ('d' | 'M' | 'y')[];
} {
  const separator = format.includes('.') ? '.' : format.includes('/') ? '/' : '-';
  const order = format
    .split(separator)
    .map((part) => (part[0] === 'd' ? 'd' : part[0] === 'M' ? 'M' : 'y')) as ('d' | 'M' | 'y')[];
  return { separator, order };
}

/** "2026-03-12" -> "12.03.2026" and so on. */
export function formatIsoDate(iso: string, format: DateFormat): string {
  const [y = '', m = '', d = ''] = iso.split('-');
  const { separator, order } = describeDateFormat(format);
  return order.map((part) => (part === 'd' ? d : part === 'M' ? m : y)).join(separator);
}

/** "TT.MM.JJJJ" / "DD/MM/YYYY": the pattern written for people. */
export function datePlaceholder(format: DateFormat, lang: Lang): string {
  const words = lang === 'de' ? { d: 'TT', M: 'MM', y: 'JJJJ' } : { d: 'DD', M: 'MM', y: 'YYYY' };
  const { separator, order } = describeDateFormat(format);
  return order.map((part) => words[part]).join(separator);
}

/** 14:05 (24h) or 2:05 pm (12h). */
export function formatTime(date: Date, format: TimeFormat): string {
  const hours = date.getHours();
  const minutes = pad(date.getMinutes());
  if (format === '24h') return `${pad(hours)}:${minutes}`;
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
}

/** Today as ISO date in local time (not UTC, so late evening does not show tomorrow). */
export function todayIso(now = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ----------------------------------------------------------------- calendar

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
}

const fromParts = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));
const toIsoUtc = (date: Date) =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** "2026-03-12" -> { year: 2026, month: 3, day: 12 } (month 1 to 12). */
export function splitIso(iso: string): { year: number; month: number; day: number } {
  const [y = 0, m = 0, d = 0] = iso.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Adds days (UTC math, so daylight saving time cannot skip or repeat a day). */
export function addDays(iso: string, days: number): string {
  const { year, month, day } = splitIso(iso);
  return toIsoUtc(fromParts(year, month - 1, day + days));
}

/** Adds months and keeps the day when possible (31 March + 1 month = 30 April). */
export function addMonths(iso: string, months: number): string {
  const { year, month, day } = splitIso(iso);
  const target = fromParts(year, month - 1 + months, 1);
  const last = fromParts(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate();
  return toIsoUtc(fromParts(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last)));
}

/** Six weeks starting on Monday that contain the month, 42 days. */
export function monthGrid(year: number, month: number): CalendarDay[] {
  const first = fromParts(year, month - 1, 1);
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  return Array.from({ length: 42 }, (_, index) => {
    const date = fromParts(year, month - 1, 1 - offset + index);
    return {
      iso: toIsoUtc(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1,
    };
  });
}
