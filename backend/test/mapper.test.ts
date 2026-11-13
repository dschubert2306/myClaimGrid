import { readFileSync } from 'node:fs';
import type { ExpenseDocument } from '@aws-sdk/client-textract';
import { describe, expect, it } from 'vitest';
import { mapExpenseDocument } from '../src/extraction/mapper';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/textract-expense-response.json', import.meta.url), 'utf8'),
) as { ExpenseDocuments: ExpenseDocument[] };

describe('mapExpenseDocument', () => {
  it('maps the five allowed fields with confidence', () => {
    const result = mapExpenseDocument(fixture.ExpenseDocuments[0]);
    expect(result.fields).toEqual({
      provider: 'Praxis Dr. Beispiel',
      invoiceNumber: 'R-2026-0042',
      invoiceDate: '2026-03-12',
      amount: 123456,
    });
    expect(result.confidence).toEqual({
      provider: 98.4,
      invoiceNumber: 95.1,
      invoiceDate: 97,
      amount: 93.3,
    });
  });

  it('never maps bank details', () => {
    const serialized = JSON.stringify(mapExpenseDocument(fixture.ExpenseDocuments[0]));
    expect(serialized).not.toMatch(/DE02|BYLADEM|IBAN|BIC/i);
  });

  it('drops values that look like an IBAN even in an allowed field', () => {
    const result = mapExpenseDocument({
      SummaryFields: [
        {
          Type: { Text: 'VENDOR_NAME' },
          ValueDetection: { Text: 'DE02 1203 0000 0000 2020 51', Confidence: 99 },
        },
        {
          Type: { Text: 'INVOICE_RECEIPT_ID' },
          ValueDetection: { Text: 'DE02120300000000202051', Confidence: 99 },
        },
      ],
    });
    expect(result.fields).toEqual({});
  });

  it('leaves missing or unreadable fields empty and falls back to AMOUNT_DUE', () => {
    const result = mapExpenseDocument({
      SummaryFields: [
        {
          Type: { Text: 'INVOICE_RECEIPT_DATE' },
          ValueDetection: { Text: 'unklar', Confidence: 40 },
        },
        { Type: { Text: 'AMOUNT_DUE' }, ValueDetection: { Text: '75,00', Confidence: 80 } },
      ],
    });
    expect(result.fields).toEqual({ amount: 7500 });
  });

  it('prefers the most confident candidate and handles an empty document', () => {
    const result = mapExpenseDocument({
      SummaryFields: [
        { Type: { Text: 'VENDOR_NAME' }, ValueDetection: { Text: 'Low', Confidence: 50 } },
        { Type: { Text: 'VENDOR_NAME' }, ValueDetection: { Text: 'High', Confidence: 90 } },
      ],
    });
    expect(result.fields.provider).toBe('High');
    expect(mapExpenseDocument(undefined)).toEqual({ fields: {}, confidence: {} });
  });
});
