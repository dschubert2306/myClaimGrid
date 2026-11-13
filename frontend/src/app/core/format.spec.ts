import { describe, expect, it } from 'vitest';
import { formatAmount, formatAmountPlain, formatInvoiceDate } from './format';
import { parseAmountInput, parseDateInput } from './parse-input';

// Intl uses a no-break space before the euro sign in German.
const nbsp = (text: string) => text.replace(/\u00a0/g, ' ');

describe('formatting follows the active language', () => {
  it('formats amounts', () => {
    expect(nbsp(formatAmount(123456, 'de-DE'))).toBe('1.234,56 €');
    expect(formatAmount(123456, 'en-GB')).toBe('€1,234.56');
    expect(nbsp(formatAmount(0, 'de-DE'))).toBe('0,00 €');
    expect(nbsp(formatAmount(8940, 'de-DE'))).toBe('89,40 €');
  });

  it('formats plain amounts for the input', () => {
    expect(formatAmountPlain(123456, 'de-DE')).toBe('1.234,56');
    expect(formatAmountPlain(123456, 'en-GB')).toBe('1,234.56');
  });

  it('formats dates with a four digit year', () => {
    expect(formatInvoiceDate('2026-03-12', 'de-DE')).toBe('12.03.2026');
    expect(formatInvoiceDate('2026-03-12', 'en-GB')).toBe('12/03/2026');
    expect(formatInvoiceDate('2026-01-05', 'de-DE')).toBe('05.01.2026');
  });

  it('round-trips with the parsers (what is shown can be typed back)', () => {
    for (const locale of ['de-DE', 'en-GB'] as const) {
      for (const cents of [1, 99, 100, 8940, 123456, 123456789]) {
        expect(parseAmountInput(formatAmountPlain(cents, locale), locale)).toBe(cents);
      }
      expect(parseDateInput(formatInvoiceDate('2026-03-12', locale), locale)).toBe('2026-03-12');
    }
  });
});
