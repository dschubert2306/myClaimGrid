import type { ReimbursementEntry } from '@myclaimgrid/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMATS } from './date-format';
import {
  entryPreview,
  parseCentsInput,
  suggestedAmount,
  toEntryRequest,
  type EntryFormValues,
} from './entry-form';

const DE = DEFAULT_FORMATS['de-DE'];
const EN = DEFAULT_FORMATS['en-GB'];

const paid = (
  reimbursedAmount: number,
  rejectedAmount: number | null = null,
): ReimbursementEntry => ({
  entryId: crypto.randomUUID(),
  status: 'PARTLY_PAID',
  date: '2026-04-01',
  reimbursedAmount,
  rejectedAmount,
  note: '',
  documents: [],
  createdAt: '2026-04-01T10:00:00.000Z',
});

const context = { amount: 10000, entries: [paid(6000)] };
const values = (overrides: Partial<EntryFormValues>): EntryFormValues => ({
  status: 'PARTLY_PAID',
  date: '15.04.2026',
  reimbursedAmount: '',
  rejectedAmount: '',
  note: '',
  ...overrides,
});

describe('parseCentsInput', () => {
  it('allows zero, rejects negatives and unclear input, and is null when empty', () => {
    expect(parseCentsInput('', 'de-DE')).toBeNull();
    expect(parseCentsInput('0', 'de-DE')).toBe(0);
    expect(parseCentsInput('0,00', 'de-DE')).toBe(0);
    expect(parseCentsInput('1.234,56', 'de-DE')).toBe(123456);
    expect(parseCentsInput('1,234.56', 'en-GB')).toBe(123456);
    expect(parseCentsInput('-5', 'de-DE')).toBe('invalid');
    expect(parseCentsInput('12.5', 'de-DE')).toBe('invalid');
  });
});

describe('toEntryRequest', () => {
  it('builds a partial reimbursement with ISO date and cents', () => {
    expect(
      toEntryRequest(
        values({ reimbursedAmount: '30,00', rejectedAmount: '5', note: ' Brief ' }),
        DE,
        context,
      ),
    ).toEqual({
      ok: true,
      request: {
        status: 'PARTLY_PAID',
        date: '2026-04-15',
        reimbursedAmount: 3000,
        rejectedAmount: 500,
        note: 'Brief',
      },
    });
  });

  it('sends no amounts for statuses without a payment, even if some were typed', () => {
    const result = toEntryRequest(
      values({ status: 'IN_PROGRESS', reimbursedAmount: '10', date: '04/15/2026' }),
      { ...EN, dateFormat: 'MM/dd/yyyy' },
      context,
    );
    expect(result).toEqual({
      ok: true,
      request: { status: 'IN_PROGRESS', date: '2026-04-15', note: '' },
    });
  });

  it('requires the reimbursed amount for payments and checks it against the invoice', () => {
    expect(toEntryRequest(values({}), DE, context)).toEqual({
      ok: false,
      errors: { reimbursedAmount: 'required' },
    });
    expect(toEntryRequest(values({ reimbursedAmount: '40,01' }), DE, context)).toEqual({
      ok: false,
      errors: { reimbursedAmount: 'aboveInvoice' },
    });
    expect(
      toEntryRequest(values({ reimbursedAmount: '35', rejectedAmount: '5,01' }), DE, context),
    ).toEqual({ ok: false, errors: { reimbursedAmount: 'aboveInvoice' } });
    expect(toEntryRequest(values({ reimbursedAmount: '40' }), DE, context).ok).toBe(true);
  });

  it('reports invalid dates and amounts together', () => {
    expect(
      toEntryRequest(
        values({ date: '31.02.2026', reimbursedAmount: '-1', rejectedAmount: 'abc' }),
        DE,
        context,
      ),
    ).toEqual({
      ok: false,
      errors: { date: 'date', reimbursedAmount: 'cents', rejectedAmount: 'cents' },
    });
  });
});

describe('entryPreview and suggestedAmount', () => {
  it('shows the total reimbursed after this entry and the difference to the invoice', () => {
    expect(entryPreview(values({ reimbursedAmount: '25' }), 'de-DE', context)).toEqual({
      reimbursed: 8500,
      difference: 1500,
    });
    expect(entryPreview(values({ status: 'IN_PROGRESS' }), 'de-DE', context)).toBeNull();
  });

  it('suggests the rest for a final payment only', () => {
    expect(suggestedAmount('PAID', { amount: 10000, entries: [paid(6000, 500)] })).toBe(3500);
    expect(suggestedAmount('PARTLY_PAID', context)).toBeNull();
  });
});
