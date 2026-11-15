import type {
  Claim,
  ClaimSource,
  ClaimStatus,
  Extraction,
  ExtractionStatus,
  InsurerDocument,
  Person,
  PersonColor,
  ReimbursementEntry,
} from '@myclaimgrid/shared';
import { CURRENCY, reimbursementTotals, sortEntries } from '@myclaimgrid/shared';

/** DynamoDB item shapes. There is no attribute for bank data anywhere. */

export interface PersonItem {
  pk: string; // USER#<sub>
  sk: string; // PERSON#<personId>
  entity: 'PERSON';
  personId: string;
  name: string;
  color: PersonColor;
  deductible?: number; // integer cents, absent on items written before the setting existed
  createdAt: string;
}

export interface ClaimItem {
  pk: string; // PERSON#<personId>
  sk: string; // CLAIM#DRAFT#<claimId> or CLAIM#<invoiceDate>#<claimId>
  gsi1pk: string; // CLAIM#<claimId>
  entity: 'CLAIM';
  userSub: string;
  claimId: string;
  personId: string;
  status: ClaimStatus;
  source: ClaimSource;
  year: number | null;
  provider: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: number | null; // integer cents
  currency: typeof CURRENCY;
  description: string | null;
  s3Key?: string;
  extractionStatus?: ExtractionStatus;
  extraction?: Extraction;
  // The attributes below are absent on items written before the reimbursement tracking existed.
  // Reading them as "not submitted, not paid, no history (OPEN), no documents" is the migration,
  // see toClaim. Payment status is `paidAt`: set means the toggle "invoice paid" is on.
  submittedAt?: string | null;
  paidAt?: string | null;
  reimbursementEntries?: EntryItem[];
  insurerDocuments?: DocumentItem[];
  createdAt: string;
  updatedAt: string;
}

/** An insurer document as stored: the S3 key stays on the server. */
export interface DocumentItem extends InsurerDocument {
  s3Key: string; // insurer/<sub>/<claimId>/<documentId>
}

/**
 * A history entry as stored. Release 3 attached documents to entries: `documents` is only ever
 * read from such old items (see claimDocuments) and never written again.
 */
export interface EntryItem extends ReimbursementEntry {
  documents?: DocumentItem[];
}

function toEntry(item: EntryItem): ReimbursementEntry {
  return {
    entryId: item.entryId,
    status: item.status,
    date: item.date,
    reimbursedAmount: item.reimbursedAmount,
    rejectedAmount: item.rejectedAmount,
    note: item.note,
    createdAt: item.createdAt,
  };
}

function toDocument(item: DocumentItem): InsurerDocument {
  return {
    documentId: item.documentId,
    fileName: item.fileName,
    contentType: item.contentType,
    size: item.size,
    uploadedAt: item.uploadedAt,
  };
}

/**
 * All insurer documents of a claim: the claim's own list plus the ones old items still carry on
 * their history entries. Nothing is lost on the way to the new model, and the next save moves them
 * (see withMigratedDocuments).
 */
export function claimDocuments(item: Pick<ClaimItem, 'insurerDocuments' | 'reimbursementEntries'>) {
  const all = [
    ...(item.insurerDocuments ?? []),
    ...(item.reimbursementEntries ?? []).flatMap((e) => e.documents ?? []),
  ];
  const seen = new Set<string>();
  return all
    .filter((d) => !seen.has(d.documentId) && seen.add(d.documentId))
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

/** The item as it is written back: documents on the claim, none left on the history entries. */
export function withMigratedDocuments(item: ClaimItem): ClaimItem {
  return {
    ...item,
    insurerDocuments: claimDocuments(item),
    reimbursementEntries: (item.reimbursementEntries ?? []).map(
      ({ documents: _legacy, ...entry }) => entry,
    ),
  };
}

export function toPerson(item: PersonItem): Person {
  return {
    personId: item.personId,
    name: item.name,
    color: item.color,
    deductible: item.deductible ?? 0,
  };
}

export function toClaim(item: ClaimItem): Claim {
  return {
    claimId: item.claimId,
    personId: item.personId,
    status: item.status,
    source: item.source,
    year: item.year,
    provider: item.provider,
    invoiceNumber: item.invoiceNumber,
    invoiceDate: item.invoiceDate,
    amount: item.amount,
    currency: item.currency,
    description: item.description,
    hasPdf: Boolean(item.s3Key),
    extractionStatus: item.extractionStatus ?? null,
    extraction: item.extraction ?? null,
    submittedAt: item.submittedAt ?? null,
    paidAt: item.paidAt ?? null,
    reimbursement: toReimbursement(item),
    documents: claimDocuments(item).map(toDocument),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toReimbursement(item: Pick<ClaimItem, 'amount' | 'reimbursementEntries'>) {
  const entries = sortEntries(item.reimbursementEntries ?? []);
  return { ...reimbursementTotals(item.amount, entries), entries: entries.map(toEntry) };
}

export function yearOf(invoiceDate: string): number {
  return Number(invoiceDate.slice(0, 4));
}
