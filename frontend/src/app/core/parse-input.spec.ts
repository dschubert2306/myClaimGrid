import { describe, expect, it } from 'vitest';
import { parseAmountInput, parseDateInput } from './parse-input';

describe('parseAmountInput', () => {
  it.each([
    ['1.234,56', 'de-DE', 123456],
    ['1.234,56 €', 'de-DE', 123456],
    ['€ 89,40', 'de-DE', 8940],
    ['1234,56', 'de-DE', 123456],
    ['12,5', 'de-DE', 1250],
    ['75', 'de-DE', 7500],
    ['1.234', 'de-DE', 123400],
    ['1.234.567,89', 'de-DE', 123456789],
    ['1,234.56', 'en-GB', 123456],
    ['€1,234.56', 'en-GB', 123456],
    ['12.5', 'en-GB', 1250],
    ['1234.56', 'en-GB', 123456],
    ['0,01', 'de-DE', 1],
  ] as const)('reads %s (%s) as %i cents', (input, locale, cents) => {
    expect(parseAmountInput(input, locale)).toBe(cents);
  });

  it.each([
    ['', 'de-DE'],
    ['abc', 'de-DE'],
    ['0', 'de-DE'],
    ['0,00', 'de-DE'],
    ['-5,00', 'de-DE'],
    ['12.5', 'de-DE'], // not guessed: in German the dot is a thousands separator
    ['1,234.56', 'de-DE'], // the other language's format
    ['1.234,56', 'en-GB'],
    ['12,345,6', 'en-GB'],
    ['1,23,456', 'en-GB'],
    ['12,555', 'de-DE'], // a comma with three digits is not a German decimal
    ['99999999999', 'de-DE'],
  ] as const)('rejects %j (%s)', (input, locale) => {
    expect(parseAmountInput(input, locale)).toBeNull();
  });
});

describe('parseDateInput', () => {
  it.each([
    ['12.03.2026', 'de-DE', '2026-03-12'],
    ['1.3.2026', 'de-DE', '2026-03-01'],
    ['12.03.26', 'de-DE', '2026-03-12'],
    ['12/03/2026', 'en-GB', '2026-03-12'],
    ['2026-03-12', 'de-DE', '2026-03-12'],
    ['2026-03-12', 'en-GB', '2026-03-12'],
    ['29.02.2024', 'de-DE', '2024-02-29'],
  ] as const)('reads %s (%s) as %s', (input, locale, iso) => {
    expect(parseDateInput(input, locale)).toBe(iso);
  });

  it.each([
    ['', 'de-DE'],
    ['31.02.2026', 'de-DE'],
    ['29.02.2026', 'de-DE'],
    ['12.13.2026', 'de-DE'],
    ['12/03/2026', 'de-DE'], // the other language's separator
    ['12.03.2026', 'en-GB'],
    ['12.03.1800', 'de-DE'],
    ['hallo', 'de-DE'],
  ] as const)('rejects %j (%s)', (input, locale) => {
    expect(parseDateInput(input, locale)).toBeNull();
  });
});
