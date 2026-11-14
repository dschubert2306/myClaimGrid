import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  CURRENCY,
  MAX_UPLOAD_BYTES,
  claimDetailSchema,
  claimsResponseSchema,
  createManualClaimRequestSchema,
  createUploadRequestSchema,
  createUploadResponseSchema,
  listClaimsQuerySchema,
  minimumInvoiceAmount,
  saveClaimRequestSchema,
} from '@myclaimgrid/shared';
import { ownedClaim } from '../lib/access';
import { s3 } from '../lib/aws';
import { PRESIGN_TTL_SECONDS, config } from '../lib/config';
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
import { type ClaimItem, toClaim, yearOf } from '../lib/items';
import { claimGsiKey, datedSk, draftSk, personPk, uploadKey } from '../lib/keys';
import { log } from '../lib/log';
import { createClaim, deleteClaim, getPerson, listClaims, saveClaim } from '../lib/repo';

async function ownedPersonId(req: Request, personId: string): Promise<string> {
  const person = await getPerson(req.sub, personId);
  if (!person) throw new HttpError(404, 'person_not_found');
  return person.personId;
}

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

  'POST /claims': async (req) => {
    const body = parseBody(req, createManualClaimRequestSchema);
    await ownedPersonId(req, body.personId);

    const claimId = randomUUID();
    const now = new Date().toISOString();
    const item: ClaimItem = {
      pk: personPk(body.personId),
      sk: datedSk(body.invoiceDate, claimId),
      gsi1pk: claimGsiKey(claimId),
      entity: 'CLAIM',
      userSub: req.sub,
      claimId,
      personId: body.personId,
      status: 'OPEN',
      source: 'MANUAL',
      year: yearOf(body.invoiceDate),
      provider: body.provider,
      invoiceNumber: body.invoiceNumber,
      invoiceDate: body.invoiceDate,
      amount: body.amount,
      currency: CURRENCY,
      description: body.description,
      submittedAt: body.submittedAt ?? null,
      paidAt: body.paidAt ?? null,
      reimbursementEntries: [],
      createdAt: now,
      updatedAt: now,
    };
    await createClaim(item);
    log('info', 'claim created', { claimId });
    return created(toClaim(item));
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
    const fields = parseBody(req, saveClaimRequestSchema);
    // The history must still fit into the invoice amount.
    if (fields.amount < minimumInvoiceAmount(item.reimbursementEntries ?? [])) {
      throw new HttpError(400, 'amount_below_reimbursed');
    }
    const saved = await saveClaim(item, fields);
    log('info', 'claim saved', { claimId: saved.claimId });
    return ok(toClaim(saved));
  },

  'DELETE /claims/{id}': async (req) => {
    const item = await ownedClaim(req);
    // File first: a failed database delete can be retried, a leftover file would be forgotten.
    const keys = [
      ...(item.s3Key ? [item.s3Key] : []),
      ...(item.reimbursementEntries ?? []).flatMap((e) => e.documents.map((d) => d.s3Key)),
    ];
    for (const key of keys) {
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
    }
    await deleteClaim(item);
    log('info', 'claim deleted', { claimId: item.claimId });
    return noContent();
  },

  'GET /persons/{id}/claims': async (req) => {
    const personId = await ownedPersonId(req, idParam(req, 'id'));
    const { year } = parseQuery(req, listClaimsQuerySchema);
    const items = await listClaims(personId, year);
    return ok(claimsResponseSchema.parse({ claims: items.map(toClaim) }));
  },
});
