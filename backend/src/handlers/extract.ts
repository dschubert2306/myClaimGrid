import type { S3Event } from 'aws-lambda';
import { textract } from '../lib/aws';
import { config } from '../lib/config';
import { parseUploadKey } from '../lib/keys';
import { log } from '../lib/log';
import { processUpload } from '../extraction/process';
import { TextractInvoiceExtractor } from '../extraction/textract';

const extractor = new TextractInvoiceExtractor(textract);

/** Triggered by S3 ObjectCreated on the `uploads/` prefix. */
export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    if (record.s3.bucket.name !== config.bucketName) continue;
    const upload = parseUploadKey(record.s3.object.key);
    if (!upload) {
      log('warn', 'unexpected object key ignored');
      continue;
    }
    await processUpload(upload, extractor);
  }
}
