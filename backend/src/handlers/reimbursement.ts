import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  MAX_ENTRIES_PER_CLAIM,
  MAX_UPLOAD_BYTES,
  checkNewEntry,
  claimSchema,
  createDocumentUploadRequestSchema,
  createDocumentUploadResponseSchema,
  createEntryRequestSchema,
  documentContentTypeSchema,
  documentUrlResponseSchema,
  type CreateEntryRequest,
} from '@myclaimgrid/shared';
import { ownedClaim } from '../lib/access';
import { s3 } from '../lib/aws';
import { DOCUMENT_URL_TTL_SECONDS, PRESIGN_TTL_SECONDS, config } from '../lib/config';
import { MAGIC_BYTES, inlineDisposition, matchesMagic } from '../lib/files';
import {
  HttpError,
  created,
  createHandler,
  idParam,
  ok,
  parseBody,
  type Request,
} from '../lib/http';
import { type ClaimItem, type DocumentItem, type EntryItem, toClaim } from '../lib/items';
import { insurerDocumentKey, stagedDocumentKey } from '../lib/keys';
import { log } from '../lib/log';
import { saveEntries } from '../lib/repo';

/**
 * Reimbursement history of a claim: entries with amounts, and the insurer documents attached to them.
 * Documents are uploaded with a presigned POST to a staging prefix, checked (type, size, leading
 * bytes) and moved next to the claim when the entry is saved. They are only ever served through
 * presigned GET URLs that expire after a minute.
 */

/** History entries need a saved claim: drafts have no invoice amount to check against. */
async function savedClaim(req: Request): Promise<ClaimItem & { amount: number }> {
  const claim = await ownedClaim(req);
  if (claim.status !== 'OPEN' || claim.amount === null) throw new HttpError(409, 'claim_not_saved');
  return claim as ClaimItem & { amount: number };
}

function findDocument(claim: ClaimItem, documentId: string) {
  for (const entry of claim.reimbursementEntries ?? []) {
    const document = entry.documents.find((d) => d.documentId === documentId);
    if (document) return { entry, document };
  }
  throw new HttpError(404, 'document_not_found');
}

const isMissing = (error: unknown) =>
  error instanceof Error && (error.name === 'NotFound' || error.name === 'NoSuchKey');

/**
 * Checks one staged upload and copies it next to the claim. The key is built from the signed-in
 * user and the claim, so an upload of another user or for another claim cannot be referenced.
 */
async function adoptUpload(
  sub: string,
  claimId: string,
  upload: CreateEntryRequest['documents'][number],
  now: string,
): Promise<DocumentItem> {
  const staged = stagedDocumentKey(sub, claimId, upload.uploadId);
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

async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
}

const reply = (claim: ClaimItem) => claimSchema.parse(toClaim(claim));

export const handler = createHandler({
  // Presigned POST for one insurer document. Type and size are enforced by S3, the content on save.
  'POST /claims/{id}/documents': async (req) => {
    const claim = await savedClaim(req);
    const { contentType } = parseBody(req, createDocumentUploadRequestSchema);
    const uploadId = randomUUID();
    const upload = await createPresignedPost(s3, {
      Bucket: config.bucketName,
      Key: stagedDocumentKey(req.sub, claim.claimId, uploadId),
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: PRESIGN_TTL_SECONDS,
    });
    return created(createDocumentUploadResponseSchema.parse({ uploadId, upload }));
  },

  'POST /claims/{id}/entries': async (req) => {
    const claim = await savedClaim(req);
    const body = parseBody(req, createEntryRequestSchema);
    const entries = claim.reimbursementEntries ?? [];
    if (entries.length >= MAX_ENTRIES_PER_CLAIM) throw new HttpError(409, 'too_many_entries');

    const amounts = {
      reimbursedAmount: body.reimbursedAmount ?? null,
      rejectedAmount: body.rejectedAmount ?? null,
    };
    const problem = checkNewEntry(claim.amount, entries, amounts);
    if (problem) throw new HttpError(400, problem);

    const now = new Date().toISOString();
    const documents: DocumentItem[] = [];
    let updated: ClaimItem;
    try {
      for (const upload of body.documents) {
        documents.push(await adoptUpload(req.sub, claim.claimId, upload, now));
      }
      const entry: EntryItem = {
        entryId: randomUUID(),
        status: body.status,
        date: body.date,
        ...amounts,
        note: body.note,
        documents,
        createdAt: now,
      };
      updated = await saveEntries(claim, [...entries, entry]);
    } catch (error) {
      // Nothing references the copies yet. The staged originals expire on their own.
      await Promise.allSettled(documents.map((d) => deleteObject(d.s3Key)));
      throw error;
    }
    await Promise.allSettled(
      body.documents.map((u) =>
        deleteObject(stagedDocumentKey(req.sub, claim.claimId, u.uploadId)),
      ),
    );
    log('info', 'reimbursement entry added', {
      claimId: claim.claimId,
      status: body.status,
      documents: documents.length,
    });
    return created(reply(updated));
  },

  'DELETE /claims/{id}/entries/{entryId}': async (req) => {
    const claim = await ownedClaim(req);
    const entryId = idParam(req, 'entryId');
    const entries = claim.reimbursementEntries ?? [];
    const entry = entries.find((e) => e.entryId === entryId);
    if (!entry) throw new HttpError(404, 'entry_not_found');
    // Files first: a failed database write can be retried, a leftover file would be forgotten.
    for (const document of entry.documents) await deleteObject(document.s3Key);
    const updated = await saveEntries(
      claim,
      entries.filter((e) => e.entryId !== entryId),
    );
    log('info', 'reimbursement entry deleted', { claimId: claim.claimId });
    return ok(reply(updated));
  },

  'DELETE /claims/{id}/documents/{documentId}': async (req) => {
    const claim = await ownedClaim(req);
    const { document } = findDocument(claim, idParam(req, 'documentId'));
    await deleteObject(document.s3Key);
    const updated = await saveEntries(
      claim,
      (claim.reimbursementEntries ?? []).map((e) => ({
        ...e,
        documents: e.documents.filter((d) => d.documentId !== document.documentId),
      })),
    );
    log('info', 'insurer document deleted', { claimId: claim.claimId });
    return ok(reply(updated));
  },

  // A fresh link per click: nothing long-lived ever reaches the browser.
  'GET /claims/{id}/documents/{documentId}/url': async (req) => {
    const claim = await ownedClaim(req);
    const { document } = findDocument(claim, idParam(req, 'documentId'));
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.bucketName,
        Key: document.s3Key,
        ResponseContentType: document.contentType,
        ResponseContentDisposition: inlineDisposition(document.fileName),
      }),
      { expiresIn: DOCUMENT_URL_TTL_SECONDS },
    );
    return ok(documentUrlResponseSchema.parse({ url, expiresIn: DOCUMENT_URL_TTL_SECONDS }));
  },
});
