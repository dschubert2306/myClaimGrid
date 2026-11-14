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

/** Fields the user edits in the review step. */
export const claimFieldsSchema = z.strictObject({
  provider: z.string().trim().min(1).max(200),
  invoiceNumber: z.string().trim().max(100).optional().default(''),
  invoiceDate: isoDateSchema,
  amount: amountCentsSchema,
  description: z.string().trim().max(500).optional().default(''),
  /** Submitted to the insurer on this date: set means submitted. Null clears it, absent keeps it. */
  submittedAt: isoDateSchema.nullable().optional(),
  /** The user paid the invoice on this date, independent of the reimbursement. Null clears it. */
  paidAt: isoDateSchema.nullable().optional(),
});
export type ClaimFields = z.infer<typeof claimFieldsSchema>;
export type ClaimFieldsInput = z.input<typeof claimFieldsSchema>;

export const createManualClaimRequestSchema = claimFieldsSchema.safeExtend({
  personId: idSchema,
});
export type CreateManualClaimRequest = z.infer<typeof createManualClaimRequestSchema>;

/** PUT /claims/{id}. The person of a claim cannot be changed in release 1. */
export const saveClaimRequestSchema = claimFieldsSchema;
export type SaveClaimRequest = z.infer<typeof saveClaimRequestSchema>;

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
 * How far the insurer is with the reimbursement. Independent of `paidAt` (the user paid the
 * invoice) and of `ClaimStatus` (draft or saved record).
 */
export const reimbursementStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'PARTLY_PAID', 'PAID']);
export type ReimbursementStatus = z.infer<typeof reimbursementStatusSchema>;

/** Statuses whose history entry carries a reimbursed amount (and optionally a rejected one). */
export const PAYMENT_STATUSES: readonly ReimbursementStatus[] = ['PARTLY_PAID', 'PAID'];
export const isPaymentStatus = (status: ReimbursementStatus): boolean =>
  PAYMENT_STATUSES.includes(status);

/** Integer cents, zero or more. */
export const nonNegativeCentsSchema = z.number().int().min(0).max(100_000_000_00);

/** Letters from the insurer: mostly PDF, sometimes a photo or scan. */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const documentContentTypeSchema = z.enum(DOCUMENT_CONTENT_TYPES);
export type DocumentContentType = z.infer<typeof documentContentTypeSchema>;
export const MAX_DOCUMENTS_PER_ENTRY = 10;
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

export const reimbursementEntrySchema = z.strictObject({
  entryId: idSchema,
  status: reimbursementStatusSchema,
  /** Date of the event (for example the date on the benefit statement). */
  date: isoDateSchema,
  /** Cents paid out with this entry. Only for PAID and PARTLY_PAID, entries add up. */
  reimbursedAmount: z.number().int().nullable(),
  /** Cents the insurer rejected or kept as deductible with this entry. */
  rejectedAmount: z.number().int().nullable(),
  note: z.string(),
  documents: z.array(insurerDocumentSchema),
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

/** Presigned POST into the staging area. The file becomes part of the claim with the entry. */
export const createDocumentUploadResponseSchema = z.strictObject({
  uploadId: idSchema,
  upload: z.strictObject({
    url: z.string(),
    fields: z.record(z.string(), z.string()),
  }),
});
export type CreateDocumentUploadResponse = z.infer<typeof createDocumentUploadResponseSchema>;

export const createEntryRequestSchema = z
  .strictObject({
    status: reimbursementStatusSchema,
    date: isoDateSchema,
    reimbursedAmount: nonNegativeCentsSchema.optional(),
    rejectedAmount: nonNegativeCentsSchema.optional(),
    note: z.string().trim().max(500).optional().default(''),
    documents: z
      .array(z.strictObject({ uploadId: idSchema, fileName: fileNameSchema }))
      .max(MAX_DOCUMENTS_PER_ENTRY)
      .optional()
      .default([]),
  })
  .superRefine((entry, ctx) => {
    const pays = isPaymentStatus(entry.status);
    if (pays && entry.reimbursedAmount === undefined) {
      ctx.addIssue({ code: 'custom', path: ['reimbursedAmount'], message: 'Required' });
    }
    if (!pays && entry.reimbursedAmount !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['reimbursedAmount'], message: 'Not allowed' });
    }
    if (!pays && entry.rejectedAmount !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['rejectedAmount'], message: 'Not allowed' });
    }
    const ids = entry.documents.map((d) => d.uploadId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['documents'], message: 'Duplicate upload' });
    }
  });
export type CreateEntryRequest = z.infer<typeof createEntryRequestSchema>;
export type CreateEntryRequestInput = z.input<typeof createEntryRequestSchema>;

/** Short-lived presigned GET for one insurer document. */
export const documentUrlResponseSchema = z.strictObject({
  url: z.string(),
  expiresIn: z.number().int(),
});
export type DocumentUrlResponse = z.infer<typeof documentUrlResponseSchema>;

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
  paidAt: isoDateSchema.nullable(),
  reimbursement: reimbursementSchema,
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
