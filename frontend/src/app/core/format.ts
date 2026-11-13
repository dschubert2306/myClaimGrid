import { formatCurrency, formatNumber } from '@angular/common';
import { formatIsoDate, type DateFormat } from './date-format';
import './locale'; // registers the locale data used below
import type { AppLocale } from './locale';

/** 123456 -> "1.234,56 €" (de-DE) or "€1,234.56" (en-GB). Amounts are integer cents. */
export function formatAmount(cents: number, locale: AppLocale): string {
  return formatCurrency(cents / 100, locale, '€', 'EUR', '1.2-2');
}

/** 123456 -> "1.234,56" or "1,234.56", for the amount input (the € sign sits beside it). */
export function formatAmountPlain(cents: number, locale: AppLocale): string {
  return formatNumber(cents / 100, locale, '1.2-2');
}

/** "2026-03-12" -> "12.03.2026", "12/03/2026", "03/12/2026" or "2026-03-12", four digit year. */
export function formatInvoiceDate(iso: string, format: DateFormat): string {
  return formatIsoDate(iso, format);
}
