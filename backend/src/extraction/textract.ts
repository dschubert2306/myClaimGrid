import { AnalyzeExpenseCommand, type TextractClient } from '@aws-sdk/client-textract';
import type { ExtractionResult, InvoiceExtractor } from './extractor';
import { mapExpenseDocuments } from './mapper';

/**
 * Synchronous AnalyzeExpense. It reads single-page PDFs only: multi-page or otherwise
 * unsupported documents make Textract throw, which the caller turns into FAILED.
 */
export class TextractInvoiceExtractor implements InvoiceExtractor {
  constructor(private readonly client: TextractClient) {}

  async extract(pdf: Uint8Array): Promise<ExtractionResult> {
    const response = await this.client.send(
      new AnalyzeExpenseCommand({ Document: { Bytes: pdf } }),
    );
    // Only the mapped fields leave this function, the raw response is dropped here.
    return mapExpenseDocuments(response.ExpenseDocuments);
  }
}
