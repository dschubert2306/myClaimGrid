import { saveClaimRequestSchema, type Claim, type ReimbursementEntry } from '@myclaimgrid/shared';
import { describe, expect, it } from 'vitest';
import { editText, inlineEditError, inlineEditRequest } from './claim-inline-edit';
import { DEFAULT_FORMATS } from './date-format';

const DE = DEFAULT_FORMATS['de-DE'];
const NOW = new Date(2026, 3, 20, 12, 0, 0); // 20 Apr 2026, local time

const entry = (overrides: Partial<ReimbursementEntry> = {}): ReimbursementEntry => ({
  entryId: crypto.randomUUID(),
  status: 'PARTLY_PAID',
  date: '2026-04-02',
  reimbursedAmount: 6000,
  rejectedAmount: 500,
  note: '',
  createdAt: '2026-04-02T10:00:00.000Z',
  ...overrides,
});

const claim = (overrides: Partial<Claim> = {}): Claim => ({
  claimId: '11111111-1111-4111-8111-111111111111',
  personId: '22222222-2222-4222-8222-222222222222',
  status: 'OPEN',
  source: 'MANUAL',
  year: 2026,
  provider: 'Praxis Dr. Huber',
  invoiceNumber: 'RE-1',
  invoiceDate: '2026-03-12',
  amount: 10000,
  currency: 'EUR',
  description: 'Kontrolle',
  hasPdf: false,
  extractionStatus: null,
  extraction: null,
  submittedAt: '2026-03-14',
  paidAt: null,
  reimbursement: {
    status: 'OPEN',
    entries: [],
    reimbursed: 0,
    rejected: 0,
    outstanding: 10000,
    selfBorne: 0,
  },
  documents: [],
  createdAt: '2026-03-12T10:00:00.000Z',
  updatedAt: '2026-03-12T10:00:00.000Z',
  ...overrides,
});

const partly = (): Claim =>
  claim({
    reimbursement: {
      status: 'PARTLY_PAID',
      entries: [entry()],
      reimbursed: 6000,
      rejected: 500,
      outstanding: 3500,
      selfBorne: 500,
    },
  });

function request(c: Claim, edit: Parameters<typeof inlineEditRequest>[1]) {
  const result = inlineEditRequest(c, edit, DE, NOW);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.errors)}`);
  return result.request;
}

describe('inlineEditRequest: text cells', () => {
  it('changes only the edited field, everything else is sent as saved', () => {
    const body = request(claim(), { field: 'provider', text: ' Klinik Nord ' });
    expect(body).toMatchObject({
      provider: 'Klinik Nord',
      invoiceNumber: 'RE-1',
      invoiceDate: '2026-03-12',
      amount: 10000,
      description: 'Kontrolle',
      submittedAt: '2026-03-14',
      paid: false,
      paidAt: null,
    });
    expect(body.reimbursement).toMatchObject({ status: 'OPEN', note: '' });
  });

  it('builds a request the API accepts', () => {
    const body = request(claim(), { field: 'amount', text: '1.234,56' });
    expect(body.amount).toBe(123456);
    const parsed = saveClaimRequestSchema.safeParse({
      ...body,
      version: 'v',
      newDocuments: [],
      removedDocumentIds: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('parses the date in the date format of the settings', () => {
    expect(request(claim(), { field: 'invoiceDate', text: '01.04.2026' }).invoiceDate).toBe(
      '2026-04-01',
    );
    const en = inlineEditRequest(
      claim(),
      { field: 'invoiceDate', text: '01/04/2026' },
      DEFAULT_FORMATS['en-GB'],
      NOW,
    );
    expect(en.ok && en.request.invoiceDate).toBe('2026-04-01');
  });

  it('clears the invoice number, which is optional', () => {
    expect(request(claim(), { field: 'invoiceNumber', text: '  ' }).invoiceNumber).toBe('');
  });

  it('refuses what the dialog refuses', () => {
    const empty = inlineEditRequest(claim(), { field: 'provider', text: ' ' }, DE, NOW);
    expect(empty).toEqual({ ok: false, errors: { provider: 'required' } });
    const date = inlineEditRequest(claim(), { field: 'invoiceDate', text: '31.02.2026' }, DE, NOW);
    expect(date.ok).toBe(false);
    const amount = inlineEditRequest(claim(), { field: 'amount', text: 'abc' }, DE, NOW);
    expect(amount.ok).toBe(false);
  });

  it('does not let the invoice amount go below what was already reimbursed or rejected', () => {
    const result = inlineEditRequest(partly(), { field: 'amount', text: '50' }, DE, NOW);
    expect(result.ok).toBe(false);
    // The dialog shows this at the reimbursed field, which the table has no cell for: the message
    // is shown at the amount cell instead.
    if (!result.ok) expect(inlineEditError(result, 'amount')).toBe('aboveInvoice');
    // Without a payment status the same change is reported at the amount, as in the dialog.
    const open = claim({
      reimbursement: { ...partly().reimbursement, status: 'IN_PROGRESS' },
    });
    const lowered = inlineEditRequest(open, { field: 'amount', text: '50' }, DE, NOW);
    expect(lowered).toEqual({ ok: false, errors: { amount: 'belowReimbursed' } });
  });

  it('a change of a text cell never touches the reimbursement history', () => {
    const body = request(partly(), { field: 'provider', text: 'Andere Praxis' });
    expect(body.reimbursement.status).toBe('PARTLY_PAID');
    expect(body.reimbursement.reimbursedAmount).toBe(6000);
    expect(body.reimbursement.rejectedAmount).toBe(500);
    expect(body.reimbursement.note).toBe('');
  });

  it('starts the editor with the text the dialog shows', () => {
    expect(editText(claim(), 'invoiceDate', DE)).toBe('12.03.2026');
    expect(editText(claim(), 'amount', DE)).toBe('100,00');
    expect(editText(claim({ invoiceNumber: null }), 'invoiceNumber', DE)).toBe('');
  });
});

describe('inlineEditRequest: status', () => {
  it('"Reimbursed" prefills what the invoice has left, dated today', () => {
    const body = request(claim(), { field: 'status', status: 'PAID' });
    expect(body.reimbursement).toMatchObject({
      status: 'PAID',
      date: '2026-04-20',
      reimbursedAmount: 10000,
    });
  });

  it('"Reimbursed" after a partial one pays the rest and keeps the rejected amount', () => {
    const body = request(partly(), { field: 'status', status: 'PAID' });
    expect(body.reimbursement).toMatchObject({
      status: 'PAID',
      reimbursedAmount: 9500,
      rejectedAmount: 500,
    });
  });

  it('"In progress" needs no amount and no payment', () => {
    const body = request(claim(), { field: 'status', status: 'IN_PROGRESS' });
    expect(body.reimbursement).toMatchObject({ status: 'IN_PROGRESS', date: '2026-04-20' });
    expect(body.reimbursement.reimbursedAmount).toBeUndefined();
  });

  it('a partial reimbursement cannot be set without an amount', () => {
    const result = inlineEditRequest(claim(), { field: 'status', status: 'PARTLY_PAID' }, DE, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(inlineEditError(result, 'status')).toBe('required');
  });

  it('a date before the latest history entry is refused', () => {
    const late = claim({
      reimbursement: { ...partly().reimbursement, entries: [entry({ date: '2026-05-01' })] },
    });
    const result = inlineEditRequest(late, { field: 'status', status: 'PAID' }, DE, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(inlineEditError(result, 'status')).toBe('dateBeforeLatest');
  });
});

describe('inlineEditRequest: payment', () => {
  it('switching on fills today, switching off clears the date', () => {
    const on = request(claim(), { field: 'paid', paid: true });
    expect(on).toMatchObject({ paid: true, paidAt: '2026-04-20' });
    const off = request(claim({ paidAt: '2026-03-20' }), { field: 'paid', paid: false });
    expect(off).toMatchObject({ paid: false, paidAt: null });
  });

  it('edits the payment date of a paid claim and keeps it paid', () => {
    const body = request(claim({ paidAt: '2026-03-20' }), { field: 'paidAt', text: '22.03.2026' });
    expect(body).toMatchObject({ paid: true, paidAt: '2026-03-22' });
  });

  it('an emptied payment date is refused, it is required while paid', () => {
    const result = inlineEditRequest(
      claim({ paidAt: '2026-03-20' }),
      { field: 'paidAt', text: '' },
      DE,
      NOW,
    );
    expect(result).toEqual({ ok: false, errors: { paidAt: 'required' } });
    if (!result.ok) expect(inlineEditError(result, 'paidAt')).toBe('required');
  });
});
