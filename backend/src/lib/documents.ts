import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import {
  MAX_UPLOAD_BYTES,
  documentContentTypeSchema,
  type SaveClaimRequest,
} from '@myclaimgrid/shared';
import { s3 } from './aws';
import { config } from './config';
import { MAGIC_BYTES, matchesMagic } from './files';
import { HttpError } from './http';
import type { DocumentItem } from './items';
import { insurerDocumentKey, stagedDocumentKey } from './keys';

/**
 * Insurer documents are uploaded with a presigned POST to a staging prefix, checked (type, size,
 * leading bytes) and moved next to the claim when the claim is saved. They are only ever served
 * through presigned GET URLs that expire after a minute.
 */

type Upload = SaveClaimRequest['newDocuments'][number];

const isMissing = (error: unknown) =>
  error instanceof Error && (error.name === 'NotFound' || error.name === 'NoSuchKey');

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
}

/**
 * Checks one staged upload and copies it next to the claim. The key is built from the signed-in
 * user, so an upload of another user cannot be referenced.
 */
async function adoptUpload(
  sub: string,
  claimId: string,
  upload: Upload,
  now: string,
): Promise<DocumentItem> {
  const staged = stagedDocumentKey(sub, upload.uploadId);
  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: config.bucketName, Key: staged }));
  } catch (error) {
    if (isMissing(error)) throw new HttpError(400, 'upload_missing');
    throw error;
  }
  const contentType = documentContentTypeSchema.safeParse(head.ContentType);
  const size = head.ContentLength ?? 0;
  if (!contentType.success || size < 1 || size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'invalid_document');
  }
  const start = await s3.send(
    new GetObjectCommand({
      Bucket: config.bucketName,
      Key: staged,
      Range: `bytes=0-${MAGIC_BYTES - 1}`,
    }),
  );
  const bytes = (await start.Body?.transformToByteArray()) ?? new Uint8Array();
  if (!matchesMagic(contentType.data, bytes)) throw new HttpError(400, 'invalid_document');

  const key = insurerDocumentKey(sub, claimId, upload.uploadId);
  await s3.send(
    new CopyObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      CopySource: `${config.bucketName}/${staged}`,
    }),
  );
  return {
    documentId: upload.uploadId,
    fileName: upload.fileName,
    contentType: contentType.data,
    size,
    uploadedAt: now,
    s3Key: key,
  };
}

/** All or nothing: if one upload is refused, the copies of the others are removed again. */
export async function adoptUploads(
  sub: string,
  claimId: string,
  uploads: readonly Upload[],
  now: string,
): Promise<DocumentItem[]> {
  const results = await Promise.allSettled(uploads.map((u) => adoptUpload(sub, claimId, u, now)));
  const adopted = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) {
    await discardDocuments(adopted);
    throw failure.reason;
  }
  return adopted;
}

/** Removes the copies in the insurer prefix. Nothing references them, so failures are ignored. */
export async function discardDocuments(documents: readonly DocumentItem[]): Promise<void> {
  await Promise.allSettled(documents.map((d) => deleteObject(d.s3Key)));
}

/** The staged originals expire on their own after a day, this only tidies up early. */
export async function discardStaged(sub: string, uploads: readonly Upload[]): Promise<void> {
  await Promise.allSettled(uploads.map((u) => deleteObject(stagedDocumentKey(sub, u.uploadId))));
}
