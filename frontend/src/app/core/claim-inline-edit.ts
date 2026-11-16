import type { Claim, ReimbursementStatus } from '@myclaimgrid/shared';
import {
  fromClaim,
  paymentDateAfterToggle,
  reimbursementDateFor,
  suggestedReimbursement,
  toClaimRequest,
  type ClaimFieldName,
  type ClaimFormResult,
  type ClaimFormValues,
} from './claim-form';
import type { Formats } from './date-format';
import { formatAmountPlain } from './format';

/**
 * Inline editing in the claim table: one cell changes, everything else stays as saved. The change
 * is applied to the claim as the dialog would show it and then validated and converted by the same
 * code the dialog uses (toClaimRequest), so a cell can never save what the dialog would refuse.
 * Free of Angular, so it can be tested directly.
 */

export const TEXT_FIELDS = [
  'provider',
  'invoiceNumber',
  'invoiceDate',
  'amount',
  'paidAt',
] as const;
export type InlineTextField = (typeof TEXT_FIELDS)[number];

export type InlineEdit =
  | { field: InlineTextField; text: string }
  | { field: 'status'; status: ReimbursementStatus }
  | { field: 'paid'; paid: boolean };

/** The field a validation error is shown at: the edited one, or the one the change spilled into. */
export type InlineField = InlineEdit['field'];

/**
 * Text of a cell as the editor starts with it: in the format of the active language, the same text
 * the dialog shows.
 */
export function editText(claim: Claim, field: InlineTextField, formats: Formats): string {
  return fromClaim(claim, formats)[field];
}

/** The save request for one changed cell, or the validation errors of the dialog's rules. */
export function inlineEditRequest(
  claim: Claim,
  edit: InlineEdit,
  formats: Formats,
  now: Date = new Date(),
): ClaimFormResult {
  const baseline = fromClaim(claim, formats);
  const values: ClaimFormValues = { ...baseline };

  switch (edit.field) {
    case 'status':
      values.status = edit.status;
      // Same as choosing the status in the dialog: the date is today and a final payment is
      // prefilled with what the invoice has left. A partial payment needs an amount, which the
      // table cannot ask for, so that one stays in the dialog.
      values.reimbursementDate = reimbursementDateFor(values, baseline, formats, now);
      if (edit.status !== baseline.status) {
        const suggested = suggestedReimbursement(edit.status, values, formats.locale);
        if (suggested !== null)
          values.reimbursedAmount = formatAmountPlain(suggested, formats.locale);
      }
      break;
    case 'paid':
      values.paid = edit.paid;
      values.paidAt = paymentDateAfterToggle(edit.paid, baseline.paidAt, formats, now);
      break;
    default:
      values[edit.field] = edit.text;
  }
  return toClaimRequest(values, formats, claim.reimbursement.entries);
}

/** Translation key (under errors.) of what is wrong with the edit, for the edited cell first. */
export function inlineEditError(
  result: Extract<ClaimFormResult, { ok: false }>,
  field: InlineField,
): string {
  const own: Partial<Record<InlineField, ClaimFieldName[]>> = {
    provider: ['provider'],
    invoiceNumber: ['invoiceNumber'],
    invoiceDate: ['invoiceDate'],
    amount: ['amount'],
    paidAt: ['paidAt'],
    paid: ['paidAt'],
    status: ['status', 'reimbursedAmount', 'reimbursementDate'],
  };
  const names = [...(own[field] ?? []), ...(Object.keys(result.errors) as ClaimFieldName[])];
  const key = names.map((name) => result.errors[name]).find((value) => value !== undefined);
  return key ?? 'required';
}
