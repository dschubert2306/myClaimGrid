import { isoDateSchema } from '@myclaimgrid/shared';

/**
 * Locale independent parsing of values read from invoices.
 * Both functions return null instead of guessing when the input is not clear.
 */

/** "1.234,56 €", "EUR 1,234.56", "12,5", "1234.56" -> integer cents. Returns null for zero, negatives and unclear input. */
export function parseAmountToCents(input: string): number | null {
  const text = input.replace(/[\s\u00a0\u202f]/g, '').replace(/EUR|€/gi, '');
  if (!/^[0-9.,]+$/.test(text)) return null; // also rejects "-12,00" and "(12,00)"
  if (!/\d/.test(text)) return null;

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let decimalIndex = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalIndex = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = text.split(sep).length - 1;
    const index = text.lastIndexOf(sep);
    const digitsAfter = text.length - index - 1;
    // One separator followed by 3 digits reads as a thousands separator ("1.234", "1,234").
    // Several separators are always thousands separators.
    if (count === 1 && digitsAfter !== 3) decimalIndex = index;
  }

  const integerRaw = decimalIndex >= 0 ? text.slice(0, decimalIndex) : text;
  // Thousands separators must be of one kind and group exactly three digits ("1.234.567").
  if (/[.,]/.test(integerRaw) && !/^\d{1,3}(?:\.\d{3})+$|^\d{1,3}(?:,\d{3})+$/.test(integerRaw)) {
    return null;
  }
  const integerPart = integerRaw.replace(/[.,]/g, '');
  const fractionPart = decimalIndex >= 0 ? text.slice(decimalIndex + 1) : '';
  if (!/^\d*$/.test(fractionPart) || fractionPart.length > 2) return null;
  if (integerPart === '' && fractionPart === '') return null;

  const cents = Number(integerPart || '0') * 100 + Number(fractionPart.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  january: 1,
  februar: 2,
  feb: 2,
  february: 2,
  märz: 3,
  maerz: 3,
  marz: 3,
  mär: 3,
  mar: 3,
  march: 3,
  april: 4,
  apr: 4,
  mai: 5,
  may: 5,
  juni: 6,
  jun: 6,
  june: 6,
  juli: 7,
  jul: 7,
  july: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  oct: 10,
  october: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
  dec: 12,
  december: 12,
};

function toIso(year: number, month: number, day: number): string | null {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isoDateSchema.safeParse(iso).success ? iso : null;
}

/**
 * "12.03.2026", "12.3.26", "2026-03-12", "12/03/2026", "12. März 2026" -> "2026-03-12".
 * Numeric formats with separators are read day first, as on German invoices.
 */
export function parseInvoiceDate(input: string): string | null {
  const text = input.replace(/\s+/g, ' ').trim();

  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/.exec(text);
  if (numeric) {
    const rawYear = numeric[3] as string;
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    return toIso(year, Number(numeric[2]), Number(numeric[1]));
  }

  const named = /\b(\d{1,2})\.?\s*([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})\b/.exec(text);
  if (named) {
    const month = MONTHS[(named[2] as string).toLowerCase()];
    if (month) return toIso(Number(named[3]), month, Number(named[1]));
  }

  return null;
}
