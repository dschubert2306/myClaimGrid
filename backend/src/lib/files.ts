import type { DocumentContentType } from '@myclaimgrid/shared';

/** Leading bytes of the allowed document types. The declared type must match the content. */
const MAGIC: Record<DocumentContentType, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};
export const MAGIC_BYTES = 8;

export function matchesMagic(contentType: DocumentContentType, bytes: Uint8Array): boolean {
  return MAGIC[contentType].every((b, i) => bytes[i] === b);
}

/**
 * `inline` with the original name, ASCII fallback plus RFC 5987 for umlauts. Characters that could
 * break the header (quotes, backslashes, control characters) never reach it.
 */
export function inlineDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
