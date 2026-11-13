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

// ---------------------------------------------------------------- persons

export const personSchema = z.strictObject({
  personId: idSchema,
  name: z.string(),
  color: personColorSchema,
});
export type Person = z.infer<typeof personSchema>;

export const renamePersonRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  color: personColorSchema.optional(),
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
