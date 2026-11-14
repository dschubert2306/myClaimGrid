import { describe, expect, it } from 'vitest';
import {
  checkNewEntry,
  currentStatus,
  matchesFilters,
  minimumInvoiceAmount,
  reimbursementTotals,
  remainingAmount,
  sortEntries,
  type EntryAmounts,
} from './reimbursement';
import { claimFieldsSchema, createEntryRequestSchema } from './schemas';

let clock = 0;
function entry(overrides: Partial<EntryAmounts> & Pick<EntryAmounts, 'status'>): EntryAmounts {
  clock += 1;
  return {
    date: '2026-04-01',
    reimbursedAmount: null,
    rejectedAmount: null,
    createdAt: `2026-04-01T10:00:${String(clock).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

describe('currentStatus', () => {
  it('is OPEN without history', () => {
    expect(currentStatus([])).toBe('OPEN');
  });

  it('follows the most recent entry by date, not by the order they were recorded', () => {
    const paid = entry({ status: 'PAID', date: '2026-05-10', reimbursedAmount: 100 });
    const backdated = entry({ status: 'IN_PROGRESS', date: '2026-04-02' });
    expect(currentStatus([paid, backdated])).toBe('PAID');
    expect(sortEntries([paid, backdated])).toEqual([backdated, paid]);
  });

  it('breaks ties on the same day by the time the entry was recorded', () => {
    const first = entry({ status: 'IN_PROGRESS', date: '2026-04-02' });
    const second = entry({ status: 'PARTLY_PAID', date: '2026-04-02', reimbursedAmount: 1 });
    expect(currentStatus([second, first])).toBe('PARTLY_PAID');
  });
});

describe('reimbursementTotals', () => {
  it('has the whole invoice outstanding while nothing happened', () => {
    expect(reimbursementTotals(10000, [])).toEqual({
      status: 'OPEN',
      reimbursed: 0,
      rejected: 0,
      outstanding: 10000,
      selfBorne: 0,
    });
  });

  it('adds up several partial reimbursements', () => {
    const entries = [
      entry({ status: 'IN_PROGRESS', date: '2026-04-01' }),
      entry({ status: 'PARTLY_PAID', date: '2026-04-15', reimbursedAmount: 3000 }),
      entry({ status: 'PARTLY_PAID', date: '2026-05-02', reimbursedAmount: 2500 }),
    ];
    expect(reimbursementTotals(10000, entries)).toEqual({
      status: 'PARTLY_PAID',
      reimbursed: 5500,
      rejected: 0,
      outstanding: 4500,
      selfBorne: 0,
    });
  });

  it('counts rejected amounts and deductibles as self-borne right away', () => {
    const entries = [
      entry({ status: 'PARTLY_PAID', reimbursedAmount: 6000, rejectedAmount: 1500 }),
    ];
    expect(reimbursementTotals(10000, entries)).toMatchObject({
      outstanding: 2500,
      selfBorne: 1500,
    });
  });

  it('closes the claim on PAID: the rest is self-borne, nothing stays outstanding', () => {
    const entries = [
      entry({ status: 'PARTLY_PAID', date: '2026-04-15', reimbursedAmount: 6000 }),
      entry({ status: 'PAID', date: '2026-05-02', reimbursedAmount: 3000, rejectedAmount: 500 }),
    ];
    const totals = reimbursementTotals(10000, entries);
    expect(totals).toEqual({
      status: 'PAID',
      reimbursed: 9000,
      rejected: 500,
      outstanding: 0,
      selfBorne: 1000,
    });
    // The three figures split the invoice amount without overlap.
    expect(totals.reimbursed + totals.outstanding + totals.selfBorne).toBe(10000);
  });

  it('records a full rejection as PAID with zero reimbursed', () => {
    const entries = [entry({ status: 'PAID', reimbursedAmount: 0, rejectedAmount: 10000 })];
    expect(reimbursementTotals(10000, entries)).toMatchObject({
      reimbursed: 0,
      outstanding: 0,
      selfBorne: 10000,
    });
  });

  it('treats a draft without amount as zero', () => {
    expect(reimbursementTotals(null, [])).toMatchObject({ outstanding: 0, selfBorne: 0 });
  });
});

describe('amount checks', () => {
  const history = [entry({ status: 'PARTLY_PAID', reimbursedAmount: 6000, rejectedAmount: 1000 })];

  it('computes what is left and what the invoice amount may not go below', () => {
    expect(remainingAmount(10000, history)).toBe(3000);
    expect(minimumInvoiceAmount(history)).toBe(7000);
    expect(remainingAmount(5000, history)).toBe(0);
  });

  it('allows reimbursing exactly the rest and rejects anything above the invoice amount', () => {
    expect(checkNewEntry(10000, history, { reimbursedAmount: 3000, rejectedAmount: null })).toBe(
      null,
    );
    expect(checkNewEntry(10000, history, { reimbursedAmount: 3001, rejectedAmount: null })).toBe(
      'amount_above_invoice',
    );
    expect(checkNewEntry(10000, history, { reimbursedAmount: 2000, rejectedAmount: 1001 })).toBe(
      'amount_above_invoice',
    );
    expect(checkNewEntry(10000, [], { reimbursedAmount: 10001, rejectedAmount: null })).toBe(
      'amount_above_invoice',
    );
  });
});

describe('createEntryRequestSchema', () => {
  const base = { date: '2026-04-15' };

  it('requires a reimbursed amount for PAID and PARTLY_PAID only', () => {
    expect(createEntryRequestSchema.safeParse({ ...base, status: 'PAID' }).success).toBe(false);
    expect(
      createEntryRequestSchema.safeParse({ ...base, status: 'PARTLY_PAID', reimbursedAmount: 0 })
        .success,
    ).toBe(true);
    expect(
      createEntryRequestSchema.safeParse({ ...base, status: 'IN_PROGRESS', reimbursedAmount: 100 })
        .success,
    ).toBe(false);
    expect(
      createEntryRequestSchema.safeParse({ ...base, status: 'OPEN', rejectedAmount: 100 }).success,
    ).toBe(false);
  });

  it('rejects negative and fractional amounts and invalid dates', () => {
    for (const body of [
      { ...base, status: 'PAID', reimbursedAmount: -1 },
      { ...base, status: 'PAID', reimbursedAmount: 12.5 },
      { ...base, status: 'PAID', reimbursedAmount: 100, rejectedAmount: -5 },
      { status: 'IN_PROGRESS', date: '2026-02-30' },
    ]) {
      expect(createEntryRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('defaults note and documents, cleans file names and rejects duplicates and unknown fields', () => {
    expect(createEntryRequestSchema.parse({ ...base, status: 'IN_PROGRESS' })).toEqual({
      ...base,
      status: 'IN_PROGRESS',
      note: '',
      documents: [],
    });
    const uploadId = crypto.randomUUID();
    const parsed = createEntryRequestSchema.parse({
      ...base,
      status: 'IN_PROGRESS',
      documents: [{ uploadId, fileName: '../Leistungs\nabrechnung.pdf' }],
    });
    expect(parsed.documents[0]?.fileName).toBe('.._Leistungs_abrechnung.pdf');
    expect(
      createEntryRequestSchema.safeParse({
        ...base,
        status: 'IN_PROGRESS',
        documents: [
          { uploadId, fileName: 'a.pdf' },
          { uploadId, fileName: 'b.pdf' },
        ],
      }).success,
    ).toBe(false);
    expect(
      createEntryRequestSchema.safeParse({ ...base, status: 'IN_PROGRESS', iban: 'DE00' }).success,
    ).toBe(false);
  });
});

describe('claimFieldsSchema dates', () => {
  const valid = { provider: 'Praxis', invoiceDate: '2026-03-12', amount: 100 };

  it('keeps submission and payment date optional, nullable and real dates', () => {
    expect(claimFieldsSchema.parse(valid)).not.toHaveProperty('paidAt');
    expect(
      claimFieldsSchema.parse({ ...valid, submittedAt: null, paidAt: '2026-03-20' }),
    ).toMatchObject({ submittedAt: null, paidAt: '2026-03-20' });
    expect(claimFieldsSchema.safeParse({ ...valid, paidAt: '2026-02-30' }).success).toBe(false);
  });
});

describe('matchesFilters', () => {
  const claim = (
    paidAt: string | null,
    status: EntryAmounts['status'],
    submittedAt = '2026-03-14',
  ) => ({
    paidAt,
    submittedAt,
    reimbursement: { status },
  });
  const paidNotReimbursed = { reimbursement: 'NOT_REIMBURSED', payment: 'PAID' } as const;

  it('finds invoices that were paid but not fully reimbursed yet', () => {
    expect(matchesFilters(claim('2026-03-20', 'OPEN'), paidNotReimbursed)).toBe(true);
    expect(matchesFilters(claim('2026-03-20', 'PARTLY_PAID'), paidNotReimbursed)).toBe(true);
    expect(matchesFilters(claim('2026-03-20', 'PAID'), paidNotReimbursed)).toBe(false);
    expect(matchesFilters(claim(null, 'OPEN'), paidNotReimbursed)).toBe(false);
  });

  it('filters each dimension on its own', () => {
    expect(
      matchesFilters(claim(null, 'IN_PROGRESS'), { reimbursement: 'IN_PROGRESS', payment: 'ALL' }),
    ).toBe(true);
    expect(matchesFilters(claim(null, 'PAID'), { reimbursement: 'ALL', payment: 'UNPAID' })).toBe(
      true,
    );
    expect(
      matchesFilters(claim(null, 'OPEN', null as unknown as string), {
        reimbursement: 'NOT_SUBMITTED',
        payment: 'ALL',
      }),
    ).toBe(true);
    expect(
      matchesFilters(claim(null, 'OPEN'), { reimbursement: 'NOT_SUBMITTED', payment: 'ALL' }),
    ).toBe(false);
  });
});
