import type { ReimbursementStatus } from './schemas.js';

/**
 * Status and amount logic of the reimbursement history, used by the API (validation, totals)
 * and by the frontend (hints in the entry dialog). Amounts are integer cents.
 *
 * Model: every PAID or PARTLY_PAID entry is one payment, so several partial reimbursements add up.
 * Rejected amounts (or a deductible the insurer kept) add up the same way. PAID closes the claim:
 * whatever is still neither reimbursed nor rejected is then borne by the user, not outstanding.
 */

export interface EntryAmounts {
  status: ReimbursementStatus;
  date: string;
  reimbursedAmount: number | null;
  rejectedAmount: number | null;
  createdAt: string;
}

export interface ReimbursementTotals {
  status: ReimbursementStatus;
  reimbursed: number;
  rejected: number;
  outstanding: number;
  selfBorne: number;
}

/** Oldest first: by the entry date, then by the time it was recorded (same-day entries). */
export function sortEntries<T extends Pick<EntryAmounts, 'date' | 'createdAt'>>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
}

/** The status of the most recent entry, OPEN when there is no history yet. */
export function currentStatus(
  entries: readonly Pick<EntryAmounts, 'status' | 'date' | 'createdAt'>[],
): ReimbursementStatus {
  return sortEntries(entries).at(-1)?.status ?? 'OPEN';
}

const sum = (values: (number | null)[]) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

export function reimbursementTotals(
  invoiceAmount: number | null,
  entries: readonly EntryAmounts[],
): ReimbursementTotals {
  const amount = invoiceAmount ?? 0;
  const status = currentStatus(entries);
  const reimbursed = sum(entries.map((e) => e.reimbursedAmount));
  const rejected = sum(entries.map((e) => e.rejectedAmount));
  const rest = Math.max(0, amount - reimbursed - rejected);
  return status === 'PAID'
    ? { status, reimbursed, rejected, outstanding: 0, selfBorne: rejected + rest }
    : { status, reimbursed, rejected, outstanding: rest, selfBorne: rejected };
}

/** What has not been reimbursed or rejected yet. Prefills the amount of a final payment. */
export function remainingAmount(invoiceAmount: number, entries: readonly EntryAmounts[]): number {
  const reimbursed = sum(entries.map((e) => e.reimbursedAmount));
  const rejected = sum(entries.map((e) => e.rejectedAmount));
  return Math.max(0, invoiceAmount - reimbursed - rejected);
}

/** Lowest invoice amount the history allows: everything reimbursed and rejected so far. */
export function minimumInvoiceAmount(entries: readonly EntryAmounts[]): number {
  return sum(entries.map((e) => e.reimbursedAmount)) + sum(entries.map((e) => e.rejectedAmount));
}

export type EntryProblem = 'amount_above_invoice';

/**
 * Checks a new entry against the claim: the reimbursed amounts, together with the rejected ones,
 * may never exceed the invoice amount. Field level rules (amounts only for payments, not negative)
 * are in createEntryRequestSchema.
 */
export function checkNewEntry(
  invoiceAmount: number,
  entries: readonly EntryAmounts[],
  candidate: Pick<EntryAmounts, 'reimbursedAmount' | 'rejectedAmount'>,
): EntryProblem | null {
  const total =
    minimumInvoiceAmount(entries) +
    (candidate.reimbursedAmount ?? 0) +
    (candidate.rejectedAmount ?? 0);
  return total > invoiceAmount ? 'amount_above_invoice' : null;
}

// ---------------------------------------------------------------- filters

/** Filter of the claim list by reimbursement. `NOT_REIMBURSED` is every status except PAID. */
export type ReimbursementFilter = 'ALL' | 'NOT_SUBMITTED' | 'NOT_REIMBURSED' | ReimbursementStatus;
export type PaymentFilter = 'ALL' | 'PAID' | 'UNPAID';

export interface FilterableClaim {
  submittedAt: string | null;
  paidAt: string | null;
  reimbursement: { status: ReimbursementStatus };
}

export function matchesFilters(
  claim: FilterableClaim,
  filters: { reimbursement: ReimbursementFilter; payment: PaymentFilter },
): boolean {
  const status = claim.reimbursement.status;
  const reimbursementOk =
    filters.reimbursement === 'ALL' ||
    (filters.reimbursement === 'NOT_SUBMITTED' && claim.submittedAt === null) ||
    (filters.reimbursement === 'NOT_REIMBURSED' && status !== 'PAID') ||
    filters.reimbursement === status;
  const paymentOk =
    filters.payment === 'ALL' ||
    (filters.payment === 'PAID' && claim.paidAt !== null) ||
    (filters.payment === 'UNPAID' && claim.paidAt === null);
  return reimbursementOk && paymentOk;
}
