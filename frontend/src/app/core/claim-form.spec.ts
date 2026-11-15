import { saveClaimRequestSchema, type Claim, type ReimbursementEntry } from '@myclaimgrid/shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CLAIM_FORM,
  fieldMarkers,
  fromClaim,
  paymentDateAfterToggle,
  reimbursementDateFor,
  reimbursementDiffers,
  reimbursementPreview,
  showsReimbursementDetails,
  suggestedReimbursement,
  toClaimRequest,
  type ClaimFormValues,
} from './claim-form';
import { DEFAULT_FORMATS } from './date-format';

const DE = DEFAULT_FORMATS['de-DE'];
const EN = DEFAULT_FORMATS['en-GB'];

const valid: ClaimFormValues = {
  ...EMPTY_CLAIM_FORM,
  provider: ' Praxis Dr. Huber ',
  invoiceNumber: 'RE-2026-00417',
  invoiceDate: '12.03.2026',
  amount: '100,00',
};

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
  submittedAt: null,
  paidAt: null,
  reimbursement: {
    status: 'OPEN',
    entries: [],
    reimbursed: 0,
    rejected: 0,
    outstanding: 8940,
    selfBorne: 0,
  },
  documents: [],
  createdAt: '2026-03-12T10:00:00.000Z',
  updatedAt: '2026-03-12T10:00:00.000Z',
  ...overrides,
});

const errorsOf = (values: ClaimFormValues, entries: ReimbursementEntry[] = [], formats = DE) => {
  const result = toClaimRequest(values, formats, entries);
  return result.ok ? {} : result.errors;
};

describe('invoice fields', () => {
  it('requires provider, date and amount, but not invoice number or description', () => {
    expect(errorsOf(EMPTY_CLAIM_FORM)).toEqual({
      provider: 'required',
      invoiceDate: 'required',
      amount: 'required',
    });
    expect(errorsOf({ ...valid, invoiceNumber: '', description: '' })).toEqual({});
  });

  it('checks the date and the amount in the format of the language', () => {
    expect(errorsOf({ ...valid, invoiceDate: '31.02.2026' }).invoiceDate).toBe('date');
    expect(errorsOf({ ...valid, invoiceDate: '12/03/2026', amount: '100.00' }, [], EN)).toEqual({});
    expect(errorsOf({ ...valid, amount: '0,00' }).amount).toBe('amount');
    expect(errorsOf({ ...valid, amount: '-3' }).amount).toBe('amount');
    expect(errorsOf({ ...valid, amount: '12.5' }).amount).toBe('amount');
    expect(errorsOf({ ...valid, invoiceDate: '12/03/2026', amount: '12.50' }, [], EN)).toEqual({});
  });

  it('limits the length', () => {
    expect(errorsOf({ ...valid, provider: 'x'.repeat(201) }).provider).toBe('maxLength');
    expect(errorsOf({ ...valid, description: 'x'.repeat(501) }).description).toBe('maxLength');
    expect(errorsOf({ ...valid, note: 'x'.repeat(501), status: 'IN_PROGRESS' }).note).toBe(
      'maxLength',
    );
  });
});

describe('toClaimRequest', () => {
  it('converts what the user sees to ISO dates and integer cents', () => {
    const result = toClaimRequest({ ...valid, amount: '1.234,56' }, DE, []);
    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'Praxis Dr. Huber',
        invoiceNumber: 'RE-2026-00417',
        invoiceDate: '2026-03-12',
        amount: 123456,
        description: '',
        submittedAt: null,
        paid: false,
        paidAt: null,
        reimbursement: { status: 'OPEN', note: '' },
      },
    });
  });

  it('reports every invalid field at once and never sends the form', () => {
    expect(errorsOf({ ...EMPTY_CLAIM_FORM, invoiceDate: '99.99.2026', amount: '-3' })).toEqual({
      provider: 'required',
      invoiceDate: 'date',
      amount: 'amount',
    });
  });

  it('keeps the submission date optional and validates it when filled', () => {
    expect(errorsOf({ ...valid, submittedAt: '31.02.2026' }).submittedAt).toBe('date');
    const result = toClaimRequest({ ...valid, submittedAt: '14.03.2026' }, DE, []);
    expect(result.ok && result.request.submittedAt).toBe('2026-03-14');
  });

  it('only sends what the API accepts, with no bank data field', () => {
    const result = toClaimRequest(valid, DE, []);
    expect(result.ok && Object.keys(result.request).sort()).toEqual(
      [
        'amount',
        'description',
        'invoiceDate',
        'invoiceNumber',
        'paid',
        'paidAt',
        'provider',
        'reimbursement',
        'submittedAt',
      ].sort(),
    );
  });

  it('produces requests the server schema accepts, in every status', () => {
    const base = { ...valid, reimbursementDate: '02.04.2026' };
    for (const values of [
      valid,
      { ...base, status: 'IN_PROGRESS' },
      { ...base, status: 'PARTLY_PAID', reimbursedAmount: '60', rejectedAmount: '5' },
      { ...base, status: 'PAID', reimbursedAmount: '0' },
      { ...valid, paid: true, paidAt: '20.03.2026' },
    ]) {
      const result = toClaimRequest(values, DE, []);
      expect(result.ok, JSON.stringify(values)).toBe(true);
      if (result.ok) {
        expect(saveClaimRequestSchema.safeParse({ version: 'v', ...result.request }).success).toBe(
          true,
        );
      }
    }
  });
});

describe('payment status', () => {
  it('is off by default and sends no date', () => {
    const result = toClaimRequest(valid, DE, []);
    expect(result.ok && [result.request.paid, result.request.paidAt]).toEqual([false, null]);
  });

  it('requires a valid date while the toggle is on', () => {
    expect(errorsOf({ ...valid, paid: true }).paidAt).toBe('required');
    expect(errorsOf({ ...valid, paid: true, paidAt: '31.02.2026' }).paidAt).toBe('date');
    const result = toClaimRequest({ ...valid, paid: true, paidAt: '20.03.2026' }, DE, []);
    expect(result.ok && [result.request.paid, result.request.paidAt]).toEqual([true, '2026-03-20']);
  });

  it('ignores a leftover date while the toggle is off', () => {
    const result = toClaimRequest({ ...valid, paid: false, paidAt: '20.03.2026' }, DE, []);
    expect(result.ok && [result.request.paid, result.request.paidAt]).toEqual([false, null]);
  });

  it('is independent of the reimbursement: paid, but not reimbursed yet', () => {
    const result = toClaimRequest({ ...valid, paid: true, paidAt: '20.03.2026' }, DE, []);
    expect(result.ok && result.request.reimbursement.status).toBe('OPEN');
    // and reimbursed without being paid
    const reverse = toClaimRequest(
      { ...valid, status: 'PAID', reimbursementDate: '02.04.2026', reimbursedAmount: '100' },
      DE,
      [],
    );
    expect(reverse.ok && [reverse.request.paid, reverse.request.reimbursement.status]).toEqual([
      false,
      'PAID',
    ]);
  });

  describe('prefill when the toggle is switched', () => {
    // 23:59 local time: still the same local day, whatever the time zone of the machine.
    const lateEvening = new Date(2026, 2, 5, 23, 59, 30);

    it('fills the current date, date only and in the local time zone, when switched on', () => {
      expect(paymentDateAfterToggle(true, '', DE, lateEvening)).toBe('05.03.2026');
      expect(paymentDateAfterToggle(true, '', EN, lateEvening)).toBe('05/03/2026');
      expect(paymentDateAfterToggle(true, '  ', DE, lateEvening)).toBe('05.03.2026');
    });

    it('clears the date when switched off', () => {
      expect(paymentDateAfterToggle(false, '20.03.2026', DE, lateEvening)).toBe('');
    });

    it('does not overwrite a date that is already there', () => {
      expect(paymentDateAfterToggle(true, '20.03.2026', DE, lateEvening)).toBe('20.03.2026');
    });

    it('is not applied when a saved claim is opened: the saved date is shown as it is', () => {
      const values = fromClaim(claim({ paidAt: '2026-03-20' }), DE);
      expect(values).toMatchObject({ paid: true, paidAt: '20.03.2026' });
      expect(fromClaim(claim(), DE)).toMatchObject({ paid: false, paidAt: '' });
    });
  });
});

describe('reimbursement', () => {
  const partly = { ...valid, status: 'PARTLY_PAID', reimbursementDate: '02.04.2026' };

  it('needs no amount, date or note for the default status OPEN without history', () => {
    expect(showsReimbursementDetails('OPEN', [])).toBe(false);
    const result = toClaimRequest({ ...valid, reimbursementDate: '', note: 'ignored' }, DE, []);
    expect(result.ok && result.request.reimbursement).toEqual({ status: 'OPEN', note: '' });
  });

  it('requires a reimbursed amount for Paid and Partly paid only', () => {
    expect(errorsOf({ ...partly }).reimbursedAmount).toBe('required');
    expect(errorsOf({ ...partly, status: 'PAID' }).reimbursedAmount).toBe('required');
    expect(errorsOf({ ...partly, status: 'IN_PROGRESS' })).toEqual({});
    // Amounts typed before are not sent for a status without payment.
    const result = toClaimRequest(
      { ...partly, status: 'IN_PROGRESS', reimbursedAmount: '50', rejectedAmount: '5' },
      DE,
      [],
    );
    expect(result.ok && result.request.reimbursement).toEqual({
      status: 'IN_PROGRESS',
      date: '2026-04-02',
      note: '',
    });
  });

  it('accepts zero (a full rejection) but not negative or invalid amounts', () => {
    expect(errorsOf({ ...partly, status: 'PAID', reimbursedAmount: '0,00' })).toEqual({});
    expect(errorsOf({ ...partly, reimbursedAmount: '-5' }).reimbursedAmount).toBe('cents');
    expect(errorsOf({ ...partly, reimbursedAmount: 'abc' }).reimbursedAmount).toBe('cents');
    expect(
      errorsOf({ ...partly, reimbursedAmount: '10', rejectedAmount: 'x' }).rejectedAmount,
    ).toBe('cents');
  });

  it('does not allow more than the invoice amount, rejected amounts included', () => {
    expect(errorsOf({ ...partly, reimbursedAmount: '100,01' }).reimbursedAmount).toBe(
      'aboveInvoice',
    );
    expect(errorsOf({ ...partly, reimbursedAmount: '100' })).toEqual({});
    expect(
      errorsOf({ ...partly, reimbursedAmount: '90', rejectedAmount: '10,01' }).reimbursedAmount,
    ).toBe('aboveInvoice');
  });

  it('does not allow lowering the invoice amount below what the history has', () => {
    const history = [entry()]; // 60,00 reimbursed and 5,00 rejected
    const open = { ...valid, status: 'IN_PROGRESS', reimbursementDate: '02.04.2026' };
    expect(errorsOf({ ...open, amount: '64,99' }, history).amount).toBe('belowReimbursed');
    expect(errorsOf({ ...open, amount: '65' }, history)).toEqual({});
  });

  it('needs a date for a change, not before the latest entry', () => {
    expect(errorsOf({ ...valid, status: 'IN_PROGRESS' }).reimbursementDate).toBe('required');
    const history = [
      entry({ status: 'IN_PROGRESS', reimbursedAmount: null, rejectedAmount: null }),
    ];
    expect(
      errorsOf(
        { ...valid, status: 'PAID', reimbursementDate: '01.04.2026', reimbursedAmount: '1' },
        history,
      ).reimbursementDate,
    ).toBe('dateBeforeLatest');
    expect(
      errorsOf({ ...valid, status: 'IN_PROGRESS', reimbursementDate: '31.02.2026' })
        .reimbursementDate,
    ).toBe('date');
  });

  it('sends the totals, so several partial reimbursements add up on the server', () => {
    const history = [entry()];
    const values = fromClaim(
      claim({
        amount: 10000,
        reimbursement: {
          status: 'PARTLY_PAID',
          entries: history,
          reimbursed: 6000,
          rejected: 500,
          outstanding: 3500,
          selfBorne: 500,
        },
      }),
      DE,
    );
    expect(values).toMatchObject({
      status: 'PARTLY_PAID',
      reimbursementDate: '02.04.2026',
      reimbursedAmount: '60,00',
      rejectedAmount: '5,00',
      note: '',
    });
    // Opened and saved without a change: the same state, so no new history entry.
    const unchanged = toClaimRequest(values, DE, history);
    expect(unchanged.ok && unchanged.request.reimbursement).toEqual({
      status: 'PARTLY_PAID',
      date: '2026-04-02',
      reimbursedAmount: 6000,
      rejectedAmount: 500,
      note: '',
    });
    // 25,00 more are reimbursed: the dialog sends 85,00 in total.
    const more = toClaimRequest(
      { ...values, reimbursedAmount: '85,00', reimbursementDate: '20.04.2026' },
      DE,
      history,
    );
    expect(more.ok && more.request.reimbursement).toMatchObject({ reimbursedAmount: 8500 });
  });

  it('keeps earlier totals in the form while the status has no payment', () => {
    const values = fromClaim(
      claim({
        reimbursement: {
          status: 'IN_PROGRESS',
          entries: [
            entry(),
            entry({
              status: 'IN_PROGRESS',
              date: '2026-05-01',
              reimbursedAmount: null,
              rejectedAmount: null,
            }),
          ],
          reimbursed: 6000,
          rejected: 0,
          outstanding: 2940,
          selfBorne: 0,
        },
      }),
      DE,
    );
    expect(values).toMatchObject({
      status: 'IN_PROGRESS',
      reimbursementDate: '01.05.2026',
      reimbursedAmount: '60,00',
    });
  });

  it('shows a fully rejected claim as 0,00 reimbursed, so saving it again is possible', () => {
    const values = fromClaim(
      claim({
        amount: 10000,
        reimbursement: {
          status: 'PAID',
          entries: [entry({ status: 'PAID', reimbursedAmount: 0, rejectedAmount: 10000 })],
          reimbursed: 0,
          rejected: 10000,
          outstanding: 0,
          selfBorne: 10000,
        },
      }),
      DE,
    );
    expect(values).toMatchObject({ reimbursedAmount: '0,00', rejectedAmount: '100,00' });
    expect(
      toClaimRequest(values, DE, [
        entry({ status: 'PAID', reimbursedAmount: 0, rejectedAmount: 10000 }),
      ]).ok,
    ).toBe(true);
  });
});

describe('reimbursement date follows the change', () => {
  const baseline = {
    status: 'PARTLY_PAID',
    reimbursedAmount: '60,00',
    rejectedAmount: '5,00',
    reimbursementDate: '02.04.2026',
  };
  const noon = new Date(2026, 4, 20, 12);

  it('detects a changed status or total, and ignores amounts of a status without payment', () => {
    expect(reimbursementDiffers(baseline, baseline, DE.locale)).toBe(false);
    expect(reimbursementDiffers({ ...baseline, status: 'PAID' }, baseline, DE.locale)).toBe(true);
    expect(
      reimbursementDiffers({ ...baseline, reimbursedAmount: '85,00' }, baseline, DE.locale),
    ).toBe(true);
    expect(reimbursementDiffers({ ...baseline, reimbursedAmount: '60' }, baseline, DE.locale)).toBe(
      false,
    );
    expect(reimbursementDiffers({ ...baseline, rejectedAmount: '' }, baseline, DE.locale)).toBe(
      true,
    );
    const open = { status: 'IN_PROGRESS', reimbursedAmount: '', rejectedAmount: '' };
    expect(reimbursementDiffers({ ...open, reimbursedAmount: '1' }, open, DE.locale)).toBe(false);
  });

  it('is today after a change and the old date again after undoing it', () => {
    expect(
      reimbursementDateFor({ ...baseline, reimbursedAmount: '85,00' }, baseline, DE, noon),
    ).toBe('20.05.2026');
    expect(reimbursementDateFor(baseline, baseline, DE, noon)).toBe('02.04.2026');
  });
});

describe('suggested amount and difference', () => {
  it('suggests what the invoice has left after the rejected amount for a final payment only', () => {
    const values = { amount: '100,00', rejectedAmount: '5,00' };
    expect(suggestedReimbursement('PAID', values, DE.locale)).toBe(9500);
    expect(suggestedReimbursement('PAID', { ...values, rejectedAmount: '' }, DE.locale)).toBe(
      10000,
    );
    expect(suggestedReimbursement('PARTLY_PAID', values, DE.locale)).toBeNull();
    expect(
      suggestedReimbursement('PAID', { amount: '', rejectedAmount: '' }, DE.locale),
    ).toBeNull();
  });

  it('shows the difference to the invoice amount for Partly paid', () => {
    expect(
      reimbursementPreview(
        { status: 'PARTLY_PAID', amount: '100,00', reimbursedAmount: '60,00' },
        DE.locale,
      ),
    ).toEqual({ reimbursed: 6000, amount: 10000, difference: 4000 });
    expect(
      reimbursementPreview(
        { status: 'PAID', amount: '100,00', reimbursedAmount: '60,00' },
        DE.locale,
      ),
    ).toBeNull();
    expect(
      reimbursementPreview(
        { status: 'PARTLY_PAID', amount: '100,00', reimbursedAmount: '' },
        DE.locale,
      ),
    ).toBeNull();
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
      submittedAt: '',
      status: 'OPEN',
      reimbursementDate: '',
      reimbursedAmount: '',
      rejectedAmount: '',
      note: '',
      paid: false,
      paidAt: '',
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
