import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler as claimsHandler } from '../src/handlers/claims';
import { handler as personsHandler } from '../src/handlers/persons';
import { apiEvent, json } from './helpers/events';
import { fakeDynamo } from './helpers/dynamo';

let db: ReturnType<typeof fakeDynamo>;
let s3: ReturnType<typeof mockClient>;
let personId: string;

const fields = { provider: 'Praxis Dr. Beispiel', invoiceDate: '2026-03-12', amount: 12345 };

async function call(routeKey: string, options: Parameters<typeof apiEvent>[1] = {}) {
  return claimsHandler(apiEvent(routeKey, options));
}

async function listYear(year: number, sub = 'user-1') {
  const result = await call('GET /persons/{id}/claims', {
    sub,
    pathParameters: { id: personId },
    query: { year: String(year) },
  });
  return json(result).claims as { claimId: string }[];
}

beforeEach(async () => {
  db = fakeDynamo();
  s3 = mockClient(S3Client);
  const { persons } = json(await personsHandler(apiEvent('GET /persons')));
  personId = persons[0].personId;
});

describe('manual claims', () => {
  it('creates an OPEN claim with a dated sort key and lists it for its year', async () => {
    const result = await call('POST /claims', { body: { personId, ...fields } });
    expect(result.statusCode).toBe(201);
    const claim = json(result);
    expect(claim).toMatchObject({
      status: 'OPEN',
      source: 'MANUAL',
      year: 2026,
      amount: 12345,
      currency: 'EUR',
      hasPdf: false,
      invoiceNumber: '',
    });
    expect(db.find((i) => i.claimId === claim.claimId)?.sk).toBe(
      `CLAIM#2026-03-12#${claim.claimId}`,
    );
    expect(await listYear(2026)).toHaveLength(1);
    expect(await listYear(2025)).toHaveLength(0);
  });

  it('lists newest invoice date first', async () => {
    await call('POST /claims', { body: { personId, ...fields, invoiceDate: '2026-01-05' } });
    await call('POST /claims', { body: { personId, ...fields, invoiceDate: '2026-06-01' } });
    const dates = json(
      await call('GET /persons/{id}/claims', {
        pathParameters: { id: personId },
        query: { year: '2026' },
      }),
    ).claims.map((c: { invoiceDate: string }) => c.invoiceDate);
    expect(dates).toEqual(['2026-06-01', '2026-01-05']);
  });

  it('validates the body and rejects bank data fields', async () => {
    for (const body of [
      { personId, ...fields, amount: 0 },
      { personId, ...fields, invoiceDate: '2026-02-30' },
      { personId, ...fields, provider: '' },
      { personId, ...fields, iban: 'DE02120300000000202051' },
    ]) {
      expect((await call('POST /claims', { body })).statusCode).toBe(400);
    }
  });

  it('does not accept a person of another user', async () => {
    const { persons } = json(await personsHandler(apiEvent('GET /persons', { sub: 'other' })));
    const result = await call('POST /claims', {
      body: { personId: persons[0].personId, ...fields },
    });
    expect(result.statusCode).toBe(404);
  });
});

describe('uploads and drafts', () => {
  async function createDraft() {
    const result = await call('POST /uploads', { body: { personId } });
    expect(result.statusCode).toBe(201);
    return json(result);
  }

  it('creates a PENDING draft and a presigned POST limited to PDF and 10 MB', async () => {
    const { claim, upload } = await createDraft();
    expect(claim).toMatchObject({
      status: 'DRAFT',
      source: 'EXTRACTED',
      extractionStatus: 'PENDING',
      hasPdf: true,
      amount: null,
    });
    expect(upload.url).toContain('test-bucket');
    const policy = JSON.parse(Buffer.from(upload.fields.Policy, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 10 * 1024 * 1024]);
    expect(policy.conditions).toContainEqual(['eq', '$Content-Type', 'application/pdf']);
    expect(upload.fields.key).toBe(`uploads/user-1/${claim.claimId}.pdf`);
  });

  it('keeps drafts out of the year list', async () => {
    await createDraft();
    for (const year of [new Date().getUTCFullYear(), 2026]) {
      expect(await listYear(year)).toHaveLength(0);
    }
  });

  it('moves a draft to the dated key on save and stops waiting for the extraction', async () => {
    const { claim } = await createDraft();
    const result = await call('PUT /claims/{id}', {
      pathParameters: { id: claim.claimId },
      body: fields,
    });
    expect(result.statusCode).toBe(200);
    expect(json(result)).toMatchObject({ status: 'OPEN', year: 2026, extractionStatus: 'FAILED' });
    const sorts = db
      .items()
      .filter((i) => i.claimId === claim.claimId)
      .map((i) => i.sk);
    expect(sorts).toEqual([`CLAIM#2026-03-12#${claim.claimId}`]);
    expect(await listYear(2026)).toHaveLength(1);
  });

  it('moves the claim again when the invoice date changes year', async () => {
    const claim = json(await call('POST /claims', { body: { personId, ...fields } }));
    await call('PUT /claims/{id}', {
      pathParameters: { id: claim.claimId },
      body: { ...fields, invoiceDate: '2025-12-31' },
    });
    expect(await listYear(2025)).toHaveLength(1);
    expect(db.items().filter((i) => i.claimId === claim.claimId)).toHaveLength(1);
  });
});

describe('single claim', () => {
  it('returns a presigned PDF URL for extracted claims and null for manual ones', async () => {
    const { claim } = json(await call('POST /uploads', { body: { personId } }));
    const detail = json(await call('GET /claims/{id}', { pathParameters: { id: claim.claimId } }));
    expect(detail.pdfUrl).toContain(`uploads/user-1/${claim.claimId}.pdf`);
    expect(detail.pdfUrl).toContain('response-content-type=application%2Fpdf');

    const manual = json(await call('POST /claims', { body: { personId, ...fields } }));
    const manualDetail = json(
      await call('GET /claims/{id}', { pathParameters: { id: manual.claimId } }),
    );
    expect(manualDetail.pdfUrl).toBeNull();
  });

  it('hides claims of other users and rejects malformed ids', async () => {
    const claim = json(await call('POST /claims', { body: { personId, ...fields } }));
    for (const route of ['GET /claims/{id}', 'DELETE /claims/{id}']) {
      const result = await call(route, { sub: 'intruder', pathParameters: { id: claim.claimId } });
      expect(result.statusCode).toBe(404);
    }
    const put = await call('PUT /claims/{id}', {
      sub: 'intruder',
      pathParameters: { id: claim.claimId },
      body: fields,
    });
    expect(put.statusCode).toBe(404);
    expect((await call('GET /claims/{id}', { pathParameters: { id: 'nope' } })).statusCode).toBe(
      404,
    );
    expect(db.items().filter((i) => i.claimId === claim.claimId)).toHaveLength(1);
  });

  it('deletes the claim and its file', async () => {
    s3.on(DeleteObjectCommand).resolves({});
    const { claim } = json(await call('POST /uploads', { body: { personId } }));
    const result = await call('DELETE /claims/{id}', { pathParameters: { id: claim.claimId } });
    expect(result.statusCode).toBe(204);
    expect(s3.commandCalls(DeleteObjectCommand)[0]?.args[0].input).toEqual({
      Bucket: 'test-bucket',
      Key: `uploads/user-1/${claim.claimId}.pdf`,
    });
    expect(db.items().filter((i) => i.claimId === claim.claimId)).toHaveLength(0);
  });

  it('deletes a manual claim without touching S3', async () => {
    const claim = json(await call('POST /claims', { body: { personId, ...fields } }));
    expect(
      (await call('DELETE /claims/{id}', { pathParameters: { id: claim.claimId } })).statusCode,
    ).toBe(204);
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it('requires a year for the list', async () => {
    const result = await call('GET /persons/{id}/claims', { pathParameters: { id: personId } });
    expect(result.statusCode).toBe(400);
  });
});
