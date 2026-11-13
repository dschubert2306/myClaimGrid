import type { AppLocale } from './locale';

/** Parsing of what the user types, in the format of the active language. */

const MAX_CENTS = 10_000_000_000; // matches the API (100 million euros)

/**
 * "1.234,56" (de) or "1,234.56" (en) -> integer cents. Returns null for anything unclear,
 * zero and negative values included. "12.5" in German is not guessed, it is invalid.
 */
export function parseAmountInput(input: string, locale: AppLocale): number | null {
  const text = input.replace(/[\s\u00a0\u202f]/g, '').replace(/EUR|€/gi, '');
  const thousands = locale === 'de-DE' ? '\\.' : ',';
  const decimal = locale === 'de-DE' ? ',' : '\\.';
  const pattern = new RegExp(`^(?:\\d{1,3}(?:${thousands}\\d{3})+|\\d+)(?:${decimal}(\\d{1,2}))?$`);
  const match = pattern.exec(text);
  if (!match) return null;

  const decimalChar = locale === 'de-DE' ? ',' : '.';
  const thousandsChar = locale === 'de-DE' ? '.' : ',';
  const [integerPart = '', fraction = ''] = text.split(decimalChar);
  const euros = Number(integerPart.split(thousandsChar).join(''));
  const cents = euros * 100 + Number(fraction.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTS ? cents : null;
}

function toIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** "12.03.2026" (de) or "12/03/2026" (en) or "2026-03-12" -> "2026-03-12". Null if not a real date. */
export function parseDateInput(input: string, locale: AppLocale): string | null {
  const text = input.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const separator = locale === 'de-DE' ? '\\.' : '/';
  const local = new RegExp(`^(\\d{1,2})${separator}(\\d{1,2})${separator}(\\d{4}|\\d{2})$`).exec(
    text,
  );
  if (!local) return null;
  const rawYear = local[3] as string;
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  return toIso(year, Number(local[2]), Number(local[1]));
}
