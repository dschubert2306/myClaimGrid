import { MAX_ENTRIES_PER_CLAIM, isPaymentStatus } from './schemas.js';
import type { ReimbursementStatus } from './schemas.js';

/**
 * Status and amount logic of the reimbursement history, used by the API (validation, totals)
 * and by the frontend (the claim dialog). Amounts are integer cents.
 *
 * Model: the history is the data basis. The claim dialog edits the current state (status, total
 * reimbursed, total rejected), and saving appends one entry with what changed, so the totals are
 * always the sum of all entries and several partial reimbursements add up. Rejected amounts (or a
 * deductible the insurer kept) add up the same way. PAID closes the claim: whatever is still
 * neither reimbursed nor rejected is then borne by the user, not outstanding.
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

/** Invoice amount minus everything reimbursed so far, shown for PARTLY_PAID. */
export const differenceToInvoice = (invoiceAmount: number, reimbursed: number): number =>
  invoiceAmount - reimbursed;

/** What the dialog sends for the reimbursement block, see reimbursementInputSchema. */
export interface ReimbursementChangeInput {
  status: ReimbursementStatus;
  date?: string | undefined;
  /** Total reimbursed so far, only for PAID and PARTLY_PAID. */
  reimbursedAmount?: number | undefined;
  /** Total rejected so far, only for PAID and PARTLY_PAID, absent means none. */
  rejectedAmount?: number | undefined;
  note?: string | undefined;
}

/** The entry a save appends. Amounts are the change since the last state, so they add up. */
export interface PlannedEntry {
  status: ReimbursementStatus;
  date: string;
  reimbursedAmount: number | null;
  rejectedAmount: number | null;
  note: string;
}

export type ChangeProblem =
  'date_required' | 'date_before_latest' | 'amount_above_invoice' | 'too_many_entries';

export type ChangePlan =
  { ok: true; entry: PlannedEntry | null } | { ok: false; problem: ChangeProblem };

/**
 * Compares the saved dialog state with the history. No change, no entry. Any change of the status,
 * the totals, the date or a note creates exactly one entry, so every save that changes the
 * reimbursement data is traceable. The rules (also run by the server):
 * - reimbursed and rejected may never exceed the invoice amount (also after the invoice amount was
 *   lowered, so it cannot go below what was already reimbursed or rejected),
 * - a change needs a date, and not one before the latest entry (the status follows the latest entry),
 * - a status without payment (OPEN, IN_PROGRESS) keeps the totals as they are.
 */
export function planReimbursementChange(
  invoiceAmount: number,
  entries: readonly EntryAmounts[],
  input: ReimbursementChangeInput,
): ChangePlan {
  const sorted = sortEntries(entries);
  const status = sorted.at(-1)?.status ?? 'OPEN';
  const latestDate = sorted.at(-1)?.date;
  const reimbursedBefore = sum(sorted.map((e) => e.reimbursedAmount));
  const rejectedBefore = sum(sorted.map((e) => e.rejectedAmount));

  const pays = isPaymentStatus(input.status);
  const reimbursed = pays ? (input.reimbursedAmount ?? 0) : reimbursedBefore;
  const rejected = pays ? (input.rejectedAmount ?? 0) : rejectedBefore;
  if (reimbursed + rejected > invoiceAmount) return { ok: false, problem: 'amount_above_invoice' };

  const note = (input.note ?? '').trim();
  const changed =
    input.status !== status ||
    reimbursed !== reimbursedBefore ||
    rejected !== rejectedBefore ||
    note !== '' ||
    (input.date !== undefined && input.date !== latestDate);
  if (!changed) return { ok: true, entry: null };

  if (input.date === undefined) return { ok: false, problem: 'date_required' };
  if (latestDate !== undefined && input.date < latestDate) {
    return { ok: false, problem: 'date_before_latest' };
  }
  if (sorted.length >= MAX_ENTRIES_PER_CLAIM) return { ok: false, problem: 'too_many_entries' };

  return {
    ok: true,
    entry: {
      status: input.status,
      date: input.date,
      reimbursedAmount: pays ? reimbursed - reimbursedBefore : null,
      rejectedAmount: pays ? rejected - rejectedBefore : null,
      note,
    },
  };
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
