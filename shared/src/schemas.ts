import { z } from 'zod';

/**
 * API contract of myClaimGrid, shared by backend and frontend.
 * Money is always integer cents. There is deliberately no field for bank data
 * (IBAN, BIC, account numbers), and every object schema rejects unknown fields.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const CURRENCY = 'EUR' as const;

export const idSchema = z.uuid();

export const personColorSchema = z.enum(['person-1', 'person-2', 'person-3']);
export type PersonColor = z.infer<typeof personColorSchema>;

export const claimStatusSchema = z.enum(['DRAFT', 'OPEN']);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const claimSourceSchema = z.enum(['EXTRACTED', 'MANUAL']);
export type ClaimSource = z.infer<typeof claimSourceSchema>;

export const extractionStatusSchema = z.enum(['PENDING', 'DONE', 'FAILED']);
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;

/** ISO calendar date, YYYY-MM-DD, must be a real date. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Invalid calendar date');

export const yearSchema = z.coerce.number().int().min(1900).max(2200);

/** Integer cents, greater than zero. */
export const amountCentsSchema = z.number().int().positive().max(100_000_000_00);

/** Selbstbehalt (yearly deductible) in integer cents. Zero means none. */
export const deductibleCentsSchema = z.number().int().min(0).max(100_000_00);

// ---------------------------------------------------------------- persons

export const personSchema = z.strictObject({
  personId: idSchema,
  name: z.string(),
  color: personColorSchema,
  /** Yearly Selbstbehalt in cents, 0 when not set. */
  deductible: deductibleCentsSchema,
});
export type Person = z.infer<typeof personSchema>;

export const renamePersonRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  color: personColorSchema.optional(),
  deductible: deductibleCentsSchema.optional(),
});
export type RenamePersonRequest = z.infer<typeof renamePersonRequestSchema>;

export const personsResponseSchema = z.strictObject({ persons: z.array(personSchema) });
export type PersonsResponse = z.infer<typeof personsResponseSchema>;

// ----------------------------------------------------------------- claims

export const extractableFieldSchema = z.enum([
  'provider',
  'invoiceNumber',
  'invoiceDate',
  'amount',
  'description',
]);
export type ExtractableField = z.infer<typeof extractableFieldSchema>;

/** Only the mapped fields with their confidence (0..100). No raw OCR output. */
export const extractionSchema = z.strictObject({
  confidence: z.partialRecord(extractableFieldSchema, z.number().min(0).max(100)),
});
export type Extraction = z.infer<typeof extractionSchema>;

// ---------------------------------------------------------- reimbursement

/**
 * How far the insurer is with the reimbursement. Independent of the payment status (`paid`, the
 * user paid the invoice) and of `ClaimStatus` (draft or saved record).
 */
export const reimbursementStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'PARTLY_PAID', 'PAID']);
export type ReimbursementStatus = z.infer<typeof reimbursementStatusSchema>;

/** Statuses that carry a reimbursed amount (and optionally a rejected one). */
export const PAYMENT_STATUSES: readonly ReimbursementStatus[] = ['PARTLY_PAID', 'PAID'];
export const isPaymentStatus = (status: ReimbursementStatus): boolean =>
  PAYMENT_STATUSES.includes(status);

/** Integer cents, zero or more. */
export const nonNegativeCentsSchema = z.number().int().min(0).max(100_000_000_00);

/** Letters from the insurer: mostly PDF, sometimes a photo or scan. */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const documentContentTypeSchema = z.enum(DOCUMENT_CONTENT_TYPES);
export type DocumentContentType = z.infer<typeof documentContentTypeSchema>;
export const MAX_DOCUMENTS_PER_CLAIM = 20;
export const MAX_ENTRIES_PER_CLAIM = 50;

/** Display name of an uploaded file. Path separators and control characters are replaced. */
export const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  .transform((name) => name.replace(/[\u0000-\u001f\u007f/\\]/g, '_'));

export const insurerDocumentSchema = z.strictObject({
  documentId: idSchema,
  fileName: z.string(),
  contentType: documentContentTypeSchema,
  size: z.number().int(),
  uploadedAt: z.string(),
});
export type InsurerDocument = z.infer<typeof insurerDocumentSchema>;

/**
 * The reimbursement state as the dialog saves it. Amounts are the totals so far (what the card
 * shows), only for PAID and PARTLY_PAID. The server compares them with the history and records the
 * change as a new entry. Any change to this block creates exactly one entry.
 */
export const reimbursementInputSchema = z
  .strictObject({
    status: reimbursementStatusSchema,
    /** Date of this status (for example the date on the benefit statement). */
    date: isoDateSchema.optional(),
    reimbursedAmount: nonNegativeCentsSchema.optional(),
    rejectedAmount: nonNegativeCentsSchema.optional(),
    /** Comment on this change, kept in the history entry. Empty means none. */
    note: z.string().trim().max(500).optional().default(''),
  })
  .superRefine((input, ctx) => {
    const pays = isPaymentStatus(input.status);
    if (pays && input.reimbursedAmount === undefined) {
      ctx.addIssue({ code: 'custom', path: ['reimbursedAmount'], message: 'Required' });
    }
    if (!pays && input.reimbursedAmount !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['reimbursedAmount'], message: 'Not allowed' });
    }
    if (!pays && input.rejectedAmount !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['rejectedAmount'], message: 'Not allowed' });
    }
  });

/** One history entry: the status at that time and what changed. Created by saving, never edited. */
export const reimbursementEntrySchema = z.strictObject({
  entryId: idSchema,
  status: reimbursementStatusSchema,
  date: isoDateSchema,
  /** Cents reimbursed with this entry (a correction downwards is negative). Entries add up. */
  reimbursedAmount: z.number().int().nullable(),
  /** Cents rejected or kept as deductible with this entry, same rules. */
  rejectedAmount: z.number().int().nullable(),
  note: z.string(),
  createdAt: z.string(),
});
export type ReimbursementEntry = z.infer<typeof reimbursementEntrySchema>;

/** Derived from the history. Amounts in cents, they split the invoice amount without overlap. */
export const reimbursementSchema = z.strictObject({
  /** Status of the most recent entry, OPEN without entries. */
  status: reimbursementStatusSchema,
  /** Oldest first. */
  entries: z.array(reimbursementEntrySchema),
  /** Sum of all reimbursed amounts. */
  reimbursed: z.number().int(),
  /** Sum of all rejected amounts and deductibles. */
  rejected: z.number().int(),
  /** Still expected from the insurer. Zero once the status is PAID. */
  outstanding: z.number().int(),
  /** Finally borne by the user: rejected amounts, plus the rest once the status is PAID. */
  selfBorne: z.number().int(),
});
export type Reimbursement = z.infer<typeof reimbursementSchema>;

export const createDocumentUploadRequestSchema = z.strictObject({
  contentType: documentContentTypeSchema,
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});
export type CreateDocumentUploadRequest = z.infer<typeof createDocumentUploadRequestSchema>;

/** Presigned POST into the staging area. The file becomes part of the claim when it is saved. */
export const createDocumentUploadResponseSchema = z.strictObject({
  uploadId: idSchema,
  upload: z.strictObject({
    url: z.string(),
    fields: z.record(z.string(), z.string()),
  }),
});
export type CreateDocumentUploadResponse = z.infer<typeof createDocumentUploadResponseSchema>;

/** Short-lived presigned GET for one insurer document. */
export const documentUrlResponseSchema = z.strictObject({
  url: z.string(),
  expiresIn: z.number().int(),
});
export type DocumentUrlResponse = z.infer<typeof documentUrlResponseSchema>;

/**
 * Everything the claim dialog saves in one request. It is a full save: the client always sends the
 * whole state of the dialog, nothing is "kept" by leaving a field out.
 */
const claimSaveShape = {
  provider: z.string().trim().min(1).max(200),
  invoiceNumber: z.string().trim().max(100).optional().default(''),
  invoiceDate: isoDateSchema,
  amount: amountCentsSchema,
  description: z.string().trim().max(500).optional().default(''),
  /** Submitted to the insurer on this date, null while it has not been submitted. */
  submittedAt: isoDateSchema.nullable(),
  /** Payment status (my side): the user paid the invoice. The date is required while it is on. */
  paid: z.boolean(),
  paidAt: isoDateSchema.nullable().optional().default(null),
  reimbursement: reimbursementInputSchema,
  /** Insurer documents to attach: uploads from POST /document-uploads. */
  newDocuments: z
    .array(z.strictObject({ uploadId: idSchema, fileName: fileNameSchema }))
    .max(MAX_DOCUMENTS_PER_CLAIM)
    .optional()
    .default([]),
  /** Insurer documents to delete. */
  removedDocumentIds: z.array(idSchema).max(MAX_DOCUMENTS_PER_CLAIM).optional().default([]),
};

/** Payment date follows the toggle: required while "paid" is on, absent while it is off. */
function checkSaveRules(
  body: {
    paid: boolean;
    paidAt: string | null;
    newDocuments: { uploadId: string }[];
    removedDocumentIds: string[];
  },
  ctx: z.RefinementCtx,
): void {
  if (body.paid && body.paidAt === null) {
    ctx.addIssue({ code: 'custom', path: ['paidAt'], message: 'Required' });
  }
  if (!body.paid && body.paidAt !== null) {
    ctx.addIssue({ code: 'custom', path: ['paidAt'], message: 'Not allowed' });
  }
  const uploads = body.newDocuments.map((d) => d.uploadId);
  if (new Set(uploads).size !== uploads.length) {
    ctx.addIssue({ code: 'custom', path: ['newDocuments'], message: 'Duplicate upload' });
  }
  if (new Set(body.removedDocumentIds).size !== body.removedDocumentIds.length) {
    ctx.addIssue({ code: 'custom', path: ['removedDocumentIds'], message: 'Duplicate document' });
  }
}

/** POST /claims. */
export const createClaimRequestSchema = z
  .strictObject({ personId: idSchema, ...claimSaveShape })
  .superRefine(checkSaveRules);
export type CreateClaimRequest = z.infer<typeof createClaimRequestSchema>;
export type CreateClaimRequestInput = z.input<typeof createClaimRequestSchema>;

/**
 * PUT /claims/{id}. The person of a claim cannot be changed. `version` is the `updatedAt` the
 * dialog was opened with: a claim that changed in the meantime is refused with 409.
 */
export const saveClaimRequestSchema = z
  .strictObject({ version: z.string().min(1), ...claimSaveShape })
  .superRefine(checkSaveRules);
export type SaveClaimRequest = z.infer<typeof saveClaimRequestSchema>;
export type SaveClaimRequestInput = z.input<typeof saveClaimRequestSchema>;

// ----------------------------------------------------------------- claim

export const claimSchema = z.strictObject({
  claimId: idSchema,
  personId: idSchema,
  status: claimStatusSchema,
  source: claimSourceSchema,
  year: z.number().int().nullable(),
  provider: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: isoDateSchema.nullable(),
  amount: z.number().int().nullable(),
  currency: z.literal(CURRENCY),
  description: z.string().nullable(),
  hasPdf: z.boolean(),
  extractionStatus: extractionStatusSchema.nullable(),
  extraction: extractionSchema.nullable(),
  submittedAt: isoDateSchema.nullable(),
  /** Payment status: the date the user paid the invoice, null while it is unpaid. */
  paidAt: isoDateSchema.nullable(),
  reimbursement: reimbursementSchema,
  /** Insurer documents of the claim. */
  documents: z.array(insurerDocumentSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Claim = z.infer<typeof claimSchema>;

/** GET /claims/{id} adds a short-lived presigned URL for the stored PDF. */
export const claimDetailSchema = claimSchema.safeExtend({
  pdfUrl: z.string().nullable(),
});
export type ClaimDetail = z.infer<typeof claimDetailSchema>;

export const claimsResponseSchema = z.strictObject({ claims: z.array(claimSchema) });
export type ClaimsResponse = z.infer<typeof claimsResponseSchema>;

export const createUploadRequestSchema = z.strictObject({ personId: idSchema });
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

/** Presigned POST: send `fields` plus the file (as the last form field named `file`) to `url`. */
export const createUploadResponseSchema = z.strictObject({
  claim: claimSchema,
  upload: z.strictObject({
    url: z.string(),
    fields: z.record(z.string(), z.string()),
  }),
});
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;

export const listClaimsQuerySchema = z.strictObject({ year: yearSchema });

// -------------------------------------------------------------- dashboard

export const dashboardQuerySchema = z.strictObject({ year: yearSchema.optional() });

export const dashboardPersonSchema = z.strictObject({
  personId: idSchema,
  name: z.string(),
  color: personColorSchema,
  count: z.number().int(),
  totalAmount: z.number().int(),
  reimbursedAmount: z.number().int(),
  outstandingAmount: z.number().int(),
  selfBorneAmount: z.number().int(),
});

export const dashboardResponseSchema = z.strictObject({
  year: z.number().int(),
  years: z.array(z.number().int()),
  persons: z.array(dashboardPersonSchema),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type DashboardPerson = z.infer<typeof dashboardPersonSchema>;

// ------------------------------------------------------------------ error

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    issues: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
