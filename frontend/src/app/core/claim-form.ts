import {
  claimFieldsSchema,
  type Claim,
  type ClaimFields,
  type ExtractableField,
} from '@myclaimgrid/shared';
import { formatAmountPlain, formatInvoiceDate } from './format';
import type { AppLocale } from './locale';
import { parseAmountInput, parseDateInput } from './parse-input';

/**
 * Logic of the five claim fields, free of Angular so it can be tested directly.
 * The form holds what the user sees (text in the active language), the API gets ISO dates and cents.
 */

export const CLAIM_FIELD_NAMES = [
  'provider',
  'invoiceNumber',
  'invoiceDate',
  'amount',
  'description',
] as const;
export type ClaimFieldName = (typeof CLAIM_FIELD_NAMES)[number];
export type ClaimFormValues = Record<ClaimFieldName, string>;
export type FieldErrorKey = 'required' | 'date' | 'amount' | 'maxLength';

const MAX_LENGTH: Record<ClaimFieldName, number> = {
  provider: 200,
  invoiceNumber: 100,
  invoiceDate: 20,
  amount: 20,
  description: 500,
};

export const EMPTY_CLAIM_FORM: ClaimFormValues = {
  provider: '',
  invoiceNumber: '',
  invoiceDate: '',
  amount: '',
  description: '',
};

export function validateField(
  name: ClaimFieldName,
  rawValue: string | null | undefined,
  locale: AppLocale,
): FieldErrorKey | null {
  const value = (rawValue ?? '').trim();
  if (value.length > MAX_LENGTH[name]) return 'maxLength';
  switch (name) {
    case 'provider':
      return value === '' ? 'required' : null;
    case 'invoiceDate':
      if (value === '') return 'required';
      return parseDateInput(value, locale) === null ? 'date' : null;
    case 'amount':
      if (value === '') return 'required';
      return parseAmountInput(value, locale) === null ? 'amount' : null;
    default:
      return null;
  }
}

export type ClaimFormResult =
  | { ok: true; fields: ClaimFields }
  | { ok: false; errors: Partial<Record<ClaimFieldName, FieldErrorKey>> };

/** Validates the form and converts it to the API shape. */
export function toClaimFields(values: ClaimFormValues, locale: AppLocale): ClaimFormResult {
  const errors: Partial<Record<ClaimFieldName, FieldErrorKey>> = {};
  for (const name of CLAIM_FIELD_NAMES) {
    const error = validateField(name, values[name], locale);
    if (error) errors[name] = error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const candidate = {
    provider: values.provider.trim(),
    invoiceNumber: values.invoiceNumber.trim(),
    invoiceDate: parseDateInput(values.invoiceDate, locale),
    amount: parseAmountInput(values.amount, locale),
    description: values.description.trim(),
  };
  // Final guard with the same schema the API uses.
  const parsed = claimFieldsSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: { provider: 'required' } };
  return { ok: true, fields: parsed.data };
}

/** Claim from the API -> text shown in the form. Missing values stay empty, nothing is guessed. */
export function fromClaim(claim: Claim, locale: AppLocale): ClaimFormValues {
  return {
    provider: claim.provider ?? '',
    invoiceNumber: claim.invoiceNumber ?? '',
    invoiceDate: claim.invoiceDate ? formatInvoiceDate(claim.invoiceDate, locale) : '',
    amount: claim.amount !== null ? formatAmountPlain(claim.amount, locale) : '',
    description: claim.description ?? '',
  };
}

export interface FieldMarkers {
  /** Prefilled from the PDF ("Aus PDF"). */
  extracted: ExtractableField[];
  /** Left empty by the extraction ("Nicht erkannt"). */
  missing: ExtractableField[];
}

const MARKABLE: ExtractableField[] = ['provider', 'invoiceNumber', 'invoiceDate', 'amount'];

/** Which fields carry a tag in the review step. Only a finished extraction marks anything. */
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
