import { readFileSync } from 'node:fs';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AnalyzeExpenseCommand, TextractClient } from '@aws-sdk/client-textract';
import type { S3Event } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler as claimsHandler } from '../src/handlers/claims';
import { handler as extractHandler } from '../src/handlers/extract';
import { handler as personsHandler } from '../src/handlers/persons';
import { apiEvent, json } from './helpers/events';
import { fakeDynamo } from './helpers/dynamo';

const textractResponse = JSON.parse(
  readFileSync(new URL('./fixtures/textract-expense-response.json', import.meta.url), 'utf8'),
);

let db: ReturnType<typeof fakeDynamo>;
let s3: ReturnType<typeof mockClient>;
let textract: ReturnType<typeof mockClient>;
let personId: string;

const body = (bytes: Uint8Array) => ({ transformToByteArray: async () => bytes }) as never;
const pdf = new TextEncoder().encode('%PDF-1.4 synthetic');

function s3Event(key: string, bucket = 'test-bucket'): S3Event {
  return { Records: [{ s3: { bucket: { name: bucket }, object: { key } } }] } as unknown as S3Event;
}

async function draft(sub = 'user-1') {
  const { persons } = json(await personsHandler(apiEvent('GET /persons', { sub })));
  personId = persons[0].personId;
  const { claim } = json(
    await claimsHandler(apiEvent('POST /uploads', { sub, body: { personId } })),
  );
  return { claimId: claim.claimId as string, key: `uploads/${sub}/${claim.claimId}.pdf` };
}

const stored = (claimId: string) =>
  db.find((i) => i.claimId === claimId) as Record<string, unknown>;

beforeEach(() => {
  db = fakeDynamo();
  s3 = mockClient(S3Client);
  textract = mockClient(TextractClient);
});

describe('extraction Lambda', () => {
  it('writes the mapped fields to the draft and marks it DONE', async () => {
    const { claimId, key } = await draft();
    s3.on(GetObjectCommand).resolves({ Body: body(pdf), ContentLength: pdf.length });
    textract.on(AnalyzeExpenseCommand).resolves(textractResponse);

    await extractHandler(s3Event(key));

    expect(stored(claimId)).toMatchObject({
      status: 'DRAFT',
      extractionStatus: 'DONE',
      provider: 'Praxis Dr. Beispiel',
      invoiceNumber: 'R-2026-0042',
      invoiceDate: '2026-03-12',
      amount: 123456,
      year: 2026,
      extraction: { confidence: { provider: 98.4, amount: 93.3 } },
    });
    // Neither bank data nor the raw response is stored.
    expect(JSON.stringify(db.items())).not.toMatch(/DE02|BYLADEM|ValueDetection/);
    // The draft stays out of the year list until the user saves it.
    expect(stored(claimId).sk).toBe(`CLAIM#DRAFT#${claimId}`);
  });

  it('leaves fields empty when nothing was recognised', async () => {
    const { claimId, key } = await draft();
    s3.on(GetObjectCommand).resolves({ Body: body(pdf), ContentLength: pdf.length });
    textract.on(AnalyzeExpenseCommand).resolves({ ExpenseDocuments: [{ SummaryFields: [] }] });
    await extractHandler(s3Event(key));
    expect(stored(claimId)).toMatchObject({
      extractionStatus: 'DONE',
      provider: null,
      amount: null,
      invoiceDate: null,
      year: null,
    });
  });

  it('marks the claim FAILED when Textract rejects the document (for example multi-page)', async () => {
    const { claimId, key } = await draft();
    s3.on(GetObjectCommand).resolves({ Body: body(pdf), ContentLength: pdf.length });
    const error = new Error('multi page');
    error.name = 'UnsupportedDocumentException';
    textract.on(AnalyzeExpenseCommand).rejects(error);
    await extractHandler(s3Event(key));
    expect(stored(claimId)).toMatchObject({ extractionStatus: 'FAILED', provider: null });
  });

  it('marks the claim FAILED for files that are not PDFs, without calling Textract', async () => {
    const { claimId, key } = await draft();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    s3.on(GetObjectCommand).resolves({ Body: body(png), ContentLength: png.length });
    await extractHandler(s3Event(key));
    expect(stored(claimId)).toMatchObject({ extractionStatus: 'FAILED' });
    expect(textract.commandCalls(AnalyzeExpenseCommand)).toHaveLength(0);
  });

  it('marks oversized files FAILED', async () => {
    const { claimId, key } = await draft();
    s3.on(GetObjectCommand).resolves({ Body: body(pdf), ContentLength: 11 * 1024 * 1024 });
    await extractHandler(s3Event(key));
    expect(stored(claimId)).toMatchObject({ extractionStatus: 'FAILED' });
    expect(textract.commandCalls(AnalyzeExpenseCommand)).toHaveLength(0);
  });

  it('ignores claims that are already saved, foreign keys, other buckets and odd keys', async () => {
    const { claimId, key } = await draft();
    await claimsHandler(
      apiEvent('PUT /claims/{id}', {
        pathParameters: { id: claimId },
        body: { provider: 'Manuell', invoiceDate: '2026-01-01', amount: 100 },
      }),
    );
    s3.on(GetObjectCommand).resolves({ Body: body(pdf), ContentLength: pdf.length });
    textract.on(AnalyzeExpenseCommand).resolves(textractResponse);

    await extractHandler(s3Event(key)); // already saved
    await extractHandler(s3Event(key.replace('user-1', 'someone-else')));
    await extractHandler(s3Event(key, 'other-bucket'));
    await extractHandler(s3Event('uploads/not-a-claim.txt'));

    expect(textract.commandCalls(AnalyzeExpenseCommand)).toHaveLength(0);
    expect(stored(claimId)).toMatchObject({ provider: 'Manuell', amount: 100 });
  });

  it('decodes URL-encoded keys from the S3 event', async () => {
    const { claimId, key } = await draft();
    s3.on(GetObjectCommand).resolves({ Body: body(pdf), ContentLength: pdf.length });
    textract.on(AnalyzeExpenseCommand).resolves(textractResponse);
    await extractHandler(s3Event(key.replace(/-/g, '%2D')));
    expect(stored(claimId)).toMatchObject({ extractionStatus: 'DONE' });
  });
});
