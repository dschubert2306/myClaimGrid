import type { Page, Route } from '@playwright/test';
import {
  createClaimRequestSchema,
  planReimbursementChange,
  reimbursementTotals,
  saveClaimRequestSchema,
  sortEntries,
  type InsurerDocument,
  type ReimbursementEntry,
} from '@myclaimgrid/shared';

/** An in-memory stand-in for the API. Same origin as the app, so there is no CORS to mock. */

const PERSONS = [
  {
    personId: '00000000-0000-4000-8000-000000000001',
    name: 'Anna',
    color: 'person-1',
    deductible: 0,
  },
  {
    personId: '00000000-0000-4000-8000-000000000002',
    name: 'Jonas',
    color: 'person-2',
    deductible: 0,
  },
  {
    personId: '00000000-0000-4000-8000-000000000003',
    name: 'Lea',
    color: 'person-3',
    deductible: 0,
  },
];

export interface MockClaim {
  claimId: string;
  personId: string;
  status: 'DRAFT' | 'OPEN';
  source: 'EXTRACTED' | 'MANUAL';
  year: number | null;
  provider: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: number | null;
  currency: 'EUR';
  description: string | null;
  hasPdf: boolean;
  extractionStatus: 'PENDING' | 'DONE' | 'FAILED' | null;
  extraction: { confidence: Record<string, number> } | null;
  submittedAt: string | null;
  paidAt: string | null;
  /** History as the API returns it, the totals are derived on every response. */
  entries: ReimbursementEntry[];
  documents: InsurerDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface MockApi {
  claims: MockClaim[];
  persons: typeof PERSONS;
  requests: string[];
  /** What the extraction "reads" from the next uploaded PDF. */
  extraction: 'DONE' | 'FAILED';
  uploadedFiles: number;
  /** Uploads handed out by POST /document-uploads: upload id -> content type. */
  stagedUploads: Map<string, string>;
  /** Documents that were opened through a signed link. */
  openedDocuments: string[];
}

/** The claim as the API sends it: totals derived from the history, like the backend does. */
function toApi(claim: MockClaim) {
  const { entries, ...rest } = claim;
  const sorted = sortEntries(entries);
  return {
    ...rest,
    reimbursement: { ...reimbursementTotals(claim.amount, sorted), entries: sorted },
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

let counter = 0;
const newId = () => `10000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export async function mockBackend(page: Page, seed: Partial<MockClaim>[] = []): Promise<MockApi> {
  const api: MockApi = {
    claims: [],
    persons: structuredClone(PERSONS),
    requests: [],
    extraction: 'DONE',
    uploadedFiles: 0,
    stagedUploads: new Map(),
    openedDocuments: [],
  };
  const now = '2026-03-12T10:00:00.000Z';

  for (const partial of seed) {
    api.claims.push({
      claimId: newId(),
      personId: PERSONS[0]!.personId,
      status: 'OPEN',
      source: 'MANUAL',
      year: 2026,
      provider: 'Praxis Dr. Huber',
      invoiceNumber: 'RE-1',
      invoiceDate: '2026-03-12',
      amount: 8940,
      currency: 'EUR',
      description: '',
      hasPdf: false,
      extractionStatus: null,
      extraction: null,
      submittedAt: null,
      paidAt: null,
      entries: [],
      documents: [],
      createdAt: now,
      updatedAt: now,
      ...partial,
    });
  }

  /**
   * What the real API does with one save: the reimbursement change against the history (one entry),
   * the documents, then the claim itself. Returns an error code, or null when it was saved.
   */
  function applySave(
    claim: MockClaim,
    save:
      | ReturnType<typeof saveClaimRequestSchema.parse>
      | ReturnType<typeof createClaimRequestSchema.parse>,
  ): string | null {
    const plan = planReimbursementChange(save.amount, claim.entries, save.reimbursement);
    if (!plan.ok) return plan.problem;
    if (save.removedDocumentIds.some((id) => !claim.documents.some((d) => d.documentId === id))) {
      return 'document_not_found';
    }
    if (save.newDocuments.some((d) => !api.stagedUploads.has(d.uploadId))) return 'upload_missing';

    const stamp = new Date(Date.now() + ++counter).toISOString();
    if (plan.entry) {
      claim.entries.push({ entryId: newId(), ...plan.entry, createdAt: stamp });
    }
    claim.documents = [
      ...claim.documents.filter((d) => !save.removedDocumentIds.includes(d.documentId)),
      ...save.newDocuments.map((d) => ({
        documentId: d.uploadId,
        fileName: d.fileName,
        contentType: api.stagedUploads.get(d.uploadId) as InsurerDocument['contentType'],
        size: 1000,
        uploadedAt: stamp,
      })),
    ];
    Object.assign(claim, {
      status: 'OPEN',
      year: Number(save.invoiceDate.slice(0, 4)),
      provider: save.provider,
      invoiceNumber: save.invoiceNumber,
      invoiceDate: save.invoiceDate,
      amount: save.amount,
      description: save.description,
      submittedAt: save.submittedAt,
      paidAt: save.paid ? save.paidAt : null,
      extractionStatus: claim.extractionStatus === 'PENDING' ? 'FAILED' : claim.extractionStatus,
      updatedAt: stamp,
    });
    return null;
  }

  await page.route('**/config.json', (route) =>
    json(route, {
      region: 'eu-central-1',
      apiUrl: 'http://localhost:4300/mock-api',
      userPoolId: 'eu-central-1_test',
      clientId: 'test-client',
      authority: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_test',
      hostedUiUrl: 'https://test.auth.eu-central-1.amazoncognito.com',
    }),
  );

  const saved = (year: number) => api.claims.filter((c) => c.status === 'OPEN' && c.year === year);

  await page.route('**/mock-s3', async (route) => {
    api.requests.push('POST /mock-s3');
    api.uploadedFiles += 1;
    // The browser sent the presigned fields and the file; S3 answers 204.
    await route.fulfill({ status: 204 });
  });

  // On the context: the document opens in a new tab, which page routes do not cover.
  await page.context().route('**/mock-document.pdf*', (route) => {
    api.openedDocuments.push(new URL(route.request().url()).searchParams.get('doc') ?? '');
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
  });

  await page.route('**/mock.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }),
  );

  await page.route('**/mock-api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/mock-api', '');
    const method = request.method();
    api.requests.push(`${method} ${path}${url.search}`);
    const body = request.postData() ? JSON.parse(request.postData() as string) : undefined;

    if (method === 'GET' && path === '/persons') return json(route, { persons: api.persons });

    if (method === 'PUT' && /^\/persons\/[^/]+$/.test(path)) {
      const person = api.persons.find((p) => p.personId === path.split('/')[2]);
      if (!person) return json(route, { error: { code: 'not_found' } }, 404);
      person.name = body.name;
      if (body.deductible !== undefined) person.deductible = body.deductible;
      return json(route, person);
    }

    if (method === 'GET' && path === '/dashboard') {
      const year = Number(url.searchParams.get('year'));
      const years = [
        ...new Set(api.claims.filter((c) => c.status === 'OPEN').map((c) => c.year as number)),
      ].sort((a, b) => b - a);
      return json(route, {
        year,
        years,
        persons: api.persons.map((p) => {
          const list = saved(year).filter((c) => c.personId === p.personId);
          const totals = list.map((c) => toApi(c).reimbursement);
          const sum = (pick: (t: (typeof totals)[number]) => number) =>
            totals.reduce((acc, t) => acc + pick(t), 0);
          return {
            ...p,
            count: list.length,
            totalAmount: list.reduce((acc, c) => acc + (c.amount ?? 0), 0),
            reimbursedAmount: sum((t) => t.reimbursed),
            outstandingAmount: sum((t) => t.outstanding),
            selfBorneAmount: sum((t) => t.selfBorne),
          };
        }),
      });
    }

    const personClaims = /^\/persons\/([^/]+)\/claims$/.exec(path);
    if (method === 'GET' && personClaims) {
      const year = Number(url.searchParams.get('year'));
      const claims = saved(year)
        .filter((c) => c.personId === personClaims[1])
        .sort((a, b) => (b.invoiceDate ?? '').localeCompare(a.invoiceDate ?? ''));
      return json(route, { claims: claims.map(toApi) });
    }

    if (method === 'POST' && path === '/uploads') {
      const claim: MockClaim = {
        claimId: newId(),
        personId: body.personId,
        status: 'DRAFT',
        source: 'EXTRACTED',
        year: null,
        provider: null,
        invoiceNumber: null,
        invoiceDate: null,
        amount: null,
        currency: 'EUR',
        description: null,
        hasPdf: true,
        extractionStatus: 'PENDING',
        extraction: null,
        submittedAt: null,
        paidAt: null,
        entries: [],
        documents: [],
        createdAt: now,
        updatedAt: now,
      };
      api.claims.push(claim);
      return json(
        route,
        {
          claim: toApi(claim),
          upload: {
            url: 'http://localhost:4300/mock-s3',
            fields: { key: `uploads/u/${claim.claimId}.pdf` },
          },
        },
        201,
      );
    }

    if (method === 'POST' && path === '/document-uploads') {
      const uploadId = newId();
      api.stagedUploads.set(uploadId, body.contentType);
      return json(
        route,
        {
          uploadId,
          upload: {
            url: 'http://localhost:4300/mock-s3',
            fields: { key: `incoming/u/${uploadId}`, 'Content-Type': body.contentType },
          },
        },
        201,
      );
    }

    if (method === 'POST' && path === '/claims') {
      const parsed = createClaimRequestSchema.safeParse(body);
      if (!parsed.success) return json(route, { error: { code: 'validation_failed' } }, 400);
      const claim: MockClaim = {
        claimId: newId(),
        personId: parsed.data.personId,
        status: 'OPEN',
        source: 'MANUAL',
        year: null,
        provider: null,
        invoiceNumber: null,
        invoiceDate: null,
        amount: null,
        currency: 'EUR',
        description: null,
        hasPdf: false,
        extractionStatus: null,
        extraction: null,
        submittedAt: null,
        paidAt: null,
        entries: [],
        documents: [],
        createdAt: now,
        updatedAt: now,
      };
      const error = applySave(claim, parsed.data);
      if (error) return json(route, { error: { code: error } }, 400);
      api.claims.push(claim);
      return json(route, toApi(claim), 201);
    }

    const documentUrl = /^\/claims\/([^/]+)\/documents\/([^/]+)\/url$/.exec(path);
    if (method === 'GET' && documentUrl) {
      const owner = api.claims.find((c) => c.claimId === documentUrl[1]);
      if (!owner?.documents.some((d) => d.documentId === documentUrl[2])) {
        return json(route, { error: { code: 'document_not_found' } }, 404);
      }
      return json(route, {
        url: `http://localhost:4300/mock-document.pdf?doc=${documentUrl[2]}`,
        expiresIn: 60,
      });
    }

    const single = /^\/claims\/([^/]+)$/.exec(path);
    const claim = single ? api.claims.find((c) => c.claimId === single[1]) : undefined;
    if (single && !claim) return json(route, { error: { code: 'not_found' } }, 404);

    if (method === 'GET' && claim) {
      // The first poll still reads "PENDING", the second one has the result.
      if (
        claim.extractionStatus === 'PENDING' &&
        api.requests.filter((r) => r === `GET ${path}`).length >= 2
      ) {
        if (api.extraction === 'DONE') {
          Object.assign(claim, {
            extractionStatus: 'DONE',
            provider: 'Praxis Dr. Huber',
            invoiceDate: '2026-03-12',
            amount: 8940,
            year: 2026,
            extraction: { confidence: { provider: 98, invoiceDate: 97, amount: 93 } },
          });
        } else {
          claim.extractionStatus = 'FAILED';
        }
      }
      return json(route, {
        ...toApi(claim),
        pdfUrl: claim.hasPdf ? 'http://localhost:4300/mock.pdf' : null,
      });
    }

    if (method === 'PUT' && claim) {
      const parsed = saveClaimRequestSchema.safeParse(body);
      if (!parsed.success) return json(route, { error: { code: 'validation_failed' } }, 400);
      if (parsed.data.version !== claim.updatedAt) {
        return json(route, { error: { code: 'conflict' } }, 409);
      }
      const error = applySave(claim, parsed.data);
      if (error) return json(route, { error: { code: error } }, 400);
      return json(route, toApi(claim));
    }

    if (method === 'DELETE' && claim) {
      api.claims.splice(api.claims.indexOf(claim), 1);
      return route.fulfill({ status: 204 });
    }

    return json(route, { error: { code: 'not_found' } }, 404);
  });

  return api;
}

/** Signs in without the redirect flow by setting the fake session before the app boots. */
export async function signedIn(page: Page): Promise<void> {
  await page.addInitScript(() => sessionStorage.setItem('fake.auth', '1'));
}

/** A tiny but valid PDF for the file chooser. */
export const PDF = {
  name: 'Rechnung_Huber_2026-03.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF'),
};
