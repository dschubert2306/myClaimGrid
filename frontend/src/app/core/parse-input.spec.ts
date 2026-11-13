import { describe, expect, it } from 'vitest';
import { parseAmountInput, parseDateInput, parseDeductibleInput } from './parse-input';

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
    ['12.03.2026', 'dd.MM.yyyy', '2026-03-12'],
    ['1.3.2026', 'dd.MM.yyyy', '2026-03-01'],
    ['12.03.26', 'dd.MM.yyyy', '2026-03-12'],
    ['12/03/2026', 'dd/MM/yyyy', '2026-03-12'],
    ['03/12/2026', 'MM/dd/yyyy', '2026-03-12'],
    ['2026-03-12', 'yyyy-MM-dd', '2026-03-12'],
    ['2026-03-12', 'dd.MM.yyyy', '2026-03-12'], // ISO is always accepted
    ['29.02.2024', 'dd.MM.yyyy', '2024-02-29'],
  ] as const)('reads %s (%s) as %s', (input, format, iso) => {
    expect(parseDateInput(input, format)).toBe(iso);
  });

  it.each([
    ['', 'dd.MM.yyyy'],
    ['31.02.2026', 'dd.MM.yyyy'],
    ['29.02.2026', 'dd.MM.yyyy'],
    ['12.13.2026', 'dd.MM.yyyy'],
    ['13/12/2026', 'MM/dd/yyyy'], // month 13
    ['12/03/2026', 'dd.MM.yyyy'], // the other separator
    ['12.03.2026', 'dd/MM/yyyy'],
    ['12.03.1800', 'dd.MM.yyyy'],
    ['12.03.202', 'dd.MM.yyyy'], // three digit year
    ['hallo', 'dd.MM.yyyy'],
  ] as const)('rejects %j (%s)', (input, format) => {
    expect(parseDateInput(input, format)).toBeNull();
  });
});

describe('parseDeductibleInput', () => {
  it('reads an empty field and zero as no Selbstbehalt', () => {
    for (const input of ['', ' ', '0', '0,00', '0 €']) {
      expect(parseDeductibleInput(input, 'de-DE')).toBe(0);
    }
    expect(parseDeductibleInput('0.00', 'en-GB')).toBe(0);
  });

  it('reads amounts like the claim form does', () => {
    expect(parseDeductibleInput('500', 'de-DE')).toBe(50000);
    expect(parseDeductibleInput('1.250,50 €', 'de-DE')).toBe(125050);
    expect(parseDeductibleInput('1,250.50', 'en-GB')).toBe(125050);
  });

  it('rejects nonsense, negative values and more than the API allows', () => {
    for (const input of ['abc', '-5', '12.5', '100.001', '1.000.000']) {
      expect(parseDeductibleInput(input, 'de-DE')).toBeNull();
    }
  });
});
