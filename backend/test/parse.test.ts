import { describe, expect, it } from 'vitest';
import { parseAmountToCents, parseInvoiceDate } from '../src/lib/parse';

describe('parseAmountToCents', () => {
  it.each([
    ['1.234,56', 123456],
    ['1.234,56 €', 123456],
    ['€ 1.234,56', 123456],
    ['EUR 1,234.56', 123456],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['12,5', 1250],
    ['12,50', 1250],
    ['0,99', 99],
    ['75', 7500],
    ['1.234', 123400],
    ['12,345', 1234500],
    ['1.234.567,89', 123456789],
    ['12 345,67 €', 1234567],
  ])('parses %s as %i cents', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '0,00', '-12,00', '(12,00)', '12,345,6', '1.23.456', '1,234.567,89', 'N/A'])(
    'does not guess for %j',
    (input) => {
      expect(parseAmountToCents(input)).toBeNull();
    },
  );
});

describe('parseInvoiceDate', () => {
  it.each([
    ['12.03.2026', '2026-03-12'],
    ['1.3.2026', '2026-03-01'],
    ['12.03.26', '2026-03-12'],
    ['Datum: 12.03.2026', '2026-03-12'],
    ['2026-03-12', '2026-03-12'],
    ['12/03/2026', '2026-03-12'],
    ['12. März 2026', '2026-03-12'],
    ['5 January 2026', '2026-01-05'],
    ['29.02.2024', '2024-02-29'],
  ])('parses %s as %s', (input, iso) => {
    expect(parseInvoiceDate(input)).toBe(iso);
  });

  it.each(['', 'kein Datum', '31.02.2026', '12.13.2026', '2026-02-30', '12. Foo 2026'])(
    'does not guess for %j',
    (input) => {
      expect(parseInvoiceDate(input)).toBeNull();
    },
  );
});
