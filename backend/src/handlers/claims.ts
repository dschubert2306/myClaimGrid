import { randomUUID } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  CURRENCY,
  MAX_DOCUMENTS_PER_CLAIM,
  MAX_UPLOAD_BYTES,
  claimDetailSchema,
  claimSchema,
  claimsResponseSchema,
  createClaimRequestSchema,
  createDocumentUploadRequestSchema,
  createDocumentUploadResponseSchema,
  createUploadRequestSchema,
  createUploadResponseSchema,
  documentUrlResponseSchema,
  listClaimsQuerySchema,
  planReimbursementChange,
  saveClaimRequestSchema,
  type CreateClaimRequest,
  type SaveClaimRequest,
} from '@myclaimgrid/shared';
import { ownedClaim } from '../lib/access';
import { s3 } from '../lib/aws';
import { DOCUMENT_URL_TTL_SECONDS, PRESIGN_TTL_SECONDS, config } from '../lib/config';
import { adoptUploads, deleteObject, discardDocuments, discardStaged } from '../lib/documents';
import { inlineDisposition } from '../lib/files';
import {
  HttpError,
  created,
  createHandler,
  idParam,
  noContent,
  ok,
  parseBody,
  parseQuery,
  type Request,
} from '../lib/http';
import {
  type ClaimItem,
  claimDocuments,
  toClaim,
  withMigratedDocuments,
  yearOf,
} from '../lib/items';
import { claimGsiKey, datedSk, draftSk, personPk, stagedDocumentKey, uploadKey } from '../lib/keys';
import { log } from '../lib/log';
import {
  createClaim,
  deleteClaim,
  getPerson,
  listClaims,
  nextTimestamp,
  replaceClaim,
} from '../lib/repo';

async function ownedPersonId(req: Request, personId: string): Promise<string> {
  const person = await getPerson(req.sub, personId);
  if (!person) throw new HttpError(404, 'person_not_found');
  return person.personId;
}

/**
 * The one save of the claim dialog, for a new claim and for an existing one (a draft from an
 * invoice upload included). The body is the whole state of the dialog. Everything is checked before
 * anything is written: the reimbursement change against the history (it becomes exactly one entry),
 * the documents (removals must exist, uploads are checked and copied). Then one write.
 */
async function saveClaimState(
  sub: string,
  base: ClaimItem,
  body: CreateClaimRequest | SaveClaimRequest,
  isNew: boolean,
): Promise<ClaimItem> {
  const current = withMigratedDocuments(base);
  const entries = current.reimbursementEntries ?? [];
  const plan = planReimbursementChange(body.amount, entries, body.reimbursement);
  if (!plan.ok) throw new HttpError(400, plan.problem);

  const documents = current.insurerDocuments ?? [];
  const known = new Set(documents.map((d) => d.documentId));
  if (body.removedDocumentIds.some((id) => !known.has(id))) {
    throw new HttpError(404, 'document_not_found');
  }
  const removed = documents.filter((d) => body.removedDocumentIds.includes(d.documentId));
  const kept = documents.filter((d) => !body.removedDocumentIds.includes(d.documentId));
  if (kept.length + body.newDocuments.length > MAX_DOCUMENTS_PER_CLAIM) {
    throw new HttpError(400, 'too_many_documents');
  }

  const now = new Date().toISOString();
  const adopted = await adoptUploads(sub, base.claimId, body.newDocuments, now);
  const updated: ClaimItem = {
    ...current,
    sk: datedSk(body.invoiceDate, base.claimId),
    status: 'OPEN',
    year: yearOf(body.invoiceDate),
    provider: body.provider,
    invoiceNumber: body.invoiceNumber,
    invoiceDate: body.invoiceDate,
    amount: body.amount,
    description: body.description,
    submittedAt: body.submittedAt,
    paidAt: body.paid ? body.paidAt : null,
    reimbursementEntries: plan.entry
      ? [...entries, { entryId: randomUUID(), ...plan.entry, createdAt: now }]
      : entries,
    insurerDocuments: [...kept, ...adopted],
    // Results that arrive after the user saved are discarded, so do not stay PENDING.
    extractionStatus: base.extractionStatus === 'PENDING' ? 'FAILED' : base.extractionStatus,
    updatedAt: isNew ? base.updatedAt : nextTimestamp(base.updatedAt),
  };
  try {
    if (isNew) await createClaim(updated);
    else await replaceClaim(base, updated);
  } catch (error) {
    // Nothing references the copies yet. The staged originals expire on their own.
    await discardDocuments(adopted);
    throw error;
  }
  await discardStaged(sub, body.newDocuments);
  // The claim no longer references these, so a failed delete leaves an orphan, not a dangling link.
  await Promise.all(
    removed.map((d) =>
      deleteObject(d.s3Key).catch((error: Error) =>
        log('warn', 'insurer document not deleted', {
          claimId: base.claimId,
          errorName: error.name,
        }),
      ),
    ),
  );
  return updated;
}

const reply = (item: ClaimItem) => claimSchema.parse(toClaim(item));

export const handler = createHandler({
  // Creates a draft and returns a presigned POST for the PDF (type and size enforced by S3).
  'POST /uploads': async (req) => {
    const { personId } = parseBody(req, createUploadRequestSchema);
    await ownedPersonId(req, personId);

    const claimId = randomUUID();
    const key = uploadKey(req.sub, claimId);
    const upload = await createPresignedPost(s3, {
      Bucket: config.bucketName,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES],
        ['eq', '$Content-Type', 'application/pdf'],
      ],
      Fields: { 'Content-Type': 'application/pdf' },
      Expires: PRESIGN_TTL_SECONDS,
    });

    const now = new Date().toISOString();
    const item: ClaimItem = {
      pk: personPk(personId),
      sk: draftSk(claimId),
      gsi1pk: claimGsiKey(claimId),
      entity: 'CLAIM',
      userSub: req.sub,
      claimId,
      personId,
      status: 'DRAFT',
      source: 'EXTRACTED',
      year: null,
      provider: null,
      invoiceNumber: null,
      invoiceDate: null,
      amount: null,
      currency: CURRENCY,
      description: null,
      s3Key: key,
      extractionStatus: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    await createClaim(item);
    log('info', 'draft created', { claimId });
    return created(createUploadResponseSchema.parse({ claim: toClaim(item), upload }));
  },

  // Presigned POST for one insurer document, uploaded before the claim is saved.
  // Type and size are enforced by S3, the content when the claim is saved.
  'POST /document-uploads': async (req) => {
    const { contentType } = parseBody(req, createDocumentUploadRequestSchema);
    const uploadId = randomUUID();
    const upload = await createPresignedPost(s3, {
      Bucket: config.bucketName,
      Key: stagedDocumentKey(req.sub, uploadId),
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: PRESIGN_TTL_SECONDS,
    });
    return created(createDocumentUploadResponseSchema.parse({ uploadId, upload }));
  },

  'POST /claims': async (req) => {
    const body = parseBody(req, createClaimRequestSchema);
    await ownedPersonId(req, body.personId);

    const claimId = randomUUID();
    const now = new Date().toISOString();
    const blank: ClaimItem = {
      pk: personPk(body.personId),
      sk: datedSk(body.invoiceDate, claimId),
      gsi1pk: claimGsiKey(claimId),
      entity: 'CLAIM',
      userSub: req.sub,
      claimId,
      personId: body.personId,
      status: 'OPEN',
      source: 'MANUAL',
      year: null,
      provider: null,
      invoiceNumber: null,
      invoiceDate: null,
      amount: null,
      currency: CURRENCY,
      description: null,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await saveClaimState(req.sub, blank, body, true);
    log('info', 'claim created', { claimId });
    return created(reply(saved));
  },

  'GET /claims/{id}': async (req) => {
    const item = await ownedClaim(req);
    const pdfUrl = item.s3Key
      ? await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: config.bucketName,
            Key: item.s3Key,
            ResponseContentType: 'application/pdf',
            ResponseContentDisposition: 'inline',
          }),
          { expiresIn: PRESIGN_TTL_SECONDS },
        )
      : null;
    return ok(claimDetailSchema.parse({ ...toClaim(item), pdfUrl }));
  },

  'PUT /claims/{id}': async (req) => {
    const item = await ownedClaim(req);
    const body = parseBody(req, saveClaimRequestSchema);
    // The dialog was opened with another state of the claim.
    if (body.version !== item.updatedAt) throw new HttpError(409, 'conflict');
    const saved = await saveClaimState(req.sub, item, body, false);
    log('info', 'claim saved', { claimId: saved.claimId });
    return ok(reply(saved));
  },

  'DELETE /claims/{id}': async (req) => {
    const item = await ownedClaim(req);
    // Files first: a failed database delete can be retried, a leftover file would be forgotten.
    const keys = [...(item.s3Key ? [item.s3Key] : []), ...claimDocuments(item).map((d) => d.s3Key)];
    for (const key of keys) await deleteObject(key);
    await deleteClaim(item);
    log('info', 'claim deleted', { claimId: item.claimId });
    return noContent();
  },

  // A fresh link per click: nothing long-lived ever reaches the browser.
  'GET /claims/{id}/documents/{documentId}/url': async (req) => {
    const item = await ownedClaim(req);
    const documentId = idParam(req, 'documentId');
    const document = claimDocuments(item).find((d) => d.documentId === documentId);
    if (!document) throw new HttpError(404, 'document_not_found');
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

  'GET /persons/{id}/claims': async (req) => {
    const personId = await ownedPersonId(req, idParam(req, 'id'));
    const { year } = parseQuery(req, listClaimsQuerySchema);
    const items = await listClaims(personId, year);
    return ok(claimsResponseSchema.parse({ claims: items.map(toClaim) }));
  },
});
