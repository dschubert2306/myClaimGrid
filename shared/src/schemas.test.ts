import { describe, expect, it } from 'vitest';
import { claimFieldsSchema, createManualClaimRequestSchema, isoDateSchema } from './schemas';

describe('isoDateSchema', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isoDateSchema.safeParse('2026-03-12').success).toBe(true);
    expect(isoDateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false);
    expect(isoDateSchema.safeParse('12.03.2026').success).toBe(false);
  });
});

describe('claimFieldsSchema', () => {
  const valid = { provider: 'Praxis Dr. Muster', invoiceDate: '2026-03-12', amount: 12345 };

  it('applies defaults for optional text fields', () => {
    expect(claimFieldsSchema.parse(valid)).toEqual({
      ...valid,
      invoiceNumber: '',
      description: '',
    });
  });

  it('rejects zero, negative and fractional amounts', () => {
    for (const amount of [0, -1, 12.5]) {
      expect(claimFieldsSchema.safeParse({ ...valid, amount }).success).toBe(false);
    }
  });

  it('rejects unknown fields, bank data included', () => {
    expect(claimFieldsSchema.safeParse({ ...valid, iban: 'DE00' }).success).toBe(false);
    expect(
      createManualClaimRequestSchema.safeParse({
        ...valid,
        personId: crypto.randomUUID(),
        bic: 'XXXX',
      }).success,
    ).toBe(false);
  });
});
