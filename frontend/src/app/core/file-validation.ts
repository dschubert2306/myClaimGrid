import { MAX_UPLOAD_BYTES } from '@myclaimgrid/shared';

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
