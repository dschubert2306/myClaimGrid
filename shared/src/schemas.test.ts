import { describe, expect, it } from 'vitest';
import {
  createClaimRequestSchema,
  fileNameSchema,
  isoDateSchema,
  saveClaimRequestSchema,
} from './schemas';

describe('isoDateSchema', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isoDateSchema.safeParse('2026-03-12').success).toBe(true);
    expect(isoDateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false);
    expect(isoDateSchema.safeParse('12.03.2026').success).toBe(false);
  });
});

describe('save request', () => {
  const valid = {
    provider: 'Praxis Dr. Muster',
    invoiceDate: '2026-03-12',
    amount: 12345,
    submittedAt: null,
    paid: false,
    reimbursement: { status: 'OPEN' },
  };
  const save = { version: '2026-03-12T10:00:00.000Z', ...valid };

  it('applies defaults for optional text fields, payment date and documents', () => {
    expect(saveClaimRequestSchema.parse(save)).toEqual({
      ...save,
      invoiceNumber: '',
      description: '',
      paidAt: null,
      reimbursement: { status: 'OPEN', note: '' },
      newDocuments: [],
      removedDocumentIds: [],
    });
  });

  it('rejects zero, negative and fractional invoice amounts', () => {
    for (const amount of [0, -1, 12.5]) {
      expect(saveClaimRequestSchema.safeParse({ ...save, amount }).success).toBe(false);
    }
  });

  it('requires the payment date while the toggle is on and clears it while it is off', () => {
    expect(saveClaimRequestSchema.safeParse({ ...save, paid: true }).success).toBe(false);
    expect(
      saveClaimRequestSchema.safeParse({ ...save, paid: true, paidAt: '2026-03-20' }).success,
    ).toBe(true);
    expect(
      saveClaimRequestSchema.safeParse({ ...save, paid: false, paidAt: '2026-03-20' }).success,
    ).toBe(false);
    expect(
      saveClaimRequestSchema.safeParse({ ...save, paid: true, paidAt: '2026-02-30' }).success,
    ).toBe(false);
  });

  it('allows a paid invoice that is not reimbursed yet', () => {
    const parsed = saveClaimRequestSchema.parse({ ...save, paid: true, paidAt: '2026-03-20' });
    expect(parsed).toMatchObject({ paid: true, reimbursement: { status: 'OPEN' } });
  });

  it('needs the version to update, and a person to create', () => {
    const withoutVersion = Object.fromEntries(
      Object.entries(save).filter(([key]) => key !== 'version'),
    );
    expect(saveClaimRequestSchema.safeParse(withoutVersion).success).toBe(false);
    expect(createClaimRequestSchema.safeParse(valid).success).toBe(false);
    expect(
      createClaimRequestSchema.safeParse({ ...valid, personId: crypto.randomUUID() }).success,
    ).toBe(true);
  });

  it('rejects duplicate uploads and removals', () => {
    const id = crypto.randomUUID();
    expect(
      saveClaimRequestSchema.safeParse({
        ...save,
        newDocuments: [
          { uploadId: id, fileName: 'a.pdf' },
          { uploadId: id, fileName: 'b.pdf' },
        ],
      }).success,
    ).toBe(false);
    expect(
      saveClaimRequestSchema.safeParse({ ...save, removedDocumentIds: [id, id] }).success,
    ).toBe(false);
  });

  it('rejects unknown fields, bank data included', () => {
    expect(saveClaimRequestSchema.safeParse({ ...save, iban: 'DE00' }).success).toBe(false);
    expect(
      createClaimRequestSchema.safeParse({ ...valid, personId: crypto.randomUUID(), bic: 'XXXX' })
        .success,
    ).toBe(false);
  });
});

describe('fileNameSchema', () => {
  it('replaces path separators and control characters', () => {
    expect(fileNameSchema.parse('../Leistungs\nabrechnung.pdf')).toBe(
      '.._Leistungs_abrechnung.pdf',
    );
  });
});
