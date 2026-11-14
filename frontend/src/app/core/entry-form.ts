import {
  checkNewEntry,
  createEntryRequestSchema,
  isPaymentStatus,
  remainingAmount,
  type CreateEntryRequestInput,
  type ReimbursementEntry,
  type ReimbursementStatus,
} from '@myclaimgrid/shared';
import type { Formats } from './date-format';
import type { AppLocale } from './locale';
import { parseAmountInput, parseDateInput } from './parse-input';

/**
 * Logic of the dialog that adds a reimbursement history entry, free of Angular so it can be tested.
 * The same rules run on the server (createEntryRequestSchema and checkNewEntry), this gives the
 * user the answer before anything is uploaded.
 */

export const ENTRY_FIELD_NAMES = [
  'status',
  'date',
  'reimbursedAmount',
  'rejectedAmount',
  'note',
] as const;
export type EntryFieldName = (typeof ENTRY_FIELD_NAMES)[number];
export type EntryFormValues = Record<EntryFieldName, string>;
export type EntryErrorKey = 'required' | 'date' | 'cents' | 'maxLength' | 'aboveInvoice';

/** Amount of zero or more: "0", "0,00" and "1.234,56" are valid, empty is null. */
export function parseCentsInput(input: string, locale: AppLocale): number | null | 'invalid' {
  const text = input.replace(/[\s\u00a0\u202f]/g, '').replace(/EUR|€/gi, '');
  if (text === '') return null;
  if (/^0+(?:[.,]0{1,2})?$/.test(text)) return 0;
  return parseAmountInput(text, locale) ?? 'invalid';
}

export interface EntryContext {
  /** Invoice amount in cents. */
  amount: number;
  entries: readonly ReimbursementEntry[];
}

export type EntryFormResult =
  | { ok: true; request: Omit<CreateEntryRequestInput, 'documents'> }
  | { ok: false; errors: Partial<Record<EntryFieldName, EntryErrorKey>> };

export function toEntryRequest(
  values: EntryFormValues,
  formats: Formats,
  context: EntryContext,
): EntryFormResult {
  const errors: Partial<Record<EntryFieldName, EntryErrorKey>> = {};
  const status = values.status as ReimbursementStatus;
  const pays = isPaymentStatus(status);

  const date = values.date.trim() === '' ? null : parseDateInput(values.date, formats.dateFormat);
  if (values.date.trim() === '') errors.date = 'required';
  else if (date === null) errors.date = 'date';

  const reimbursed = pays ? parseCentsInput(values.reimbursedAmount, formats.locale) : null;
  const rejected = pays ? parseCentsInput(values.rejectedAmount, formats.locale) : null;
  if (pays && reimbursed === null) errors.reimbursedAmount = 'required';
  if (reimbursed === 'invalid') errors.reimbursedAmount = 'cents';
  if (rejected === 'invalid') errors.rejectedAmount = 'cents';
  if (values.note.trim().length > 500) errors.note = 'maxLength';

  if (!errors.reimbursedAmount && !errors.rejectedAmount && pays) {
    const problem = checkNewEntry(context.amount, context.entries, {
      reimbursedAmount: reimbursed as number,
      rejectedAmount: rejected as number | null,
    });
    if (problem) errors.reimbursedAmount = 'aboveInvoice';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const request: Omit<CreateEntryRequestInput, 'documents'> = {
    status,
    date: date as string,
    note: values.note.trim(),
    ...(pays ? { reimbursedAmount: reimbursed as number } : {}),
    ...(pays && rejected !== null ? { rejectedAmount: rejected as number } : {}),
  };
  // Final guard with the schema the API uses.
  if (!createEntryRequestSchema.safeParse(request).success) {
    return { ok: false, errors: { status: 'required' } };
  }
  return { ok: true, request };
}

/** Preview under the amounts: what the totals will be once the entry is saved. */
export function entryPreview(
  values: Pick<EntryFormValues, 'status' | 'reimbursedAmount' | 'rejectedAmount'>,
  locale: AppLocale,
  context: EntryContext,
): { reimbursed: number; difference: number } | null {
  if (!isPaymentStatus(values.status as ReimbursementStatus)) return null;
  const reimbursed = parseCentsInput(values.reimbursedAmount, locale);
  if (reimbursed === null || reimbursed === 'invalid') return null;
  const before = context.entries.reduce((sum, e) => sum + (e.reimbursedAmount ?? 0), 0);
  const total = before + reimbursed;
  return { reimbursed: total, difference: context.amount - total };
}

/** Prefill for a final payment: everything not reimbursed or rejected yet. */
export function suggestedAmount(status: ReimbursementStatus, context: EntryContext): number | null {
  return status === 'PAID' ? remainingAmount(context.amount, context.entries) : null;
}
