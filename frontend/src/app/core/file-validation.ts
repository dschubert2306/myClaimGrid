import {
  DOCUMENT_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  type DocumentContentType,
} from '@myclaimgrid/shared';

export type FileProblem = 'type' | 'size';

/** Client side check before the upload: PDF only (name and MIME type), 10 MB at most. */
export function validatePdf(file: {
  name: string;
  type: string;
  size: number;
}): FileProblem | null {
  const isPdfName = /\.pdf$/i.test(file.name);
  const isPdfType = file.type === 'application/pdf' || file.type === '';
  if (!isPdfName || !isPdfType) return 'type';
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}

export function formatFileSize(bytes: number, locale: string): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

const DOCUMENT_TYPES: Record<string, DocumentContentType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * Type of an insurer document (PDF, JPEG or PNG), from the name and the MIME type. Null when it is
 * none of them or the two disagree. The server checks the leading bytes again.
 */
export function documentContentType(file: {
  name: string;
  type: string;
}): DocumentContentType | null {
  const extension = /\.([a-z]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const byName = DOCUMENT_TYPES[extension];
  if (!byName) return null;
  if (file.type === '') return byName; // some browsers report no MIME type
  return (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type) && file.type === byName
    ? byName
    : null;
}

/** Client side check for an insurer document: PDF, JPEG or PNG, 10 MB at most. */
export function validateDocument(file: {
  name: string;
  type: string;
  size: number;
}): FileProblem | null {
  if (documentContentType(file) === null) return 'type';
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}
