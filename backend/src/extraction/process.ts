import { GetObjectCommand } from '@aws-sdk/client-s3';
import { MAX_UPLOAD_BYTES, type Extraction } from '@myclaimgrid/shared';
import { s3 } from '../lib/aws';
import { config } from '../lib/config';
import { yearOf } from '../lib/items';
import { log } from '../lib/log';
import { getClaimById, storeExtractionResult } from '../lib/repo';
import type { InvoiceExtractor } from './extractor';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

class RejectedFileError extends Error {
  override name = 'RejectedFileError';
}

async function loadPdf(key: string): Promise<Uint8Array> {
  const out = await s3.send(new GetObjectCommand({ Bucket: config.bucketName, Key: key }));
  if (!out.Body) throw new RejectedFileError('empty');
  if ((out.ContentLength ?? 0) > MAX_UPLOAD_BYTES) throw new RejectedFileError('too_large');
  const bytes = await out.Body.transformToByteArray();
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) throw new RejectedFileError('size');
  if (!PDF_MAGIC.every((b, i) => bytes[i] === b)) throw new RejectedFileError('not_pdf');
  return bytes;
}

/** Reads one uploaded PDF and writes the result to its claim. Never throws for extraction problems. */
export async function processUpload(
  upload: { sub: string; claimId: string; key: string },
  extractor: InvoiceExtractor,
): Promise<void> {
  const item = await getClaimById(upload.claimId);
  if (
    !item ||
    item.userSub !== upload.sub ||
    item.s3Key !== upload.key ||
    item.status !== 'DRAFT' ||
    item.extractionStatus !== 'PENDING'
  ) {
    log('info', 'upload ignored', { claimId: upload.claimId });
    return;
  }

  let next = { ...item, updatedAt: new Date().toISOString() };
  try {
    const result = await extractor.extract(await loadPdf(upload.key));
    const { fields } = result;
    const extraction: Extraction = { confidence: result.confidence };
    next = {
      ...next,
      provider: fields.provider ?? null,
      invoiceNumber: fields.invoiceNumber ?? null,
      invoiceDate: fields.invoiceDate ?? null,
      amount: fields.amount ?? null,
      description: fields.description ?? null,
      year: fields.invoiceDate ? yearOf(fields.invoiceDate) : null,
      extractionStatus: 'DONE',
      extraction,
    };
  } catch (error) {
    // Error names only: messages may contain document content.
    log('warn', 'extraction failed', {
      claimId: upload.claimId,
      errorName: error instanceof Error ? error.name : 'Unknown',
    });
    next = { ...next, extractionStatus: 'FAILED' };
  }

  try {
    await storeExtractionResult(next);
    log('info', 'extraction stored', {
      claimId: upload.claimId,
      extractionStatus: next.extractionStatus,
    });
  } catch (error) {
    if ((error as Error).name === 'ConditionalCheckFailedException') {
      log('info', 'extraction result discarded', { claimId: upload.claimId });
      return;
    }
    throw error; // lets Lambda retry, the write is idempotent
  }
}
