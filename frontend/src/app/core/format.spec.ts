import { describe, expect, it } from 'vitest';
import {
  DATE_FORMATS,
  addDays,
  addMonths,
  datePlaceholder,
  formatTime,
  monthGrid,
} from './date-format';
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
    expect(formatInvoiceDate('2026-03-12', 'dd.MM.yyyy')).toBe('12.03.2026');
    expect(formatInvoiceDate('2026-03-12', 'dd/MM/yyyy')).toBe('12/03/2026');
    expect(formatInvoiceDate('2026-03-12', 'MM/dd/yyyy')).toBe('03/12/2026');
    expect(formatInvoiceDate('2026-03-12', 'yyyy-MM-dd')).toBe('2026-03-12');
    expect(formatInvoiceDate('2026-01-05', 'dd.MM.yyyy')).toBe('05.01.2026');
  });

  it('formats times in 24 hour and 12 hour style', () => {
    expect(formatTime(new Date(2026, 2, 12, 14, 5), '24h')).toBe('14:05');
    expect(formatTime(new Date(2026, 2, 12, 14, 5), '12h')).toBe('2:05 pm');
    expect(formatTime(new Date(2026, 2, 12, 0, 0), '12h')).toBe('12:00 am');
    expect(formatTime(new Date(2026, 2, 12, 12, 30), '12h')).toBe('12:30 pm');
    expect(formatTime(new Date(2026, 2, 12, 0, 7), '24h')).toBe('00:07');
  });

  it('writes the date pattern for people in the active language', () => {
    expect(datePlaceholder('dd.MM.yyyy', 'de')).toBe('TT.MM.JJJJ');
    expect(datePlaceholder('MM/dd/yyyy', 'en')).toBe('MM/DD/YYYY');
    expect(datePlaceholder('yyyy-MM-dd', 'de')).toBe('JJJJ-MM-TT');
  });

  it('round-trips with the parsers (what is shown can be typed back)', () => {
    for (const locale of ['de-DE', 'en-GB'] as const) {
      for (const cents of [1, 99, 100, 8940, 123456, 123456789]) {
        expect(parseAmountInput(formatAmountPlain(cents, locale), locale)).toBe(cents);
      }
    }
    for (const format of DATE_FORMATS) {
      expect(parseDateInput(formatInvoiceDate('2026-03-12', format), format)).toBe('2026-03-12');
      expect(parseDateInput(formatInvoiceDate('2026-01-05', format), format)).toBe('2026-01-05');
    }
  });
});

describe('calendar helpers', () => {
  it('builds six Monday-first weeks around the month', () => {
    const grid = monthGrid(2026, 3); // 1 March 2026 is a Sunday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ iso: '2026-02-23', day: 23, inMonth: false });
    expect(grid[6]).toEqual({ iso: '2026-03-01', day: 1, inMonth: true });
    expect(grid.filter((d) => d.inMonth)).toHaveLength(31);
  });

  it('adds days and months across month, year and leap day boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });
});
