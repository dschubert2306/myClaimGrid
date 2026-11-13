import { beforeEach, describe, expect, it } from 'vitest';
import { handler as claimsHandler } from '../src/handlers/claims';
import { handler as dashboardHandler } from '../src/handlers/dashboard';
import { handler as personsHandler } from '../src/handlers/persons';
import { apiEvent, json } from './helpers/events';
import { fakeDynamo } from './helpers/dynamo';

let persons: { personId: string }[];

async function addClaim(personIndex: number, invoiceDate: string, amount: number) {
  const result = await claimsHandler(
    apiEvent('POST /claims', {
      body: { personId: persons[personIndex]?.personId, provider: 'Praxis', invoiceDate, amount },
    }),
  );
  expect(result.statusCode).toBe(201);
}

beforeEach(async () => {
  fakeDynamo();
  persons = json(await personsHandler(apiEvent('GET /persons'))).persons;
});

describe('GET /dashboard', () => {
  it('sums count and amount per person for the selected year only', async () => {
    await addClaim(0, '2026-01-10', 10000);
    await addClaim(0, '2026-12-31', 5050);
    await addClaim(0, '2025-06-01', 99999);
    await addClaim(1, '2026-03-03', 2500);

    const result = await dashboardHandler(apiEvent('GET /dashboard', { query: { year: '2026' } }));
    const body = json(result);
    expect(body.year).toBe(2026);
    expect(
      body.persons.map((p: { count: number; totalAmount: number }) => [p.count, p.totalAmount]),
    ).toEqual([
      [2, 15050],
      [1, 2500],
      [0, 0],
    ]);
  });

  it('lists the years with data, newest first, across persons', async () => {
    await addClaim(0, '2024-02-01', 100);
    await addClaim(1, '2026-02-01', 100);
    await addClaim(2, '2024-05-01', 100);
    await claimsHandler(apiEvent('POST /uploads', { body: { personId: persons[0]?.personId } }));

    const body = json(
      await dashboardHandler(apiEvent('GET /dashboard', { query: { year: '2026' } })),
    );
    expect(body.years).toEqual([2026, 2024]);
  });

  it('defaults to the current year and rejects invalid years', async () => {
    const body = json(await dashboardHandler(apiEvent('GET /dashboard')));
    expect(body.year).toBe(new Date().getUTCFullYear());
    expect(
      (await dashboardHandler(apiEvent('GET /dashboard', { query: { year: 'abc' } }))).statusCode,
    ).toBe(400);
  });
});
