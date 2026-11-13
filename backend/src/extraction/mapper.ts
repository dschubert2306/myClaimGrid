import type { ExpenseDocument, ExpenseField } from '@aws-sdk/client-textract';
import type { ExtractionResult } from './extractor';
import { parseAmountToCents, parseInvoiceDate } from '../lib/parse';

/**
 * Maps a Textract expense document to the claim fields. This is an allow list:
 * only the five types below are read. Everything else, bank details included, is ignored
 * and the raw response is discarded by the caller.
 */

const PROVIDER_TYPES = ['VENDOR_NAME'];
const NUMBER_TYPES = ['INVOICE_RECEIPT_ID'];
const DATE_TYPES = ['INVOICE_RECEIPT_DATE'];
const TOTAL_TYPES = ['TOTAL', 'AMOUNT_DUE']; // in order of preference

// Defensive: a value that looks like an IBAN is never stored, whichever field it came from.
const IBAN_LIKE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/;

interface Candidate {
  text: string;
  confidence: number;
}

function candidates(doc: ExpenseDocument, types: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const field of doc.SummaryFields ?? []) {
    const type = field.Type?.Text;
    const text = field.ValueDetection?.Text?.trim();
    if (!type || !types.includes(type) || !text) continue;
    out.push({ text, confidence: field.ValueDetection?.Confidence ?? 0 });
  }
  return out;
}

function best<T>(
  list: Candidate[],
  parse: (text: string) => T | null,
): { value: T; confidence: number } | undefined {
  let result: { value: T; confidence: number } | undefined;
  for (const candidate of list) {
    const value = parse(candidate.text);
    if (value === null) continue;
    if (!result || candidate.confidence > result.confidence) {
      result = { value, confidence: candidate.confidence };
    }
  }
  return result;
}

function cleanText(text: string, maxLength: number): string | null {
  const value = text.replace(/\s+/g, ' ').trim();
  if (value === '' || value.length > maxLength || IBAN_LIKE.test(value)) return null;
  return value;
}

export function mapExpenseDocument(doc: ExpenseDocument | undefined): ExtractionResult {
  const result: ExtractionResult = { fields: {}, confidence: {} };
  if (!doc) return result;

  const provider = best(candidates(doc, PROVIDER_TYPES), (t) => cleanText(t, 200));
  if (provider) {
    result.fields.provider = provider.value;
    result.confidence.provider = round(provider.confidence);
  }

  const number = best(candidates(doc, NUMBER_TYPES), (t) => cleanText(t, 100));
  if (number) {
    result.fields.invoiceNumber = number.value;
    result.confidence.invoiceNumber = round(number.confidence);
  }

  const date = best(candidates(doc, DATE_TYPES), parseInvoiceDate);
  if (date) {
    result.fields.invoiceDate = date.value;
    result.confidence.invoiceDate = round(date.confidence);
  }

  for (const type of TOTAL_TYPES) {
    const amount = best(candidates(doc, [type]), parseAmountToCents);
    if (amount) {
      result.fields.amount = amount.value;
      result.confidence.amount = round(amount.confidence);
      break;
    }
  }

  // AnalyzeExpense has no reliable field for a free-text description, so it is never extracted.
  return result;
}

const round = (value: number) => Math.round(value * 10) / 10;

export type { ExpenseField };
