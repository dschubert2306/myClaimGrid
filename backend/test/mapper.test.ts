import { readFileSync } from 'node:fs';
import type { ExpenseDocument } from '@aws-sdk/client-textract';
import { describe, expect, it } from 'vitest';
import { mapExpenseDocument, mapExpenseDocuments } from '../src/extraction/mapper';

const other = (label: string, value: string, confidence = 90) => ({
  Type: { Text: 'OTHER' },
  LabelDetection: { Text: label },
  ValueDetection: { Text: value, Confidence: confidence },
});
const lines = (...texts: string[]): ExpenseDocument => ({
  Blocks: texts.map((Text) => ({ BlockType: 'LINE', Text, Confidence: 85 })),
});

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

  describe('German invoices that Textract does not normalize', () => {
    it.each([
      ['Rechnungsnummer', 'R-2026-0042'],
      ['Rechnungs-Nr.:', '2026/0042'],
      ['Rechnung Nr.', '20260042'],
      ['Re.-Nr.', 'RE-4711'],
      ['Belegnummer', 'B 4711'],
      ['Invoice No.', 'INV-7'],
    ])('reads the invoice number from an OTHER field labelled %j', (label, value) => {
      const result = mapExpenseDocument({ SummaryFields: [other(label, value)] });
      expect(result.fields.invoiceNumber).toBe(value);
      expect(result.confidence.invoiceNumber).toBe(90);
    });

    it.each([
      ['Rechnungsbetrag', '1.234,56 €', 123456],
      ['Gesamtbetrag', '89,90 EUR', 8990],
      ['Zu zahlender Betrag', '245,10', 24510],
      ['Endsumme', '€ 75,00', 7500],
      ['Summe', '123,45 Euro', 12345],
    ])('reads the amount from an OTHER field labelled %j', (label, value, cents) => {
      expect(mapExpenseDocument({ SummaryFields: [other(label, value)] }).fields.amount).toBe(
        cents,
      );
    });

    it('falls back to a reference number, but prefers the invoice number', () => {
      const reference = other('Referenznummer', 'REF-998877');
      expect(mapExpenseDocument({ SummaryFields: [reference] }).fields.invoiceNumber).toBe(
        'REF-998877',
      );
      const both = mapExpenseDocument({
        SummaryFields: [other('Referenz', 'REF-998877', 99), other('Rechnungsnummer', '4711', 70)],
      });
      expect(both.fields.invoiceNumber).toBe('4711');
    });

    it('prefers the normalized Textract types over labelled fields', () => {
      const result = mapExpenseDocument({
        SummaryFields: [
          other('Rechnungsbetrag', '99,00'),
          { Type: { Text: 'TOTAL' }, ValueDetection: { Text: '123,45', Confidence: 60 } },
        ],
      });
      expect(result.fields.amount).toBe(12345);
    });

    it('reads number, date and amount from text lines', () => {
      const result = mapExpenseDocument(
        lines(
          'Praxis Dr. Beispiel · Musterstraße 1',
          'Rechnungsnummer: R-2026-0042 vom 12.03.2026',
          'Rechnungsdatum 12.03.2026',
          'Gesamt 3 Positionen',
          'Rechnungsbetrag 245,10 €',
        ),
      );
      expect(result.fields).toEqual({
        invoiceNumber: 'R-2026-0042',
        invoiceDate: '2026-03-12',
        amount: 24510,
      });
      expect(result.confidence).toEqual({ invoiceNumber: 85, invoiceDate: 85, amount: 85 });
    });

    it('takes the number out of a payment reference line', () => {
      const result = mapExpenseDocument(lines('Verwendungszweck: Rechnung 4711-26 Max Muster'));
      expect(result.fields.invoiceNumber).toBe('4711-26');
    });

    it('ignores subtotals, tax, deductions and bank lines', () => {
      const result = mapExpenseDocument({
        SummaryFields: [
          other('Zwischensumme', '1.000,00'),
          other('MwSt. 19 %', '190,00'),
          other('Minderung gem. § 6a GOÄ', '250,00'),
          other('Bereits gezahlt', '50,00'),
          other('Kundennummer', '123456'),
        ],
        Blocks: [
          {
            BlockType: 'LINE',
            Text: 'Bankverbindung Rechnungsnummer bitte angeben',
            Confidence: 90,
          },
          { BlockType: 'LINE', Text: 'IBAN DE02 1203 0000 0000 2020 51', Confidence: 90 },
          { BlockType: 'LINE', Text: 'Gesamtbetrag netto 1.000,00 €', Confidence: 90 },
        ],
      });
      expect(result.fields).toEqual({});
    });

    it('never reads bank data through a label, even next to an invoice label', () => {
      const result = mapExpenseDocument({
        SummaryFields: [
          other('Rechnungsnummer', 'DE02 1203 0000 0000 2020 51'),
          other('Rechnungsbetrag / IBAN', '12,00'),
        ],
        Blocks: [{ BlockType: 'LINE', Text: 'Rechnungs-Nr. 4711 IBAN DE02120300000000202051' }],
      });
      expect(result.fields).toEqual({});
    });

    it('requires a digit in the invoice number', () => {
      const result = mapExpenseDocument({
        SummaryFields: [
          {
            Type: { Text: 'INVOICE_RECEIPT_ID' },
            ValueDetection: { Text: 'Rechnung', Confidence: 99 },
          },
          other('Rechnungs-Nr.', '2026-17', 60),
        ],
      });
      expect(result.fields.invoiceNumber).toBe('2026-17');
    });

    it('does not treat similar words as labels', () => {
      const result = mapExpenseDocument({
        SummaryFields: [other('Referenzwert', '4,5'), other('Gesamtzahl', '3,00')],
      });
      expect(result.fields).toEqual({});
    });

    it('pools fields across several expense documents on the page', () => {
      const result = mapExpenseDocuments([
        {
          SummaryFields: [
            { Type: { Text: 'VENDOR_NAME' }, ValueDetection: { Text: 'Klinikum', Confidence: 95 } },
          ],
        },
        { SummaryFields: [other('Rechnungsnummer', '4711'), other('Rechnungsbetrag', '50,00')] },
      ]);
      expect(result.fields).toEqual({ provider: 'Klinikum', invoiceNumber: '4711', amount: 5000 });
      expect(mapExpenseDocuments([])).toEqual({ fields: {}, confidence: {} });
    });
  });

  describe('letter-style invoice without a total (layout of a real Heilpraktiker invoice)', () => {
    const item = (row: string, price: string, confidence = 99) => ({
      LineItemExpenseFields: [
        { Type: { Text: 'PRICE' }, ValueDetection: { Text: price, Confidence: confidence } },
        { Type: { Text: 'EXPENSE_ROW' }, ValueDetection: { Text: row, Confidence: 99 } },
      ],
    });
    const vendor = (text: string, confidence: number) => ({
      Type: { Text: 'VENDOR_NAME' },
      ValueDetection: { Text: text, Confidence: confidence },
    });
    const line = (Text: string) => ({ BlockType: 'LINE' as const, Text, Confidence: 97 });

    // Synthetic and anonymized, shaped like what Textract returned for the real invoice.
    const invoice: ExpenseDocument = {
      SummaryFields: [
        vendor('Praxis Erika', 80),
        vendor('P R A X I S ERIKA MUSTERFRAU', 57),
        // Textract's own guess: the number printed in the practice stamp.
        {
          Type: { Text: 'INVOICE_RECEIPT_ID' },
          ValueDetection: { Text: '12635', Confidence: 60 },
        },
        other('Liquidation Nr.', '360/2026', 99.9),
        other('Steuernummer:', '145/000/00000', 99.9),
        other('BIC', 'TESTDEFFXXX', 95.9),
      ],
      LineItemGroups: [
        {
          LineItems: [
            item('15.10.26 1 400 Gesamthonorar für Behandlung pauschal 180,00', '180,00'),
          ],
        },
      ],
      Blocks: [
        line('P R A X I S ERIKA MUSTERFRAU'),
        line('Praxis Erika Musterfrau Musterweg 1 80000 München'),
        line('München, 19. Oktober 2026'),
        line('Liquidation Nr. 360/2026'),
        line('Steuernummer: 145/000/00000'),
        line('15.10.26'),
        line('180,00'),
        line('Testbank IBAN DE02 1203 0000 0000 2020 51 BIC TESTDEFFXXX'),
      ],
    };

    it('reads all four fields', () => {
      expect(mapExpenseDocument(invoice)).toEqual({
        fields: {
          provider: 'Praxis Erika Musterfrau',
          invoiceNumber: '360/2026',
          invoiceDate: '2026-10-19',
          amount: 18000,
        },
        confidence: { provider: 80, invoiceNumber: 99.9, invoiceDate: 97, amount: 99 },
      });
    });

    it.each(['Honorarrechnung Nr.', 'Privatliquidation Nr.', 'Quittung Nr.', 'Receipt No.'])(
      'treats %j as an invoice number label',
      (label) => {
        const result = mapExpenseDocument({ SummaryFields: [other(label, '360/2026')] });
        expect(result.fields.invoiceNumber).toBe('360/2026');
      },
    );

    it('adds up several line items', () => {
      const result = mapExpenseDocument({
        LineItemGroups: [
          { LineItems: [item('Beratung 45,00', '45,00', 95)] },
          { LineItems: [item('Akupunktur 60,50', '60,50', 90), { LineItemExpenseFields: [] }] },
        ],
      });
      expect(result.fields.amount).toBe(10550);
      expect(result.confidence.amount).toBe(90);
    });

    it.each([
      ['a deduction', item('Minderung 25 %', '45,00')],
      ['a subtotal', item('Zwischensumme', '200,00')],
      ['a total row', item('Gesamtbetrag', '200,00')],
      ['a negative price', item('Korrektur', '-20,00')],
      ['an unreadable price', item('Beratung', 'n. a.')],
    ])('sums nothing when a row is %s', (_, row) => {
      const result = mapExpenseDocument({
        LineItemGroups: [{ LineItems: [item('Beratung 200,00', '200,00'), row] }],
      });
      expect(result.fields.amount).toBeUndefined();
    });

    it('prefers a printed total over the line items', () => {
      const result = mapExpenseDocument({
        SummaryFields: [
          { Type: { Text: 'TOTAL' }, ValueDetection: { Text: '150,00', Confidence: 80 } },
        ],
        LineItemGroups: [{ LineItems: [item('Beratung 200,00', '200,00')] }],
      });
      expect(result.fields.amount).toBe(15000);
    });

    it.each([
      ['Berlin, den 12.03.2026', '2026-03-12'],
      ['Bad Tölz, 1. März 2026', '2026-03-01'],
    ])('reads the letter date line %j', (text, iso) => {
      expect(mapExpenseDocument({ Blocks: [line(text)] }).fields.invoiceDate).toBe(iso);
    });

    it.each(['15.10.26', 'Behandlung, 15.10.26 bis 20.10.26', 'Datum Anzahl GebüH'])(
      'does not take %j as the letter date',
      (text) => {
        expect(mapExpenseDocument({ Blocks: [line(text)] }).fields.invoiceDate).toBeUndefined();
      },
    );

    it('keeps a short vendor name when no line spells out the longer one', () => {
      const result = mapExpenseDocument({
        SummaryFields: [vendor('Praxis Erika', 80), vendor('P R A X I S ERIKA MUSTERFRAU', 57)],
        Blocks: [line('P R A X I S ERIKA MUSTERFRAU')],
      });
      expect(result.fields.provider).toBe('Praxis Erika');
    });
  });
});
