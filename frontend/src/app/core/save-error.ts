import { HttpErrorResponse } from '@angular/common/http';

/** API error codes of a claim save -> message keys. */
const ERROR_KEYS: Record<string, string> = {
  amount_above_invoice: 'errors.aboveInvoice',
  date_required: 'errors.required',
  date_before_latest: 'errors.dateBeforeLatest',
  too_many_entries: 'errors.tooManyEntries',
  too_many_documents: 'errors.tooManyDocuments',
  invalid_document: 'errors.invalidDocument',
  document_not_found: 'errors.conflict',
  conflict: 'errors.conflict',
};

/** Message key for a failed save: 409 is a conflict, a known API code its own text, else generic. */
export function saveErrorKey(error: unknown): string {
  const code =
    error instanceof HttpErrorResponse
      ? error.status === 409
        ? 'conflict'
        : (error.error?.error?.code as string | undefined)
      : undefined;
  return (code && ERROR_KEYS[code]) || 'errors.saveFailed';
}
