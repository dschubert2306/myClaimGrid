import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler as claimsHandler } from '../src/handlers/claims';
import { handler as dashboardHandler } from '../src/handlers/dashboard';
import { handler as personsHandler } from '../src/handlers/persons';
import { handler as reimbursementHandler } from '../src/handlers/reimbursement';
import type { ClaimItem } from '../src/lib/items';
import { saveEntries } from '../src/lib/repo';
import { fakeDynamo } from './helpers/dynamo';
import { apiEvent, json } from './helpers/events';
import { PDF_BYTES, PNG_BYTES, fakeS3 } from './helpers/s3';

let db: ReturnType<typeof fakeDynamo>;
let s3: ReturnType<typeof fakeS3>;
let personId: string;

const fields = { provider: 'Praxis Dr. Beispiel', invoiceDate: '2026-03-12', amount: 10000 };

const call = (routeKey: string, options: Parameters<typeof apiEvent>[1] = {}) =>
  reimbursementHandler(apiEvent(routeKey, options));

async function createClaim(extra: Record<string, unknown> = {}, sub = 'user-1') {
  const { persons } = json(await personsHandler(apiEvent('GET /persons', { sub })));
  const result = await claimsHandler(
    apiEvent('POST /claims', { sub, body: { personId: persons[0].personId, ...fields, ...extra } }),
  );
  expect(result.statusCode).toBe(201);
  return json(result);
}

/** Requests a presigned POST and stands in for the browser upload to S3. */
async function upload(
  claimId: string,
  content: Uint8Array | string = PDF_BYTES,
  contentType = 'application/pdf',
): Promise<string> {
  const size = typeof content === 'string' ? content.length : content.length;
  const result = await call('POST /claims/{id}/documents', {
    pathParameters: { id: claimId },
    body: { contentType, size },
  });
  expect(result.statusCode).toBe(201);
  const { uploadId, upload: post } = json(result);
  s3.put(post.fields.key, content, contentType);
  return uploadId;
}

async function addEntry(claimId: string, body: Record<string, unknown>, sub = 'user-1') {
  return call('POST /claims/{id}/entries', { sub, pathParameters: { id: claimId }, body });
}

beforeEach(async () => {
  db = fakeDynamo();
  s3 = fakeS3();
  const { persons } = json(await personsHandler(apiEvent('GET /persons')));
  personId = persons[0].personId;
});

describe('migration of claims saved before the reimbursement tracking', () => {
  // Exactly the shape release 1 and 2 wrote: no submittedAt, paidAt or reimbursementEntries.
  const legacy = (claimId: string): ClaimItem => ({
    pk: `PERSON#${personId}`,
    sk: `CLAIM#2025-11-03#${claimId}`,
    gsi1pk: `CLAIM#${claimId}`,
    entity: 'CLAIM',
    userSub: 'user-1',
    claimId,
    personId,
    status: 'OPEN',
    source: 'EXTRACTED',
    year: 2025,
    provider: 'Altpraxis',
    invoiceNumber: 'A-1',
    invoiceDate: '2025-11-03',
    amount: 4200,
    currency: 'EUR',
    description: 'Kontrolle',
    s3Key: `uploads/user-1/${claimId}.pdf`,
    extractionStatus: 'DONE',
    extraction: { confidence: { provider: 90 } },
    createdAt: '2025-11-03T10:00:00.000Z',
    updatedAt: '2025-11-03T10:00:00.000Z',
  });

  it('reads an old claim as open, not submitted and not paid, with every field intact', async () => {
    const claimId = crypto.randomUUID();
    db.seed(legacy(claimId) as unknown as Record<string, unknown>);

    const detail = json(
      await claimsHandler(apiEvent('GET /claims/{id}', { pathParameters: { id: claimId } })),
    );
    expect(detail).toMatchObject({
      provider: 'Altpraxis',
      invoiceNumber: 'A-1',
      amount: 4200,
      description: 'Kontrolle',
      hasPdf: true,
      extraction: { confidence: { provider: 90 } },
      submittedAt: null,
      paidAt: null,
      reimbursement: {
        status: 'OPEN',
        entries: [],
        reimbursed: 0,
        outstanding: 4200,
        selfBorne: 0,
      },
    });

    const dashboard = json(
      await dashboardHandler(apiEvent('GET /dashboard', { query: { year: '2025' } })),
    );
    expect(dashboard.persons[0]).toMatchObject({ totalAmount: 4200, outstandingAmount: 4200 });
  });

  it('keeps every old attribute when the first entry is added', async () => {
    const claimId = crypto.randomUUID();
    const before = legacy(claimId);
    db.seed(before as unknown as Record<string, unknown>);
    expect(
      (await addEntry(claimId, { status: 'IN_PROGRESS', date: '2025-11-10' })).statusCode,
    ).toBe(201);
    const after = structuredClone(db.find((i) => i.claimId === claimId)) as Record<string, unknown>;
    expect(after.reimbursementEntries).toHaveLength(1);
    const old: Record<string, unknown> = { ...before };
    for (const changed of ['updatedAt', 'reimbursementEntries']) {
      delete after[changed];
      delete old[changed];
    }
    expect(after).toEqual(old);
  });
});

describe('submission and self-payment dates', () => {
  it('are set on create, kept when left out, changed and cleared with null', async () => {
    const claim = await createClaim({ submittedAt: '2026-03-14' });
    expect(claim).toMatchObject({ submittedAt: '2026-03-14', paidAt: null });

    const put = (body: Record<string, unknown>) =>
      claimsHandler(
        apiEvent('PUT /claims/{id}', {
          pathParameters: { id: claim.claimId },
          body: { ...fields, ...body },
        }),
      ).then(json);

    expect(await put({ paidAt: '2026-03-20' })).toMatchObject({
      submittedAt: '2026-03-14',
      paidAt: '2026-03-20',
    });
    expect(await put({})).toMatchObject({ submittedAt: '2026-03-14', paidAt: '2026-03-20' });
    expect(await put({ paidAt: '2026-03-21' })).toMatchObject({ paidAt: '2026-03-21' });
    expect(await put({ paidAt: null, submittedAt: null })).toMatchObject({
      submittedAt: null,
      paidAt: null,
    });
  });

  it('is independent of the reimbursement status', async () => {
    const claim = await createClaim({ paidAt: '2026-03-20' });
    await addEntry(claim.claimId, { status: 'PAID', date: '2026-04-01', reimbursedAmount: 10000 });
    const detail = json(
      await claimsHandler(apiEvent('GET /claims/{id}', { pathParameters: { id: claim.claimId } })),
    );
    expect(detail).toMatchObject({ paidAt: '2026-03-20', reimbursement: { status: 'PAID' } });
  });
});

describe('document uploads', () => {
  it('returns a presigned POST into the staging prefix, limited to the declared type and 10 MB', async () => {
    const claim = await createClaim();
    const result = await call('POST /claims/{id}/documents', {
      pathParameters: { id: claim.claimId },
      body: { contentType: 'image/png', size: 2000 },
    });
    const { uploadId, upload } = json(result);
    expect(upload.fields.key).toBe(`incoming/user-1/${claim.claimId}/${uploadId}`);
    const policy = JSON.parse(Buffer.from(upload.fields.Policy, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 10 * 1024 * 1024]);
    expect(policy.conditions).toContainEqual(['eq', '$Content-Type', 'image/png']);
  });

  it('refuses other file types, oversized files and drafts', async () => {
    const claim = await createClaim();
    for (const body of [
      { contentType: 'text/html', size: 10 },
      { contentType: 'application/pdf', size: 10 * 1024 * 1024 + 1 },
      { contentType: 'application/pdf', size: 0 },
    ]) {
      const result = await call('POST /claims/{id}/documents', {
        pathParameters: { id: claim.claimId },
        body,
      });
      expect(result.statusCode, JSON.stringify(body)).toBe(400);
    }
    const draft = json(await claimsHandler(apiEvent('POST /uploads', { body: { personId } })));
    const result = await call('POST /claims/{id}/documents', {
      pathParameters: { id: draft.claim.claimId },
      body: { contentType: 'application/pdf', size: 10 },
    });
    expect(result.statusCode).toBe(409);
  });
});

describe('history: submission, partial reimbursement with a document, full reimbursement', () => {
  it('derives the status from the latest entry and sums up the reimbursements', async () => {
    const claim = await createClaim({ submittedAt: '2026-03-14' });
    const id = claim.claimId;

    let result = await addEntry(id, { status: 'IN_PROGRESS', date: '2026-03-20' });
    expect(json(result).reimbursement).toMatchObject({ status: 'IN_PROGRESS', outstanding: 10000 });

    const uploadId = await upload(id);
    result = await addEntry(id, {
      status: 'PARTLY_PAID',
      date: '2026-04-02',
      reimbursedAmount: 6000,
      rejectedAmount: 500,
      note: 'Leistungsabrechnung 1',
      documents: [{ uploadId, fileName: 'Leistungsabrechnung.pdf' }],
    });
    expect(result.statusCode).toBe(201);
    const partly = json(result);
    expect(partly.reimbursement).toMatchObject({
      status: 'PARTLY_PAID',
      reimbursed: 6000,
      rejected: 500,
      outstanding: 3500,
      selfBorne: 500,
    });
    const document = partly.reimbursement.entries[1].documents[0];
    expect(document).toEqual({
      documentId: uploadId,
      fileName: 'Leistungsabrechnung.pdf',
      contentType: 'application/pdf',
      size: PDF_BYTES.length,
      uploadedAt: expect.any(String),
    });
    // Moved out of staging next to the claim. The S3 key never reaches the API.
    expect(s3.has(`insurer/user-1/${id}/${uploadId}`)).toBe(true);
    expect(s3.has(`incoming/user-1/${id}/${uploadId}`)).toBe(false);
    expect(JSON.stringify(partly)).not.toContain('insurer/');

    result = await addEntry(id, { status: 'PAID', date: '2026-04-20', reimbursedAmount: 3500 });
    expect(json(result).reimbursement).toMatchObject({
      status: 'PAID',
      reimbursed: 9500,
      outstanding: 0,
      selfBorne: 500,
    });
    expect(json(result).reimbursement.entries.map((e: { status: string }) => e.status)).toEqual([
      'IN_PROGRESS',
      'PARTLY_PAID',
      'PAID',
    ]);
  });

  it('signs a document link for one minute, inline and with the original name', async () => {
    const claim = await createClaim();
    const uploadId = await upload(claim.claimId);
    await addEntry(claim.claimId, {
      status: 'IN_PROGRESS',
      date: '2026-03-20',
      documents: [{ uploadId, fileName: 'Schreiben März.pdf' }],
    });
    const result = await call('GET /claims/{id}/documents/{documentId}/url', {
      pathParameters: { id: claim.claimId, documentId: uploadId },
    });
    const { url, expiresIn } = json(result);
    expect(expiresIn).toBe(60);
    const params = new URL(url).searchParams;
    expect(new URL(url).pathname).toContain(`insurer/user-1/${claim.claimId}/${uploadId}`);
    expect(params.get('X-Amz-Expires')).toBe('60');
    expect(params.get('response-content-type')).toBe('application/pdf');
    expect(params.get('response-content-disposition')).toBe(
      `inline; filename="Schreiben M_rz.pdf"; filename*=UTF-8''Schreiben%20M%C3%A4rz.pdf`,
    );
  });
});

describe('server side validation', () => {
  it('never lets reimbursed and rejected amounts exceed the invoice amount', async () => {
    const claim = await createClaim();
    const id = claim.claimId;
    let result = await addEntry(id, {
      status: 'PAID',
      date: '2026-04-01',
      reimbursedAmount: 10001,
    });
    expect(result.statusCode).toBe(400);
    expect(json(result).error.code).toBe('amount_above_invoice');

    await addEntry(id, { status: 'PARTLY_PAID', date: '2026-04-01', reimbursedAmount: 7000 });
    result = await addEntry(id, {
      status: 'PAID',
      date: '2026-04-10',
      reimbursedAmount: 2500,
      rejectedAmount: 501,
    });
    expect(json(result).error.code).toBe('amount_above_invoice');
    result = await addEntry(id, {
      status: 'PAID',
      date: '2026-04-10',
      reimbursedAmount: 2500,
      rejectedAmount: 500,
    });
    expect(result.statusCode).toBe(201);
  });

  it('rejects negative amounts and amounts on statuses without a payment', async () => {
    const claim = await createClaim();
    for (const body of [
      { status: 'PARTLY_PAID', date: '2026-04-01', reimbursedAmount: -100 },
      { status: 'PARTLY_PAID', date: '2026-04-01', reimbursedAmount: 100, rejectedAmount: -1 },
      { status: 'PAID', date: '2026-04-01' },
      { status: 'IN_PROGRESS', date: '2026-04-01', reimbursedAmount: 100 },
      { status: 'DONE', date: '2026-04-01' },
    ]) {
      expect((await addEntry(claim.claimId, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('does not lower the invoice amount below what was reimbursed already', async () => {
    const claim = await createClaim();
    await addEntry(claim.claimId, {
      status: 'PARTLY_PAID',
      date: '2026-04-01',
      reimbursedAmount: 6000,
    });
    const result = await claimsHandler(
      apiEvent('PUT /claims/{id}', {
        pathParameters: { id: claim.claimId },
        body: { ...fields, amount: 5999 },
      }),
    );
    expect(result.statusCode).toBe(400);
    expect(json(result).error.code).toBe('amount_below_reimbursed');
  });

  it('checks that the stored file is what it claims to be and leaves the claim unchanged otherwise', async () => {
    const claim = await createClaim();
    const fake = await upload(claim.claimId, '<html><script>', 'application/pdf');
    let result = await addEntry(claim.claimId, {
      status: 'IN_PROGRESS',
      date: '2026-04-01',
      documents: [{ uploadId: fake, fileName: 'x.pdf' }],
    });
    expect(json(result).error.code).toBe('invalid_document');

    const png = await upload(claim.claimId, PNG_BYTES, 'image/png');
    const missing = crypto.randomUUID();
    result = await addEntry(claim.claimId, {
      status: 'IN_PROGRESS',
      date: '2026-04-01',
      documents: [
        { uploadId: png, fileName: 'foto.png' },
        { uploadId: missing, fileName: 'y.pdf' },
      ],
    });
    expect(json(result).error.code).toBe('upload_missing');
    // The copy of the valid file was removed again, the claim has no entry.
    expect(s3.keys().filter((k) => k.startsWith('insurer/'))).toEqual([]);
    expect(db.find((i) => i.claimId === claim.claimId)?.reimbursementEntries).toEqual([]);
  });

  it('only accepts uploads made for the same claim', async () => {
    const first = await createClaim();
    const second = await createClaim();
    const uploadId = await upload(first.claimId);
    const result = await addEntry(second.claimId, {
      status: 'IN_PROGRESS',
      date: '2026-04-01',
      documents: [{ uploadId, fileName: 'a.pdf' }],
    });
    expect(json(result).error.code).toBe('upload_missing');
  });

  it('fails with a conflict when the claim changed since it was read', async () => {
    const claim = await createClaim();
    const stale = db.find((i) => i.claimId === claim.claimId) as unknown as ClaimItem;
    await addEntry(claim.claimId, { status: 'IN_PROGRESS', date: '2026-04-01' });
    await expect(saveEntries(stale, [])).rejects.toMatchObject({
      name: 'ConditionalCheckFailedException',
    });
  });
});

describe('access and deletion', () => {
  it('hides the history of other users', async () => {
    const claim = await createClaim();
    const uploadId = await upload(claim.claimId);
    const added = json(
      await addEntry(claim.claimId, {
        status: 'IN_PROGRESS',
        date: '2026-04-01',
        documents: [{ uploadId, fileName: 'a.pdf' }],
      }),
    );
    const entryId = added.reimbursement.entries[0].entryId;
    for (const [route, params, body] of [
      ['POST /claims/{id}/documents', {}, { contentType: 'application/pdf', size: 10 }],
      ['POST /claims/{id}/entries', {}, { status: 'IN_PROGRESS', date: '2026-04-01' }],
      ['DELETE /claims/{id}/entries/{entryId}', { entryId }, undefined],
      ['DELETE /claims/{id}/documents/{documentId}', { documentId: uploadId }, undefined],
      ['GET /claims/{id}/documents/{documentId}/url', { documentId: uploadId }, undefined],
    ] as const) {
      const result = await call(route, {
        sub: 'intruder',
        pathParameters: { id: claim.claimId, ...params },
        body,
      });
      expect(result.statusCode, route).toBe(404);
    }
    expect(s3.has(`insurer/user-1/${claim.claimId}/${uploadId}`)).toBe(true);
  });

  it('deletes a single document, then the entry with its documents', async () => {
    const claim = await createClaim();
    const a = await upload(claim.claimId);
    const b = await upload(claim.claimId, PNG_BYTES, 'image/png');
    const added = json(
      await addEntry(claim.claimId, {
        status: 'PARTLY_PAID',
        date: '2026-04-01',
        reimbursedAmount: 4000,
        documents: [
          { uploadId: a, fileName: 'a.pdf' },
          { uploadId: b, fileName: 'b.png' },
        ],
      }),
    );
    const entryId = added.reimbursement.entries[0].entryId;

    let result = await call('DELETE /claims/{id}/documents/{documentId}', {
      pathParameters: { id: claim.claimId, documentId: a },
    });
    expect(
      json(result).reimbursement.entries[0].documents.map((d: { fileName: string }) => d.fileName),
    ).toEqual(['b.png']);
    expect(s3.has(`insurer/user-1/${claim.claimId}/${a}`)).toBe(false);

    result = await call('DELETE /claims/{id}/entries/{entryId}', {
      pathParameters: { id: claim.claimId, entryId },
    });
    expect(json(result).reimbursement).toMatchObject({
      status: 'OPEN',
      reimbursed: 0,
      entries: [],
    });
    expect(s3.has(`insurer/user-1/${claim.claimId}/${b}`)).toBe(false);
  });

  it('deletes the insurer documents together with the claim', async () => {
    const claim = await createClaim();
    const uploadId = await upload(claim.claimId);
    await addEntry(claim.claimId, {
      status: 'IN_PROGRESS',
      date: '2026-04-01',
      documents: [{ uploadId, fileName: 'a.pdf' }],
    });
    const result = await claimsHandler(
      apiEvent('DELETE /claims/{id}', { pathParameters: { id: claim.claimId } }),
    );
    expect(result.statusCode).toBe(204);
    expect(s3.mock.commandCalls(DeleteObjectCommand).map((c) => c.args[0].input.Key)).toContain(
      `insurer/user-1/${claim.claimId}/${uploadId}`,
    );
    expect(s3.keys().filter((k) => k.startsWith('insurer/'))).toEqual([]);
  });
});

describe('dashboard per person and year', () => {
  it('sums outstanding, reimbursed and self-borne amounts', async () => {
    const a = await createClaim({ amount: 10000 });
    const b = await createClaim({ amount: 5000, invoiceDate: '2026-05-01' });
    await createClaim({ amount: 2000, invoiceDate: '2026-06-01' });
    await addEntry(a.claimId, { status: 'PAID', date: '2026-04-01', reimbursedAmount: 8000 });
    await addEntry(b.claimId, {
      status: 'PARTLY_PAID',
      date: '2026-05-20',
      reimbursedAmount: 3000,
      rejectedAmount: 500,
    });

    const body = json(
      await dashboardHandler(apiEvent('GET /dashboard', { query: { year: '2026' } })),
    );
    expect(body.persons[0]).toMatchObject({
      count: 3,
      totalAmount: 17000,
      reimbursedAmount: 11000,
      outstandingAmount: 1500 + 2000,
      selfBorneAmount: 2000 + 500,
    });
    expect(body.persons[1]).toMatchObject({ reimbursedAmount: 0, outstandingAmount: 0 });
  });
});
