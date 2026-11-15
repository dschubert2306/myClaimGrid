import { describe, expect, it } from 'vitest';
import {
  currentStatus,
  differenceToInvoice,
  matchesFilters,
  planReimbursementChange,
  reimbursementTotals,
  sortEntries,
  type EntryAmounts,
} from './reimbursement';
import { MAX_ENTRIES_PER_CLAIM, reimbursementInputSchema } from './schemas';

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

describe('differenceToInvoice', () => {
  it('is what the insurer has not paid out yet, rejected amounts included', () => {
    expect(differenceToInvoice(10000, 6000)).toBe(4000);
    expect(differenceToInvoice(10000, 0)).toBe(10000);
    expect(differenceToInvoice(10000, 10000)).toBe(0);
  });
});

describe('planReimbursementChange', () => {
  const partly = [
    entry({
      status: 'PARTLY_PAID',
      date: '2026-04-15',
      reimbursedAmount: 6000,
      rejectedAmount: 1000,
    }),
  ];
  const note = '';

  it('creates no entry when nothing changed', () => {
    expect(planReimbursementChange(10000, [], { status: 'OPEN' })).toEqual({
      ok: true,
      entry: null,
    });
    expect(
      planReimbursementChange(10000, partly, {
        status: 'PARTLY_PAID',
        date: '2026-04-15',
        reimbursedAmount: 6000,
        rejectedAmount: 1000,
        note,
      }),
    ).toEqual({ ok: true, entry: null });
  });

  it('records a status change without amounts as one entry that keeps the totals', () => {
    const plan = planReimbursementChange(10000, [], { status: 'IN_PROGRESS', date: '2026-04-01' });
    expect(plan).toEqual({
      ok: true,
      entry: {
        status: 'IN_PROGRESS',
        date: '2026-04-01',
        reimbursedAmount: null,
        rejectedAmount: null,
        note: '',
      },
    });
    // A non-paying status after a payment leaves what was reimbursed alone.
    expect(
      planReimbursementChange(10000, partly, { status: 'IN_PROGRESS', date: '2026-05-01' }),
    ).toMatchObject({ ok: true, entry: { reimbursedAmount: null, rejectedAmount: null } });
  });

  it('stores the change of the totals, so several partial reimbursements add up', () => {
    const second = planReimbursementChange(10000, partly, {
      status: 'PARTLY_PAID',
      date: '2026-05-02',
      reimbursedAmount: 8000,
      rejectedAmount: 1000,
    });
    expect(second).toMatchObject({
      ok: true,
      entry: { reimbursedAmount: 2000, rejectedAmount: 0 },
    });
    if (!second.ok || !second.entry) throw new Error('expected an entry');

    const history = [...partly, entry({ ...second.entry })];
    expect(reimbursementTotals(10000, history)).toMatchObject({
      status: 'PARTLY_PAID',
      reimbursed: 8000,
      rejected: 1000,
      outstanding: 1000,
    });
    // Closing the claim: the rest is self-borne.
    const final = planReimbursementChange(10000, history, {
      status: 'PAID',
      date: '2026-06-01',
      reimbursedAmount: 9000,
      rejectedAmount: 1000,
    });
    expect(final).toMatchObject({ ok: true, entry: { reimbursedAmount: 1000 } });
  });

  it('records a correction downwards as a negative change, and clearing rejected as zero', () => {
    expect(
      planReimbursementChange(10000, partly, {
        status: 'PARTLY_PAID',
        date: '2026-04-15',
        reimbursedAmount: 5500,
      }),
    ).toMatchObject({ ok: true, entry: { reimbursedAmount: -500, rejectedAmount: -1000 } });
  });

  it('allows reimbursing exactly the invoice amount and refuses anything above it', () => {
    const base = { status: 'PAID', date: '2026-05-01' } as const;
    expect(planReimbursementChange(10000, [], { ...base, reimbursedAmount: 10000 }).ok).toBe(true);
    expect(planReimbursementChange(10000, [], { ...base, reimbursedAmount: 10001 })).toEqual({
      ok: false,
      problem: 'amount_above_invoice',
    });
    expect(
      planReimbursementChange(10000, [], { ...base, reimbursedAmount: 9000, rejectedAmount: 1001 }),
    ).toEqual({ ok: false, problem: 'amount_above_invoice' });
  });

  it('refuses an invoice amount below what was already reimbursed or rejected', () => {
    expect(
      planReimbursementChange(6999, partly, {
        status: 'PARTLY_PAID',
        date: '2026-04-15',
        reimbursedAmount: 6000,
        rejectedAmount: 1000,
      }),
    ).toEqual({
      ok: false,
      problem: 'amount_above_invoice',
    });
    // Also while the status itself does not pay.
    expect(
      planReimbursementChange(6999, partly, { status: 'IN_PROGRESS', date: '2026-05-01' }),
    ).toEqual({
      ok: false,
      problem: 'amount_above_invoice',
    });
    expect(
      planReimbursementChange(7000, partly, { status: 'IN_PROGRESS', date: '2026-05-01' }).ok,
    ).toBe(true);
  });

  it('needs a date for a change, and not one before the latest entry', () => {
    expect(planReimbursementChange(10000, [], { status: 'IN_PROGRESS' })).toEqual({
      ok: false,
      problem: 'date_required',
    });
    expect(
      planReimbursementChange(10000, partly, { status: 'IN_PROGRESS', date: '2026-04-14' }),
    ).toEqual({ ok: false, problem: 'date_before_latest' });
    // The same day is fine, the entry recorded last wins.
    expect(
      planReimbursementChange(10000, partly, { status: 'IN_PROGRESS', date: '2026-04-15' }).ok,
    ).toBe(true);
  });

  it('counts a note or a new date as a change of its own', () => {
    expect(
      planReimbursementChange(10000, [], { status: 'OPEN', date: '2026-04-01', note: 'Called' }),
    ).toMatchObject({ ok: true, entry: { status: 'OPEN', note: 'Called' } });
    expect(
      planReimbursementChange(10000, partly, {
        status: 'PARTLY_PAID',
        date: '2026-04-20',
        reimbursedAmount: 6000,
        rejectedAmount: 1000,
      }),
    ).toMatchObject({ ok: true, entry: { reimbursedAmount: 0, rejectedAmount: 0 } });
  });

  it('keeps the history at a sensible size', () => {
    const many = Array.from({ length: MAX_ENTRIES_PER_CLAIM }, (_, i) =>
      entry({ status: 'IN_PROGRESS', date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    expect(planReimbursementChange(10000, many, { status: 'OPEN', date: '2026-12-01' })).toEqual({
      ok: false,
      problem: 'too_many_entries',
    });
  });
});

describe('reimbursementInputSchema', () => {
  it('requires a reimbursed amount for PAID and PARTLY_PAID only', () => {
    expect(reimbursementInputSchema.safeParse({ status: 'PAID' }).success).toBe(false);
    expect(
      reimbursementInputSchema.safeParse({ status: 'PARTLY_PAID', reimbursedAmount: 0 }).success,
    ).toBe(true);
    expect(
      reimbursementInputSchema.safeParse({ status: 'IN_PROGRESS', reimbursedAmount: 100 }).success,
    ).toBe(false);
    expect(
      reimbursementInputSchema.safeParse({ status: 'OPEN', rejectedAmount: 100 }).success,
    ).toBe(false);
  });

  it('rejects negative and fractional amounts and invalid dates', () => {
    for (const body of [
      { status: 'PAID', reimbursedAmount: -1 },
      { status: 'PAID', reimbursedAmount: 12.5 },
      { status: 'PAID', reimbursedAmount: 100, rejectedAmount: -5 },
      { status: 'IN_PROGRESS', date: '2026-02-30' },
    ]) {
      expect(reimbursementInputSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('defaults the note and rejects unknown fields', () => {
    expect(reimbursementInputSchema.parse({ status: 'IN_PROGRESS' })).toEqual({
      status: 'IN_PROGRESS',
      note: '',
    });
    expect(
      reimbursementInputSchema.safeParse({ status: 'IN_PROGRESS', iban: 'DE00' }).success,
    ).toBe(false);
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
