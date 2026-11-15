import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler as claimsHandler } from '../src/handlers/claims';
import { handler as dashboardHandler } from '../src/handlers/dashboard';
import { handler as personsHandler } from '../src/handlers/persons';
import type { ClaimItem } from '../src/lib/items';
import { fakeDynamo } from './helpers/dynamo';
import { apiEvent, json } from './helpers/events';
import { PDF_BYTES, PNG_BYTES, fakeS3 } from './helpers/s3';

let db: ReturnType<typeof fakeDynamo>;
let s3: ReturnType<typeof fakeS3>;
let personId: string;

const base = {
  provider: 'Praxis Dr. Beispiel',
  invoiceDate: '2026-03-12',
  amount: 10000,
  submittedAt: null,
  paid: false,
  reimbursement: { status: 'OPEN' },
};

const call = (routeKey: string, options: Parameters<typeof apiEvent>[1] = {}) =>
  claimsHandler(apiEvent(routeKey, options));

async function createClaim(extra: Record<string, unknown> = {}, sub = 'user-1') {
  const { persons } = json(await personsHandler(apiEvent('GET /persons', { sub })));
  const result = await call('POST /claims', {
    sub,
    body: { personId: persons[0].personId, ...base, ...extra },
  });
  expect(result.statusCode, result.body).toBe(201);
  return json(result);
}

/** What the dialog sends for a claim that is left as it is. */
function unchanged(claim: ReturnType<typeof json>) {
  const { status, entries, reimbursed, rejected } = claim.reimbursement;
  const pays = status === 'PAID' || status === 'PARTLY_PAID';
  return {
    status,
    ...(entries.length > 0 ? { date: entries.at(-1).date } : {}),
    ...(pays ? { reimbursedAmount: reimbursed, rejectedAmount: rejected } : {}),
  };
}

/** Saves the claim like the dialog: the full state, with `changes` on top. */
async function save(claimId: string, changes: Record<string, unknown> = {}, sub = 'user-1') {
  const current = json(await call('GET /claims/{id}', { sub, pathParameters: { id: claimId } }));
  return call('PUT /claims/{id}', {
    sub,
    pathParameters: { id: claimId },
    body: {
      version: current.updatedAt,
      provider: current.provider,
      invoiceNumber: current.invoiceNumber,
      invoiceDate: current.invoiceDate,
      amount: current.amount,
      description: current.description,
      submittedAt: current.submittedAt,
      paid: current.paidAt !== null,
      paidAt: current.paidAt,
      reimbursement: unchanged(current),
      newDocuments: [],
      removedDocumentIds: [],
      ...changes,
    },
  });
}

/** Requests a presigned POST and stands in for the browser upload to S3. */
async function upload(
  content: Uint8Array | string = PDF_BYTES,
  contentType = 'application/pdf',
  sub = 'user-1',
): Promise<string> {
  const result = await call('POST /document-uploads', {
    sub,
    body: { contentType, size: content.length },
  });
  expect(result.statusCode).toBe(201);
  const { uploadId, upload: post } = json(result);
  s3.put(post.fields.key, content, contentType);
  return uploadId;
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

  /** Release 3 attached the insurer documents to the history entries. */
  const withEntryDocument = (claimId: string, documentId: string): ClaimItem => ({
    ...legacy(claimId),
    submittedAt: '2025-11-05',
    paidAt: '2025-11-06',
    reimbursementEntries: [
      {
        entryId: crypto.randomUUID(),
        status: 'PARTLY_PAID',
        date: '2025-11-20',
        reimbursedAmount: 3000,
        rejectedAmount: null,
        note: 'Erste Abrechnung',
        createdAt: '2025-11-20T09:00:00.000Z',
        documents: [
          {
            documentId,
            fileName: 'Brief.pdf',
            contentType: 'application/pdf',
            size: PDF_BYTES.length,
            uploadedAt: '2025-11-20T09:00:00.000Z',
            s3Key: `insurer/user-1/${claimId}/${documentId}`,
          },
        ],
      },
    ],
  });

  it('reads an old claim as open, not submitted and not paid, with every field intact', async () => {
    const claimId = crypto.randomUUID();
    db.seed(legacy(claimId) as unknown as Record<string, unknown>);

    const detail = json(await call('GET /claims/{id}', { pathParameters: { id: claimId } }));
    expect(detail).toMatchObject({
      provider: 'Altpraxis',
      invoiceNumber: 'A-1',
      amount: 4200,
      description: 'Kontrolle',
      hasPdf: true,
      extraction: { confidence: { provider: 90 } },
      submittedAt: null,
      paidAt: null,
      documents: [],
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

  it('keeps every old attribute when the first change is saved', async () => {
    const claimId = crypto.randomUUID();
    const before = legacy(claimId);
    db.seed(before as unknown as Record<string, unknown>);
    const result = await save(claimId, {
      reimbursement: { status: 'IN_PROGRESS', date: '2025-11-10' },
    });
    expect(result.statusCode, result.body).toBe(200);
    const after = structuredClone(db.find((i) => i.claimId === claimId)) as Record<string, unknown>;
    expect(after.reimbursementEntries).toHaveLength(1);
    const old: Record<string, unknown> = { ...before };
    for (const changed of [
      'updatedAt',
      'reimbursementEntries',
      'insurerDocuments',
      'submittedAt',
      'paidAt',
    ]) {
      delete after[changed];
      delete old[changed];
    }
    expect(after).toEqual(old);
  });

  it('lists documents that release 3 attached to history entries, and keeps them on save', async () => {
    const claimId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    db.seed(withEntryDocument(claimId, documentId) as unknown as Record<string, unknown>);
    s3.put(`insurer/user-1/${claimId}/${documentId}`, PDF_BYTES, 'application/pdf');

    const detail = json(await call('GET /claims/{id}', { pathParameters: { id: claimId } }));
    expect(detail.documents).toEqual([
      {
        documentId,
        fileName: 'Brief.pdf',
        contentType: 'application/pdf',
        size: PDF_BYTES.length,
        uploadedAt: '2025-11-20T09:00:00.000Z',
      },
    ]);
    expect(detail.reimbursement).toMatchObject({ status: 'PARTLY_PAID', reimbursed: 3000 });
    expect(detail.reimbursement.entries[0]).not.toHaveProperty('documents');
    const link = await call('GET /claims/{id}/documents/{documentId}/url', {
      pathParameters: { id: claimId, documentId },
    });
    expect(link.statusCode).toBe(200);

    // The first save moves the document to the claim. Nothing is lost, the file stays.
    expect((await save(claimId, { submittedAt: '2025-11-04' })).statusCode).toBe(200);
    const stored = db.find((i) => i.claimId === claimId) as unknown as ClaimItem;
    expect(stored.insurerDocuments?.map((d) => d.documentId)).toEqual([documentId]);
    expect(stored.reimbursementEntries?.[0]).not.toHaveProperty('documents');
    expect(stored.reimbursementEntries).toHaveLength(1);
    expect(s3.has(`insurer/user-1/${claimId}/${documentId}`)).toBe(true);
  });
});

describe('payment status', () => {
  it('is saved with its date on create and cleared with the toggle', async () => {
    const claim = await createClaim({ paid: true, paidAt: '2026-03-20' });
    expect(claim).toMatchObject({ paidAt: '2026-03-20' });

    const off = json(await save(claim.claimId, { paid: false, paidAt: null }));
    expect(off.paidAt).toBeNull();
    const on = json(await save(claim.claimId, { paid: true, paidAt: '2026-03-21' }));
    expect(on.paidAt).toBe('2026-03-21');
  });

  it('is off by default and needs a real date while it is on', async () => {
    expect((await createClaim()).paidAt).toBeNull();
    const claim = await createClaim();
    for (const changes of [
      { paid: true },
      { paid: true, paidAt: null },
      { paid: true, paidAt: '2026-02-30' },
      { paid: false, paidAt: '2026-03-20' },
    ]) {
      const result = await save(claim.claimId, changes);
      expect(result.statusCode, JSON.stringify(changes)).toBe(400);
    }
    expect(
      (await call('GET /claims/{id}', { pathParameters: { id: claim.claimId } })).statusCode,
    ).toBe(200);
    expect(db.find((i) => i.claimId === claim.claimId)?.paidAt ?? null).toBeNull();
  });

  it('is independent of the reimbursement status: paid, but not reimbursed yet, and the reverse', async () => {
    const claim = await createClaim({ paid: true, paidAt: '2026-03-20' });
    expect(claim).toMatchObject({ paidAt: '2026-03-20', reimbursement: { status: 'OPEN' } });

    const reimbursed = json(
      await save(claim.claimId, {
        paid: false,
        paidAt: null,
        reimbursement: { status: 'PAID', date: '2026-04-01', reimbursedAmount: 10000 },
      }),
    );
    expect(reimbursed).toMatchObject({ paidAt: null, reimbursement: { status: 'PAID' } });
  });
});

describe('document uploads', () => {
  it('returns a presigned POST into the staging prefix, limited to the declared type and 10 MB', async () => {
    const result = await call('POST /document-uploads', {
      body: { contentType: 'image/png', size: 2000 },
    });
    const { uploadId, upload: post } = json(result);
    expect(post.fields.key).toBe(`incoming/user-1/${uploadId}`);
    const policy = JSON.parse(Buffer.from(post.fields.Policy, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 10 * 1024 * 1024]);
    expect(policy.conditions).toContainEqual(['eq', '$Content-Type', 'image/png']);
  });

  it('refuses other file types and oversized or empty files', async () => {
    for (const body of [
      { contentType: 'text/html', size: 10 },
      { contentType: 'application/pdf', size: 10 * 1024 * 1024 + 1 },
      { contentType: 'application/pdf', size: 0 },
    ]) {
      const result = await call('POST /document-uploads', { body });
      expect(result.statusCode, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('one save: submission, partial reimbursement with a document, full reimbursement', () => {
  it('derives the status from the latest entry and sums up the reimbursements', async () => {
    const claim = await createClaim({ submittedAt: '2026-03-14' });
    const id = claim.claimId;
    expect(claim.reimbursement.entries).toEqual([]);

    let result = await save(id, { reimbursement: { status: 'IN_PROGRESS', date: '2026-03-20' } });
    expect(json(result).reimbursement).toMatchObject({ status: 'IN_PROGRESS', outstanding: 10000 });

    const uploadId = await upload();
    result = await save(id, {
      reimbursement: {
        status: 'PARTLY_PAID',
        date: '2026-04-02',
        reimbursedAmount: 6000,
        rejectedAmount: 500,
        note: 'Leistungsabrechnung 1',
      },
      newDocuments: [{ uploadId, fileName: 'Leistungsabrechnung.pdf' }],
    });
    expect(result.statusCode, result.body).toBe(200);
    const partly = json(result);
    expect(partly.reimbursement).toMatchObject({
      status: 'PARTLY_PAID',
      reimbursed: 6000,
      rejected: 500,
      outstanding: 3500,
      selfBorne: 500,
    });
    expect(partly.reimbursement.entries[1]).toMatchObject({
      status: 'PARTLY_PAID',
      date: '2026-04-02',
      reimbursedAmount: 6000,
      rejectedAmount: 500,
      note: 'Leistungsabrechnung 1',
    });
    expect(partly.documents).toEqual([
      {
        documentId: uploadId,
        fileName: 'Leistungsabrechnung.pdf',
        contentType: 'application/pdf',
        size: PDF_BYTES.length,
        uploadedAt: expect.any(String),
      },
    ]);
    // Moved out of staging next to the claim. The S3 key never reaches the API.
    expect(s3.has(`insurer/user-1/${id}/${uploadId}`)).toBe(true);
    expect(s3.has(`incoming/user-1/${uploadId}`)).toBe(false);
    expect(JSON.stringify(partly)).not.toContain('insurer/');

    // The dialog sends the new total, the history stores what came on top.
    result = await save(id, {
      reimbursement: {
        status: 'PAID',
        date: '2026-04-20',
        reimbursedAmount: 9500,
        rejectedAmount: 500,
      },
    });
    const paid = json(result);
    expect(paid.reimbursement).toMatchObject({
      status: 'PAID',
      reimbursed: 9500,
      rejected: 500,
      outstanding: 0,
      selfBorne: 500,
    });
    expect(paid.reimbursement.entries.map((e: { status: string }) => e.status)).toEqual([
      'IN_PROGRESS',
      'PARTLY_PAID',
      'PAID',
    ]);
    expect(paid.reimbursement.entries[2]).toMatchObject({
      reimbursedAmount: 3500,
      rejectedAmount: 0,
    });
    expect(paid.documents).toHaveLength(1);
  });

  it('creates no history entry when the reimbursement data did not change', async () => {
    const claim = await createClaim();
    const first = json(await save(claim.claimId, { provider: 'Neuer Name' }));
    expect(first).toMatchObject({ provider: 'Neuer Name' });
    expect(first.reimbursement.entries).toEqual([]);

    const partly = json(
      await save(claim.claimId, {
        reimbursement: { status: 'PARTLY_PAID', date: '2026-04-01', reimbursedAmount: 4000 },
      }),
    );
    const again = json(await save(claim.claimId, { description: 'Ergänzt' }));
    expect(again.reimbursement.entries).toHaveLength(1);
    expect(again.updatedAt > partly.updatedAt).toBe(true);
  });

  it('records a correction downwards and a new creation with a reimbursement', async () => {
    const claim = await createClaim({
      reimbursement: { status: 'PAID', date: '2026-04-01', reimbursedAmount: 9000 },
    });
    expect(claim.reimbursement).toMatchObject({
      status: 'PAID',
      reimbursed: 9000,
      selfBorne: 1000,
    });

    const corrected = json(
      await save(claim.claimId, {
        reimbursement: {
          status: 'PAID',
          date: '2026-04-02',
          reimbursedAmount: 8000,
          rejectedAmount: 1000,
        },
      }),
    );
    expect(corrected.reimbursement).toMatchObject({ reimbursed: 8000, rejected: 1000 });
    expect(corrected.reimbursement.entries[1]).toMatchObject({
      reimbursedAmount: -1000,
      rejectedAmount: 1000,
    });
  });

  it('signs a document link for one minute, inline and with the original name', async () => {
    const claim = await createClaim();
    const uploadId = await upload();
    await save(claim.claimId, { newDocuments: [{ uploadId, fileName: 'Schreiben März.pdf' }] });
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
  const rejected = async (claimId: string, changes: Record<string, unknown>) => {
    const result = await save(claimId, changes);
    expect(result.statusCode, JSON.stringify(changes)).toBe(400);
    return json(result).error.code as string;
  };

  it('never lets reimbursed and rejected amounts exceed the invoice amount', async () => {
    const claim = await createClaim();
    const id = claim.claimId;
    expect(
      await rejected(id, {
        reimbursement: { status: 'PAID', date: '2026-04-01', reimbursedAmount: 10001 },
      }),
    ).toBe('amount_above_invoice');
    expect(
      await rejected(id, {
        reimbursement: {
          status: 'PAID',
          date: '2026-04-01',
          reimbursedAmount: 9500,
          rejectedAmount: 501,
        },
      }),
    ).toBe('amount_above_invoice');
    const result = await save(id, {
      reimbursement: {
        status: 'PAID',
        date: '2026-04-01',
        reimbursedAmount: 9500,
        rejectedAmount: 500,
      },
    });
    expect(result.statusCode).toBe(200);
  });

  it('rejects negative amounts and amounts on statuses without a payment', async () => {
    const claim = await createClaim();
    for (const reimbursement of [
      { status: 'PARTLY_PAID', date: '2026-04-01', reimbursedAmount: -100 },
      { status: 'PARTLY_PAID', date: '2026-04-01', reimbursedAmount: 100, rejectedAmount: -1 },
      { status: 'PAID', date: '2026-04-01' },
      { status: 'IN_PROGRESS', date: '2026-04-01', reimbursedAmount: 100 },
      { status: 'DONE', date: '2026-04-01' },
    ]) {
      await rejected(claim.claimId, { reimbursement });
    }
    await rejected(claim.claimId, { amount: -5 });
    await rejected(claim.claimId, { amount: 0 });
  });

  it('needs a date for a change, and not one before the latest entry', async () => {
    const claim = await createClaim();
    expect(await rejected(claim.claimId, { reimbursement: { status: 'IN_PROGRESS' } })).toBe(
      'date_required',
    );
    await save(claim.claimId, { reimbursement: { status: 'IN_PROGRESS', date: '2026-04-10' } });
    expect(
      await rejected(claim.claimId, {
        reimbursement: { status: 'PARTLY_PAID', date: '2026-04-09', reimbursedAmount: 100 },
      }),
    ).toBe('date_before_latest');
  });

  it('does not lower the invoice amount below what was reimbursed already', async () => {
    const claim = await createClaim();
    await save(claim.claimId, {
      reimbursement: { status: 'PARTLY_PAID', date: '2026-04-01', reimbursedAmount: 6000 },
    });
    expect(await rejected(claim.claimId, { amount: 5999 })).toBe('amount_above_invoice');
    expect((await save(claim.claimId, { amount: 6000 })).statusCode).toBe(200);
  });

  it('checks that the stored file is what it claims to be and changes nothing otherwise', async () => {
    const claim = await createClaim();
    const fake = await upload('<html><script>', 'application/pdf');
    const changes = {
      reimbursement: { status: 'IN_PROGRESS', date: '2026-04-01' },
    };
    expect(
      await rejected(claim.claimId, {
        ...changes,
        newDocuments: [{ uploadId: fake, fileName: 'x.pdf' }],
      }),
    ).toBe('invalid_document');

    const png = await upload(PNG_BYTES, 'image/png');
    const missing = crypto.randomUUID();
    expect(
      await rejected(claim.claimId, {
        ...changes,
        newDocuments: [
          { uploadId: png, fileName: 'foto.png' },
          { uploadId: missing, fileName: 'y.pdf' },
        ],
      }),
    ).toBe('upload_missing');
    // The copy of the valid file was removed again, the claim is as it was.
    expect(s3.keys().filter((k) => k.startsWith('insurer/'))).toEqual([]);
    const stored = db.find((i) => i.claimId === claim.claimId) as unknown as ClaimItem;
    expect(stored.reimbursementEntries).toEqual([]);
    expect(stored.insurerDocuments).toEqual([]);
  });

  it('only accepts uploads made by the same user', async () => {
    const mine = await createClaim();
    const uploadId = await upload(PDF_BYTES, 'application/pdf', 'someone-else');
    expect(await rejected(mine.claimId, { newDocuments: [{ uploadId, fileName: 'a.pdf' }] })).toBe(
      'upload_missing',
    );
  });

  it('limits the number of documents per claim', async () => {
    const claim = await createClaim();
    const attach = async (count: number) =>
      save(claim.claimId, {
        newDocuments: await Promise.all(
          Array.from({ length: count }, async (_, i) => ({
            uploadId: await upload(),
            fileName: `${i}.pdf`,
          })),
        ),
      });
    expect((await attach(20)).statusCode).toBe(200);
    expect(json(await attach(1)).error.code).toBe('too_many_documents');
    // Removing one in the same save makes room.
    const first = json(await call('GET /claims/{id}', { pathParameters: { id: claim.claimId } }))
      .documents[0].documentId;
    const result = await save(claim.claimId, {
      removedDocumentIds: [first],
      newDocuments: [{ uploadId: await upload(), fileName: 'neu.pdf' }],
    });
    expect(json(result).documents).toHaveLength(20);
    // More than the limit in one request is refused outright.
    expect((await attach(21)).statusCode).toBe(400);
  });

  it('refuses a save from an outdated dialog with a conflict and leaves the claim alone', async () => {
    const claim = await createClaim();
    const stale = claim.updatedAt;
    await save(claim.claimId, { provider: 'Anderer Tab' });
    const result = await save(claim.claimId, {
      version: stale,
      provider: 'Veraltet',
      reimbursement: { status: 'IN_PROGRESS', date: '2026-04-01' },
    });
    expect(result.statusCode).toBe(409);
    expect(json(result).error.code).toBe('conflict');
    const stored = db.find((i) => i.claimId === claim.claimId) as unknown as ClaimItem;
    expect(stored).toMatchObject({ provider: 'Anderer Tab', reimbursementEntries: [] });
  });
});

describe('access and deletion', () => {
  it('hides claims and documents of other users', async () => {
    const claim = await createClaim();
    const uploadId = await upload();
    await save(claim.claimId, { newDocuments: [{ uploadId, fileName: 'a.pdf' }] });
    const current = json(await call('GET /claims/{id}', { pathParameters: { id: claim.claimId } }));
    for (const [route, params, body] of [
      ['GET /claims/{id}/documents/{documentId}/url', { documentId: uploadId }, undefined],
      [
        'PUT /claims/{id}',
        {},
        {
          ...base,
          version: current.updatedAt,
          removedDocumentIds: [uploadId],
        },
      ],
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

  it('removes documents with the save and deletes their files', async () => {
    const claim = await createClaim();
    const a = await upload();
    const b = await upload(PNG_BYTES, 'image/png');
    await save(claim.claimId, {
      newDocuments: [
        { uploadId: a, fileName: 'a.pdf' },
        { uploadId: b, fileName: 'b.png' },
      ],
    });

    const result = await save(claim.claimId, { removedDocumentIds: [a] });
    expect(json(result).documents.map((d: { fileName: string }) => d.fileName)).toEqual(['b.png']);
    expect(s3.has(`insurer/user-1/${claim.claimId}/${a}`)).toBe(false);
    expect(s3.has(`insurer/user-1/${claim.claimId}/${b}`)).toBe(true);

    // Unknown documents are refused, and the file of another claim stays untouched.
    const unknown = await save(claim.claimId, { removedDocumentIds: [crypto.randomUUID()] });
    expect(unknown.statusCode).toBe(404);
    expect(json(unknown).error.code).toBe('document_not_found');

    // Remove and add in one save.
    const c = await upload();
    const swapped = json(
      await save(claim.claimId, {
        removedDocumentIds: [b],
        newDocuments: [{ uploadId: c, fileName: 'c.pdf' }],
      }),
    );
    expect(swapped.documents.map((d: { fileName: string }) => d.fileName)).toEqual(['c.pdf']);
    expect(s3.keys().filter((k) => k.startsWith('insurer/'))).toEqual([
      `insurer/user-1/${claim.claimId}/${c}`,
    ]);
  });

  it('deletes the insurer documents together with the claim', async () => {
    const claim = await createClaim();
    const uploadId = await upload();
    await save(claim.claimId, { newDocuments: [{ uploadId, fileName: 'a.pdf' }] });
    const result = await call('DELETE /claims/{id}', { pathParameters: { id: claim.claimId } });
    expect(result.statusCode).toBe(204);
    expect(s3.mock.commandCalls(DeleteObjectCommand).map((c) => c.args[0].input.Key)).toContain(
      `insurer/user-1/${claim.claimId}/${uploadId}`,
    );
    expect(s3.keys().filter((k) => k.startsWith('insurer/'))).toEqual([]);
  });
});

describe('dashboard per person and year', () => {
  it('sums outstanding, reimbursed and self-borne amounts', async () => {
    const paid = (amount: number) => ({
      reimbursement: { status: 'PAID', date: '2026-04-01', reimbursedAmount: amount },
    });
    await createClaim({ amount: 10000, ...paid(8000) });
    await createClaim({
      amount: 5000,
      invoiceDate: '2026-05-01',
      reimbursement: {
        status: 'PARTLY_PAID',
        date: '2026-05-20',
        reimbursedAmount: 3000,
        rejectedAmount: 500,
      },
    });
    await createClaim({ amount: 2000, invoiceDate: '2026-06-01' });

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
