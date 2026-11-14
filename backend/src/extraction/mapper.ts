import type { ExpenseDocument } from '@aws-sdk/client-textract';
import type { ExtractionResult } from './extractor';
import { findAmountInText, parseInvoiceDate } from '../lib/parse';

/**
 * Maps Textract expense documents to the claim fields. This is an allow list: a value is
 * only read from a normalized Textract type or next to a known printed label (below).
 * Everything else, bank details included, is ignored and the raw response is discarded
 * by the caller.
 *
 * Textract normalizes English invoices well, but on German invoices it often returns
 * "Rechnungsnummer" or "Rechnungsbetrag" as an OTHER field with the printed label, or
 * only as a text line. Each field therefore has tiers, tried in order (see below): the
 * normalized type, an OTHER field with a matching label, a text line "label value", and a
 * few layout fallbacks (the letter's date line, the sum of the line items).
 * Within a tier the most confident readable candidate wins. Missing fields stay empty.
 */

// The label must end there: "Referenz" matches, "Referenzwert" does not.
const END = '(?![a-zäöüß])';
const label = (source: string) => new RegExp(String.raw`\b(?:${source})${END}`, 'i');

// Also compounds: "Honorarrechnung Nr.", "Privatliquidation Nr.", "Abrechnungsnummer".
const INVOICE_NUMBER_LABEL = label(
  String.raw`(?:[a-zäöü]*(?:rechnungs?|liquidations?)|rechn|re|rg|beleg|quittungs?|invoice|receipt|bill)[\s.-]*(?:nummer|number|nr|no|#)\.?|rechnungs-?id`,
);
const REFERENCE_LABEL = label(
  String.raw`referenz(?:nummer|[\s.-]*nr\.?)?|ref(?:erence)?(?:[\s.-]*(?:nummer|number|nr|no)\.?)?|vorgangs(?:nummer|[\s.-]*nr\.?)|fall(?:nummer|[\s.-]*nr\.?)|verwendungszweck`,
);
const TOTAL_LABEL = label(
  String.raw`(?:rechnungs|gesamt|end|zahl)betrag|zu\s+zahlen(?:der\s+betrag)?|(?:rechnungs|gesamt|end)summe|summe|gesamt|(?:invoice\s+)?total(?:\s+amount)?|amount\s+due`,
);
const DATE_LABEL = label(
  String.raw`rechnungs[\s-]*datum|datum\s+der\s+rechnung|rechnung\s+vom|invoice\s+date`,
);
// The date line of a German letter: "München, 19. Oktober 2026", "Berlin, den 12.03.2026".
const PLACE_DATE =
  /^\p{Lu}[\p{L} .-]{1,40},\s*(?:den\s+|am\s+)?(\d{1,2}\.\s*\p{L}+\s+\d{4}|\d{1,2}\.\d{1,2}\.\d{2,4})\s*$/u;

// A labelled value is skipped when its label or line mentions any of these: bank details,
// or amounts that are not the invoice total.
const EXCLUDED =
  /iban|\bbic\b|swift|konto|bank|\bblz\b|zwischen|netto|anzahlung|bereits|abzüglich|minderung|skonto|rabatt|gutschrift/i;
const TAX = /mwst|\bust\b|umsatzsteuer|steuer|\bvat\b|\btax\b/i;
const TAX_INCLUDED = /inkl|incl|brutto/i;

// Defensive: a value that looks like an IBAN is never stored, whichever field it came from.
const IBAN_LIKE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/;

// Types whose printed label is checked. Bank types such as ACCOUNT_NUMBER are never read.
const LABELLED_TYPES = ['OTHER', 'SUBTOTAL', 'AMOUNT_PAID'];

interface Candidate {
  text: string;
  confidence: number;
  fromLine: boolean;
}

type Tier = (docs: ExpenseDocument[]) => Candidate[];

const excluded = (text: string) =>
  EXCLUDED.test(text) || (TAX.test(text) && !TAX_INCLUDED.test(text));

/** A normalized Textract field type. */
const typed =
  (...types: string[]): Tier =>
  (docs) =>
    docs.flatMap((doc) =>
      (doc.SummaryFields ?? []).flatMap((field) => {
        const type = field.Type?.Text;
        const text = field.ValueDetection?.Text?.trim();
        if (!type || !types.includes(type) || !text) return [];
        return [{ text, confidence: field.ValueDetection?.Confidence ?? 0, fromLine: false }];
      }),
    );

/** A field Textract did not normalize, recognized by its printed label. */
const labelled =
  (pattern: RegExp): Tier =>
  (docs) =>
    docs.flatMap((doc) =>
      (doc.SummaryFields ?? []).flatMap((field) => {
        const type = field.Type?.Text ?? '';
        const name = field.LabelDetection?.Text ?? '';
        const text = field.ValueDetection?.Text?.trim();
        if (!LABELLED_TYPES.includes(type) || !text || !pattern.test(name) || excluded(name)) {
          return [];
        }
        return [{ text, confidence: field.ValueDetection?.Confidence ?? 0, fromLine: false }];
      }),
    );

/** A text line with the label and the value on it, such as "Rechnungs-Nr.: R-2026-0042". */
const line =
  (pattern: RegExp): Tier =>
  (docs) =>
    docs.flatMap((doc) =>
      (doc.Blocks ?? []).flatMap((block) => {
        const text = block.BlockType === 'LINE' ? (block.Text ?? '') : '';
        const match = pattern.exec(text);
        if (!match || excluded(text)) return [];
        const value = text.slice(match.index + match[0].length).replace(/^[\s:#.]+/, '');
        if (!value) return [];
        return [{ text: value, confidence: block.Confidence ?? 0, fromLine: true }];
      }),
    );

/** The date line of a letter, such as "München, 19. Oktober 2026". */
const placeDateLine: Tier = (docs) =>
  docs.flatMap((doc) =>
    (doc.Blocks ?? []).flatMap((block) => {
      const match = block.BlockType === 'LINE' ? PLACE_DATE.exec(block.Text ?? '') : null;
      return match?.[1]
        ? [{ text: match[1], confidence: block.Confidence ?? 0, fromLine: true }]
        : [];
    }),
  );

/**
 * The sum of the line items, for invoices that print no total (a single treatment, for
 * example). Gives nothing as soon as one row is unclear: a negative or unreadable price, a
 * deduction, a subtotal or a total row, so nothing is counted twice and nothing is guessed.
 */
function lineItemSum(docs: ExpenseDocument[]): { value: number; confidence: number } | undefined {
  let value = 0;
  let confidence = 100;
  let count = 0;
  for (const item of docs.flatMap((doc) =>
    (doc.LineItemGroups ?? []).flatMap((group) => group.LineItems ?? []),
  )) {
    const fields = item.LineItemExpenseFields ?? [];
    const row = fields.find((f) => f.Type?.Text === 'EXPENSE_ROW')?.ValueDetection?.Text ?? '';
    if (excluded(row) || TOTAL_LABEL.test(row)) return undefined;
    const price = fields.find((f) => f.Type?.Text === 'PRICE')?.ValueDetection;
    if (!price?.Text) continue; // a description that runs over two rows
    const cents = IBAN_LIKE.test(price.Text) ? null : findAmountInText(price.Text);
    if (cents === null) return undefined;
    value += cents;
    confidence = Math.min(confidence, price.Confidence ?? 0);
    count += 1;
  }
  return count > 0 ? { value, confidence } : undefined;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Textract sometimes cuts a vendor name short ("Naturheilpraxis Gabriele") and reads the full
 * one only from a letter-spaced heading ("NATURHEILPRAXI S GABRIELE MÖLLER"). When a longer
 * candidate continues the chosen one, the full name is taken from a text line in normal
 * spelling. Without such a line the chosen name stays as it is.
 */
function fullVendorName(docs: ExpenseDocument[], name: string): string {
  const start = normalize(name);
  const longer = typed('VENDOR_NAME')(docs)
    .map((c) => normalize(c.text))
    .filter((n) => n.length > start.length && n.startsWith(start))
    .sort((a, b) => a.length - b.length)[0];
  if (!longer) return name;
  for (const block of docs.flatMap((doc) => doc.Blocks ?? [])) {
    // Only a line in normal spelling, the all-caps heading is what Textract misread.
    if (block.BlockType !== 'LINE' || !/\p{Ll}/u.test(block.Text ?? '')) continue;
    const words = (block.Text ?? '').split(/\s+/);
    let seen = '';
    for (const [i, word] of words.entries()) {
      seen += normalize(word);
      if (seen === longer) return cleanText(words.slice(0, i + 1).join(' '), 200) ?? name;
      if (!longer.startsWith(seen)) break;
    }
  }
  return name;
}

function pick<T>(
  docs: ExpenseDocument[],
  tiers: Tier[],
  parse: (candidate: Candidate) => T | null,
): { value: T; confidence: number } | undefined {
  for (const tier of tiers) {
    let result: { value: T; confidence: number } | undefined;
    for (const candidate of tier(docs)) {
      const value = parse(candidate);
      if (value === null) continue;
      if (!result || candidate.confidence > result.confidence) {
        result = { value, confidence: candidate.confidence };
      }
    }
    if (result) return result;
  }
  return undefined;
}

function cleanText(text: string, maxLength: number): string | null {
  const value = text.replace(/\s+/g, ' ').trim();
  if (value === '' || value.length > maxLength || IBAN_LIKE.test(value)) return null;
  return value;
}

/**
 * An invoice or reference number: must contain a digit. Text after it ("vom 12.03.2026")
 * is cut off. A value from a text line is reduced to its first token with a digit, so a
 * line such as "Verwendungszweck: Rechnung 4711 Max Muster" gives "4711".
 */
function parseNumber({ text, fromLine }: Candidate): string | null {
  const value = cleanText(text.split(/\s+(?:vom|from|datum|date)\b/i)[0] ?? '', 100);
  if (!value || !/\d/.test(value)) return null;
  if (!fromLine) return value;
  const token = value
    .split(' ')
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .find((t) => /\d/.test(t));
  return token ?? null;
}

export function mapExpenseDocuments(docs: ExpenseDocument[] | undefined): ExtractionResult {
  const result: ExtractionResult = { fields: {}, confidence: {} };
  // Textract can split one page into several documents, for example an invoice and its
  // payment slip, so candidates are pooled across all of them.
  if (!docs?.length) return result;

  const provider = pick(docs, [typed('VENDOR_NAME')], (c) => cleanText(c.text, 200));
  if (provider) {
    result.fields.provider = fullVendorName(docs, provider.value);
    result.confidence.provider = round(provider.confidence);
  }

  // A printed invoice label beats Textract's own guess, which can be any number on the page
  // (the number of a practice stamp, for example).
  const number = pick(
    docs,
    [
      labelled(INVOICE_NUMBER_LABEL),
      line(INVOICE_NUMBER_LABEL),
      typed('INVOICE_RECEIPT_ID'),
      labelled(REFERENCE_LABEL),
      line(REFERENCE_LABEL),
    ],
    parseNumber,
  );
  if (number) {
    result.fields.invoiceNumber = number.value;
    result.confidence.invoiceNumber = round(number.confidence);
  }

  const date = pick(
    docs,
    [typed('INVOICE_RECEIPT_DATE'), labelled(DATE_LABEL), line(DATE_LABEL), placeDateLine],
    (c) => parseInvoiceDate(c.text),
  );
  if (date) {
    result.fields.invoiceDate = date.value;
    result.confidence.invoiceDate = round(date.confidence);
  }

  const amount =
    pick(
      docs,
      [typed('TOTAL'), typed('AMOUNT_DUE'), labelled(TOTAL_LABEL), line(TOTAL_LABEL)],
      (c) => {
        if (IBAN_LIKE.test(c.text)) return null;
        // On a free text line only a printed money amount counts ("Gesamt 3 Positionen" does not).
        if (c.fromLine && !/\d[.,]\d{2}(?!\d)/.test(c.text)) return null;
        return findAmountInText(c.text);
      },
    ) ?? lineItemSum(docs);
  if (amount) {
    result.fields.amount = amount.value;
    result.confidence.amount = round(amount.confidence);
  }

  // AnalyzeExpense has no reliable field for a free-text description, so it is never extracted.
  return result;
}

/** Maps a single expense document. */
export const mapExpenseDocument = (doc: ExpenseDocument | undefined) =>
  mapExpenseDocuments(doc ? [doc] : undefined);

const round = (value: number) => Math.round(value * 10) / 10;
