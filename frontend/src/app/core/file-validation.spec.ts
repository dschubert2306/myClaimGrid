import { describe, expect, it } from 'vitest';
import { formatFileSize, validatePdf } from './file-validation';

const file = (name: string, type: string, size: number) => ({ name, type, size });

describe('validatePdf', () => {
  it('accepts a PDF up to 10 MB', () => {
    expect(validatePdf(file('Rechnung.pdf', 'application/pdf', 412_000))).toBeNull();
    expect(validatePdf(file('RECHNUNG.PDF', 'application/pdf', 10 * 1024 * 1024))).toBeNull();
    // Some browsers report no MIME type for a file picked from disk.
    expect(validatePdf(file('Rechnung.pdf', '', 1000))).toBeNull();
  });

  it('rejects other types', () => {
    expect(validatePdf(file('foto.png', 'image/png', 1000))).toBe('type');
    expect(validatePdf(file('Rechnung.pdf', 'image/png', 1000))).toBe('type');
    expect(validatePdf(file('Rechnung', 'application/pdf', 1000))).toBe('type');
  });

  it('rejects empty and too large files', () => {
    expect(validatePdf(file('a.pdf', 'application/pdf', 0))).toBe('size');
    expect(validatePdf(file('a.pdf', 'application/pdf', 10 * 1024 * 1024 + 1))).toBe('size');
  });
});

describe('formatFileSize', () => {
  it('shows KB below 1 MB and MB above', () => {
    expect(formatFileSize(412_000, 'de-DE')).toBe('402 KB');
    expect(formatFileSize(1, 'de-DE')).toBe('1 KB');
    expect(formatFileSize(2_621_440, 'de-DE')).toBe('2,5 MB');
    expect(formatFileSize(2_621_440, 'en-GB')).toBe('2.5 MB');
  });
});
