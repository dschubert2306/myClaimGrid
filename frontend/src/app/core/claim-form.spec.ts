import { DEFAULT_FORMATS } from './date-format';
import type { Claim } from '@myclaimgrid/shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CLAIM_FORM,
  fieldMarkers,
  fromClaim,
  toClaimFields,
  validateField,
} from './claim-form';

const DE = DEFAULT_FORMATS['de-DE'];
const EN = DEFAULT_FORMATS['en-GB'];

const valid = {
  provider: ' Praxis Dr. Huber ',
  invoiceNumber: 'RE-2026-00417',
  invoiceDate: '12.03.2026',
  amount: '1.234,56',
  description: '',
};

const claim = (overrides: Partial<Claim> = {}): Claim => ({
  claimId: '11111111-1111-4111-8111-111111111111',
  personId: '22222222-2222-4222-8222-222222222222',
  status: 'DRAFT',
  source: 'EXTRACTED',
  year: 2026,
  provider: 'Praxis Dr. Huber',
  invoiceNumber: null,
  invoiceDate: '2026-03-12',
  amount: 8940,
  currency: 'EUR',
  description: null,
  hasPdf: true,
  extractionStatus: 'DONE',
  extraction: { confidence: { provider: 98, invoiceDate: 97, amount: 93 } },
  createdAt: '2026-03-12T10:00:00.000Z',
  updatedAt: '2026-03-12T10:00:00.000Z',
  ...overrides,
});

describe('validateField', () => {
  it('requires provider, date and amount, but not invoice number or description', () => {
    expect(validateField('provider', ' ', DE)).toBe('required');
    expect(validateField('invoiceDate', '', DE)).toBe('required');
    expect(validateField('amount', '', DE)).toBe('required');
    expect(validateField('invoiceNumber', '', DE)).toBeNull();
    expect(validateField('description', '', DE)).toBeNull();
  });

  it('checks the date and the amount in the format of the language', () => {
    expect(validateField('invoiceDate', '31.02.2026', DE)).toBe('date');
    expect(validateField('invoiceDate', '12/03/2026', EN)).toBeNull();
    expect(validateField('amount', '0,00', DE)).toBe('amount');
    expect(validateField('amount', '12.5', DE)).toBe('amount');
    expect(validateField('amount', '12.50', EN)).toBeNull();
  });

  it('limits the length', () => {
    expect(validateField('provider', 'x'.repeat(201), DE)).toBe('maxLength');
    expect(validateField('description', 'x'.repeat(501), DE)).toBe('maxLength');
  });
});

describe('toClaimFields', () => {
  it('converts what the user sees to ISO date and integer cents', () => {
    expect(toClaimFields(valid, DE)).toEqual({
      ok: true,
      fields: {
        provider: 'Praxis Dr. Huber',
        invoiceNumber: 'RE-2026-00417',
        invoiceDate: '2026-03-12',
        amount: 123456,
        description: '',
      },
    });
  });

  it('reports every invalid field at once and never sends the form', () => {
    const result = toClaimFields(
      { ...EMPTY_CLAIM_FORM, invoiceDate: '99.99.2026', amount: '-3' },
      DE,
    );
    expect(result).toEqual({
      ok: false,
      errors: { provider: 'required', invoiceDate: 'date', amount: 'amount' },
    });
  });

  it('has no bank data field, the API shape is exactly five fields', () => {
    const result = toClaimFields(valid, DE);
    expect(result.ok && Object.keys(result.fields).sort()).toEqual(
      ['amount', 'description', 'invoiceDate', 'invoiceNumber', 'provider'].sort(),
    );
  });
});

describe('fromClaim and fieldMarkers', () => {
  it('shows extracted values in the language format and leaves missing ones empty', () => {
    expect(fromClaim(claim(), DE)).toEqual({
      provider: 'Praxis Dr. Huber',
      invoiceNumber: '',
      invoiceDate: '12.03.2026',
      amount: '89,40',
      description: '',
    });
    expect(fromClaim(claim(), EN).invoiceDate).toBe('12/03/2026');
  });

  it('tags extracted fields and marks the others as not recognised after a finished extraction', () => {
    expect(fieldMarkers(claim())).toEqual({
      extracted: ['provider', 'invoiceDate', 'amount'],
      missing: ['invoiceNumber'],
    });
  });

  it('marks nothing for failed, pending or manual claims', () => {
    const none = { extracted: [], missing: [] };
    expect(fieldMarkers(claim({ extractionStatus: 'FAILED' }))).toEqual(none);
    expect(fieldMarkers(claim({ extractionStatus: 'PENDING' }))).toEqual(none);
    expect(
      fieldMarkers(claim({ source: 'MANUAL', extractionStatus: null, extraction: null })),
    ).toEqual(none);
  });
});
