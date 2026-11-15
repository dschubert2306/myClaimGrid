import {
  differenceToInvoice,
  isPaymentStatus,
  planReimbursementChange,
  reimbursementStatusSchema,
  type Claim,
  type ExtractableField,
  type ReimbursementEntry,
  type ReimbursementStatus,
  type SaveClaimRequestInput,
} from '@myclaimgrid/shared';
import { formatAmountPlain, formatInvoiceDate } from './format';
import { todayIso, type Formats } from './date-format';
import type { AppLocale } from './locale';
import { parseAmountInput, parseDateInput } from './parse-input';

/**
 * Logic of the claim dialog (invoice data, submission, reimbursement, payment), free of Angular so
 * it can be tested directly. The form holds what the user sees (text in the active language, the
 * payment toggle), the API gets ISO dates and cents. The reimbursement rules come from the shared
 * package, the server runs the same ones.
 */

export const CLAIM_FIELD_NAMES = [
  'provider',
  'invoiceNumber',
  'invoiceDate',
  'amount',
  'description',
  'submittedAt',
  'status',
  'reimbursementDate',
  'reimbursedAmount',
  'rejectedAmount',
  'note',
  'paidAt',
] as const;
export type ClaimFieldName = (typeof CLAIM_FIELD_NAMES)[number];
/** Every field is text; the payment toggle is the only boolean. */
export type ClaimFormValues = Record<ClaimFieldName, string> & { paid: boolean };
export type FieldErrorKey =
  | 'required'
  | 'date'
  | 'amount'
  | 'cents'
  | 'maxLength'
  | 'aboveInvoice'
  | 'belowReimbursed'
  | 'dateBeforeLatest'
  | 'tooManyEntries';

const MAX_LENGTH: Record<ClaimFieldName, number> = {
  provider: 200,
  invoiceNumber: 100,
  invoiceDate: 20,
  amount: 20,
  description: 500,
  submittedAt: 20,
  status: 20,
  reimbursementDate: 20,
  reimbursedAmount: 20,
  rejectedAmount: 20,
  note: 500,
  paidAt: 20,
};

export const EMPTY_CLAIM_FORM: ClaimFormValues = {
  provider: '',
  invoiceNumber: '',
  invoiceDate: '',
  amount: '',
  description: '',
  submittedAt: '',
  status: 'OPEN',
  reimbursementDate: '',
  reimbursedAmount: '',
  rejectedAmount: '',
  note: '',
  paid: false,
  paidAt: '',
};

/** Amount of zero or more: "0", "0,00" and "1.234,56" are valid, empty is null. */
export function parseCentsInput(input: string, locale: AppLocale): number | null | 'invalid' {
  const text = input.replace(/[\s\u00a0\u202f]/g, '').replace(/EUR|€/gi, '');
  if (text === '') return null;
  if (/^0+(?:[.,]0{1,2})?$/.test(text)) return 0;
  return parseAmountInput(text, locale) ?? 'invalid';
}

const isStatus = (value: string): value is ReimbursementStatus =>
  reimbursementStatusSchema.safeParse(value).success;

/** The date, amounts and note of the reimbursement are shown once there is something to track. */
export function showsReimbursementDetails(
  status: string,
  entries: readonly ReimbursementEntry[],
): boolean {
  return status !== 'OPEN' || entries.length > 0;
}

/** The claim's own history, newest first: the dialog shows it as a plain list. */
export const newestFirst = (entries: readonly ReimbursementEntry[]): ReimbursementEntry[] =>
  [...entries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );

export type ClaimFormRequest = Omit<
  SaveClaimRequestInput,
  'version' | 'newDocuments' | 'removedDocumentIds'
>;

export type ClaimFormResult =
  | { ok: true; request: ClaimFormRequest }
  | { ok: false; errors: Partial<Record<ClaimFieldName, FieldErrorKey>> };

/** Validates the whole form against the history of the claim and converts it to the API shape. */
export function toClaimRequest(
  values: ClaimFormValues,
  formats: Formats,
  entries: readonly ReimbursementEntry[],
): ClaimFormResult {
  const errors: Partial<Record<ClaimFieldName, FieldErrorKey>> = {};
  const text = (name: ClaimFieldName) => values[name].trim();
  const date = (name: ClaimFieldName): string | null | 'invalid' =>
    text(name) === '' ? null : (parseDateInput(text(name), formats.dateFormat) ?? 'invalid');

  for (const name of CLAIM_FIELD_NAMES) {
    if (values[name].trim().length > MAX_LENGTH[name]) errors[name] = 'maxLength';
  }

  // Invoice
  if (text('provider') === '' && !errors.provider) errors.provider = 'required';
  const invoiceDate = date('invoiceDate');
  if (invoiceDate === null) errors.invoiceDate ??= 'required';
  else if (invoiceDate === 'invalid') errors.invoiceDate ??= 'date';
  const amount = text('amount') === '' ? null : parseAmountInput(text('amount'), formats.locale);
  if (text('amount') === '') errors.amount ??= 'required';
  else if (amount === null) errors.amount ??= 'amount';

  // Submission to the insurer: optional
  const submittedAt = date('submittedAt');
  if (submittedAt === 'invalid') errors.submittedAt ??= 'date';

  // Payment status: the date belongs to the toggle and is required while it is on
  const paidAt = values.paid ? date('paidAt') : null;
  if (values.paid && paidAt === null) errors.paidAt ??= 'required';
  else if (paidAt === 'invalid') errors.paidAt ??= 'date';

  // Reimbursement
  const status: ReimbursementStatus = isStatus(values.status) ? values.status : 'OPEN';
  const details = showsReimbursementDetails(status, entries);
  const pays = isPaymentStatus(status);
  const reimbursementDate = details ? date('reimbursementDate') : null;
  if (reimbursementDate === 'invalid') errors.reimbursementDate ??= 'date';
  const reimbursed = pays ? parseCentsInput(values.reimbursedAmount, formats.locale) : null;
  const rejected = pays ? parseCentsInput(values.rejectedAmount, formats.locale) : null;
  if (pays && reimbursed === null) errors.reimbursedAmount ??= 'required';
  if (reimbursed === 'invalid') errors.reimbursedAmount ??= 'cents';
  if (rejected === 'invalid') errors.rejectedAmount ??= 'cents';

  const comparable =
    amount !== null &&
    reimbursementDate !== 'invalid' &&
    reimbursed !== 'invalid' &&
    rejected !== 'invalid' &&
    !(pays && reimbursed === null);
  if (comparable) {
    const plan = planReimbursementChange(amount, entries, {
      status,
      date: reimbursementDate ?? undefined,
      reimbursedAmount: pays ? (reimbursed as number) : undefined,
      rejectedAmount: pays && rejected !== null ? (rejected as number) : undefined,
      note: details ? values.note : '',
    });
    if (!plan.ok) {
      switch (plan.problem) {
        case 'amount_above_invoice':
          if (pays) errors.reimbursedAmount ??= 'aboveInvoice';
          else errors.amount ??= 'belowReimbursed';
          break;
        case 'date_required':
          errors.reimbursementDate ??= 'required';
          break;
        case 'date_before_latest':
          errors.reimbursementDate ??= 'dateBeforeLatest';
          break;
        case 'too_many_entries':
          errors.status ??= 'tooManyEntries';
          break;
      }
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    request: {
      provider: text('provider'),
      invoiceNumber: text('invoiceNumber'),
      invoiceDate: invoiceDate as string,
      amount: amount as number,
      description: text('description'),
      submittedAt: submittedAt as string | null,
      paid: values.paid,
      paidAt: paidAt as string | null,
      reimbursement: {
        status,
        ...(reimbursementDate ? { date: reimbursementDate } : {}),
        ...(pays ? { reimbursedAmount: reimbursed as number } : {}),
        ...(pays && rejected !== null ? { rejectedAmount: rejected as number } : {}),
        note: details ? text('note') : '',
      },
    },
  };
}

/** Claim from the API -> text shown in the form. Missing values stay empty, nothing is guessed. */
export function fromClaim(claim: Claim, formats: Formats): ClaimFormValues {
  const { status, entries, reimbursed, rejected } = claim.reimbursement;
  const latest = newestFirst(entries)[0];
  const iso = (value: string | null) => (value ? formatInvoiceDate(value, formats.dateFormat) : '');
  return {
    provider: claim.provider ?? '',
    invoiceNumber: claim.invoiceNumber ?? '',
    invoiceDate: iso(claim.invoiceDate),
    amount: claim.amount !== null ? formatAmountPlain(claim.amount, formats.locale) : '',
    description: claim.description ?? '',
    submittedAt: iso(claim.submittedAt),
    status,
    // The dialog shows the current state: the totals, and the date of the latest entry.
    reimbursementDate: iso(latest?.date ?? null),
    reimbursedAmount:
      isPaymentStatus(status) || reimbursed > 0
        ? formatAmountPlain(reimbursed, formats.locale)
        : '',
    rejectedAmount: rejected > 0 ? formatAmountPlain(rejected, formats.locale) : '',
    note: '',
    paid: claim.paidAt !== null,
    paidAt: iso(claim.paidAt),
  };
}

/**
 * The payment date after the toggle was switched by the user. Switching on fills the current date
 * (date only, local time zone of the browser) so the user can change it. Switching off clears it.
 * This is only called for a switch, never when a saved claim is opened, so a saved date stays.
 */
export function paymentDateAfterToggle(
  paid: boolean,
  currentText: string,
  formats: Formats,
  now: Date = new Date(),
): string {
  if (!paid) return '';
  return currentText.trim() === ''
    ? formatInvoiceDate(todayIso(now), formats.dateFormat)
    : currentText;
}

/** Whether status or totals in the form differ from what the claim had when the dialog opened. */
export function reimbursementDiffers(
  values: Pick<ClaimFormValues, 'status' | 'reimbursedAmount' | 'rejectedAmount'>,
  baseline: Pick<ClaimFormValues, 'status' | 'reimbursedAmount' | 'rejectedAmount'>,
  locale: AppLocale,
): boolean {
  if (values.status !== baseline.status) return true;
  if (!isStatus(values.status) || !isPaymentStatus(values.status)) return false;
  const cents = (text: string) => parseCentsInput(text, locale) ?? 0;
  return (
    cents(values.reimbursedAmount) !== cents(baseline.reimbursedAmount) ||
    cents(values.rejectedAmount) !== cents(baseline.rejectedAmount)
  );
}

/**
 * The date of a changed reimbursement follows the change until the user picks one: today when the
 * status or a total differs from the opened claim, the date of the latest entry when it is back to
 * what it was (so undoing an edit does not leave a date that would count as a change).
 */
export function reimbursementDateFor(
  values: Pick<ClaimFormValues, 'status' | 'reimbursedAmount' | 'rejectedAmount'>,
  baseline: Pick<
    ClaimFormValues,
    'status' | 'reimbursedAmount' | 'rejectedAmount' | 'reimbursementDate'
  >,
  formats: Formats,
  now: Date = new Date(),
): string {
  return reimbursementDiffers(values, baseline, formats.locale)
    ? formatInvoiceDate(todayIso(now), formats.dateFormat)
    : baseline.reimbursementDate;
}

/**
 * A final payment (PAID) is prefilled with everything the invoice has left after the rejected
 * amount, the user can still change it. Other statuses suggest nothing.
 */
export function suggestedReimbursement(
  status: string,
  values: Pick<ClaimFormValues, 'amount' | 'rejectedAmount'>,
  locale: AppLocale,
): number | null {
  if (status !== 'PAID') return null;
  const amount = parseAmountInput(values.amount, locale);
  const rejected = parseCentsInput(values.rejectedAmount, locale);
  if (amount === null || rejected === 'invalid') return null;
  return Math.max(0, amount - (rejected ?? 0));
}

/** Under the amounts of a partial reimbursement: what is reimbursed and what is still missing. */
export function reimbursementPreview(
  values: Pick<ClaimFormValues, 'status' | 'amount' | 'reimbursedAmount'>,
  locale: AppLocale,
): { reimbursed: number; amount: number; difference: number } | null {
  if (values.status !== 'PARTLY_PAID') return null;
  const amount = parseAmountInput(values.amount, locale);
  const reimbursed = parseCentsInput(values.reimbursedAmount, locale);
  if (amount === null || reimbursed === null || reimbursed === 'invalid') return null;
  return { reimbursed, amount, difference: differenceToInvoice(amount, reimbursed) };
}

export interface FieldMarkers {
  /** Prefilled from the PDF ("Aus PDF"). */
  extracted: ExtractableField[];
  /** Left empty by the extraction ("Nicht erkannt"). */
  missing: ExtractableField[];
}

const MARKABLE: ExtractableField[] = ['provider', 'invoiceNumber', 'invoiceDate', 'amount'];

/** Which fields carry a tag after an invoice upload. Only a finished extraction marks anything. */
export function fieldMarkers(
  claim: Pick<Claim, 'source' | 'extractionStatus' | 'extraction'>,
): FieldMarkers {
  if (claim.source !== 'EXTRACTED' || claim.extractionStatus !== 'DONE') {
    return { extracted: [], missing: [] };
  }
  const confidence = claim.extraction?.confidence ?? {};
  const extracted = MARKABLE.filter((field) => confidence[field] !== undefined);
  return { extracted, missing: MARKABLE.filter((field) => !extracted.includes(field)) };
}
