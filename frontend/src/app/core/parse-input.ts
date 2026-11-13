import { describeDateFormat, type DateFormat } from './date-format';
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

const MAX_DEDUCTIBLE_CENTS = 10_000_000; // matches the API (100,000 euros)

/** Like parseAmountInput, but an empty field or zero is valid and means "no Selbstbehalt". */
export function parseDeductibleInput(input: string, locale: AppLocale): number | null {
  const text = input.replace(/[\s\u00a0\u202f]/g, '').replace(/EUR|€/gi, '');
  if (text === '' || /^0+(?:[.,]0{1,2})?$/.test(text)) return 0;
  const cents = parseAmountInput(text, locale);
  return cents !== null && cents <= MAX_DEDUCTIBLE_CENTS ? cents : null;
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

/**
 * Text in the chosen date format (or ISO "2026-03-12") -> "2026-03-12". Null if not a real date.
 * Day and month may have one digit, the year two or four digits.
 */
export function parseDateInput(input: string, format: DateFormat): string | null {
  const text = input.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const { separator, order } = describeDateFormat(format);
  const escaped = separator === '.' ? '\\.' : separator;
  const match = new RegExp(`^(\\d{1,4})${escaped}(\\d{1,2})${escaped}(\\d{1,4})$`).exec(text);
  if (!match) return null;
  const parts = { d: 0, M: 0, y: 0 };
  const raw = [match[1] as string, match[2] as string, match[3] as string];
  order.forEach((part, index) => (parts[part] = Number(raw[index])));
  const yearText = raw[order.indexOf('y')] as string;
  // The year has two or four digits, day and month at most two.
  if (yearText.length !== 2 && yearText.length !== 4) return null;
  if ((raw[order.indexOf('d')] as string).length > 2) return null;
  if ((raw[order.indexOf('M')] as string).length > 2) return null;
  const year = yearText.length === 2 ? 2000 + parts.y : parts.y;
  return toIso(year, parts.M, parts.d);
}
