import { formatCurrency, formatDate, formatNumber } from '@angular/common';
import './locale'; // registers the locale data used below
import type { AppLocale } from './locale';

/** Dates in the format of the language. The built-in shortDate shows a two-digit year. */
export const DATE_FORMATS: Record<AppLocale, string> = {
  'de-DE': 'dd.MM.yyyy',
  'en-GB': 'dd/MM/yyyy',
};

/** 123456 -> "1.234,56 €" (de-DE) or "€1,234.56" (en-GB). Amounts are integer cents. */
export function formatAmount(cents: number, locale: AppLocale): string {
  return formatCurrency(cents / 100, locale, '€', 'EUR', '1.2-2');
}

/** 123456 -> "1.234,56" or "1,234.56", for the amount input (the € sign sits beside it). */
export function formatAmountPlain(cents: number, locale: AppLocale): string {
  return formatNumber(cents / 100, locale, '1.2-2');
}

/** "2026-03-12" -> "12.03.2026" or "12/03/2026". */
export function formatInvoiceDate(iso: string, locale: AppLocale): string {
  return formatDate(iso, DATE_FORMATS[locale], locale);
}
