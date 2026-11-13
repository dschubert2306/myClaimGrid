export const userPk = (sub: string) => `USER#${sub}`;
export const personSk = (personId: string) => `PERSON#${personId}`;
export const personPk = (personId: string) => `PERSON#${personId}`;
export const claimGsiKey = (claimId: string) => `CLAIM#${claimId}`;

export const DRAFT_SK_PREFIX = 'CLAIM#DRAFT#';
export const draftSk = (claimId: string) => `${DRAFT_SK_PREFIX}${claimId}`;
export const datedSk = (invoiceDate: string, claimId: string) => `CLAIM#${invoiceDate}#${claimId}`;

/** Sort key range of all saved claims of one year. Drafts sort outside of it. */
export function yearRange(year: number): { from: string; to: string } {
  const y = String(year).padStart(4, '0');
  return { from: `CLAIM#${y}-01-01`, to: `CLAIM#${y}-12-31~` };
}

/** Range over every saved claim, used to list the years that have data. Drafts sort outside of it. */
export const ALL_YEARS_RANGE = { from: 'CLAIM#0000-01-01', to: 'CLAIM#9999-12-31~' } as const;

export const uploadKey = (sub: string, claimId: string) => `uploads/${sub}/${claimId}.pdf`;

/** Parse `uploads/<sub>/<claimId>.pdf` (the S3 event delivers the key URL-encoded). */
export function parseUploadKey(
  rawKey: string,
): { sub: string; claimId: string; key: string } | null {
  let key: string;
  try {
    key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    return null;
  }
  const match = /^uploads\/([^/]+)\/([0-9a-f-]{36})\.pdf$/i.exec(key);
  if (!match) return null;
  return { sub: match[1] as string, claimId: match[2] as string, key };
}
