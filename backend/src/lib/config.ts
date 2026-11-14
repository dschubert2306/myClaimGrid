function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  get tableName(): string {
    return required('TABLE_NAME');
  },
  get bucketName(): string {
    return required('BUCKET_NAME');
  },
};

export const GSI_BY_CLAIM_ID = 'byClaimId';
export const PRESIGN_TTL_SECONDS = 300;
/** Links to insurer documents are created on each click and expire after a minute. */
export const DOCUMENT_URL_TTL_SECONDS = 60;
