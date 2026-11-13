import type {
  Claim,
  ClaimSource,
  ClaimStatus,
  Extraction,
  ExtractionStatus,
  Person,
  PersonColor,
} from '@myclaimgrid/shared';
import { CURRENCY } from '@myclaimgrid/shared';

/** DynamoDB item shapes. There is no attribute for bank data anywhere. */

export interface PersonItem {
  pk: string; // USER#<sub>
  sk: string; // PERSON#<personId>
  entity: 'PERSON';
  personId: string;
  name: string;
  color: PersonColor;
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
  createdAt: string;
  updatedAt: string;
}

export function toPerson(item: PersonItem): Person {
  return { personId: item.personId, name: item.name, color: item.color };
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
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function yearOf(invoiceDate: string): number {
  return Number(invoiceDate.slice(0, 4));
}
