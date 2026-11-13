import type { ExtractableField } from '@myclaimgrid/shared';

/** Fields read from an invoice. Missing fields are absent, never guessed. */
export interface ExtractionResult {
  fields: {
    provider?: string;
    invoiceNumber?: string;
    invoiceDate?: string; // YYYY-MM-DD
    amount?: number; // integer cents
    description?: string;
  };
  confidence: Partial<Record<ExtractableField, number>>;
}

/** The extraction implementation can be swapped (for example for a model on Bedrock) without touching the rest. */
export interface InvoiceExtractor {
  extract(pdf: Uint8Array): Promise<ExtractionResult>;
}
