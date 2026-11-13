import { beforeEach, describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/persons';
import { apiEvent, json } from './helpers/events';
import { fakeDynamo } from './helpers/dynamo';

let db: ReturnType<typeof fakeDynamo>;
beforeEach(() => {
  db = fakeDynamo();
});

describe('persons', () => {
  it('seeds three persons on first use and is idempotent', async () => {
    const first = json(await handler(apiEvent('GET /persons')));
    const second = json(await handler(apiEvent('GET /persons')));
    expect(first.persons).toHaveLength(3);
    expect(first.persons.map((p: { color: string }) => p.color)).toEqual([
      'person-1',
      'person-2',
      'person-3',
    ]);
    expect(second).toEqual(first);
    expect(db.items()).toHaveLength(3);
  });

  it('keeps the persons of different users apart', async () => {
    const a = json(await handler(apiEvent('GET /persons', { sub: 'a' })));
    const b = json(await handler(apiEvent('GET /persons', { sub: 'b' })));
    expect(a.persons[0].personId).not.toBe(b.persons[0].personId);
  });

  it('renames a person', async () => {
    const { persons } = json(await handler(apiEvent('GET /persons')));
    const result = await handler(
      apiEvent('PUT /persons/{id}', {
        pathParameters: { id: persons[0].personId },
        body: { name: '  Anna  ' },
      }),
    );
    expect(result).toMatchObject({ statusCode: 200 });
    expect(json(result)).toMatchObject({ name: 'Anna', color: 'person-1' });
  });

  it('stores the Selbstbehalt in cents and keeps it when only the name changes', async () => {
    const { persons } = json(await handler(apiEvent('GET /persons')));
    expect(persons[0].deductible).toBe(0);
    const put = (body: unknown) =>
      handler(apiEvent('PUT /persons/{id}', { pathParameters: { id: persons[0].personId }, body }));
    expect(json(await put({ name: 'Anna', deductible: 50000 }))).toMatchObject({
      deductible: 50000,
    });
    expect(json(await put({ name: 'Anna B.' }))).toMatchObject({
      name: 'Anna B.',
      deductible: 50000,
    });
    expect(json(await put({ name: 'Anna B.', deductible: 0 }))).toMatchObject({ deductible: 0 });
    for (const bad of [-1, 1.5, 'x', 100_000_01]) {
      expect(await put({ name: 'Anna', deductible: bad })).toMatchObject({ statusCode: 400 });
    }
  });

  it('returns 404 for a person of another user and 400 for an empty name', async () => {
    const { persons } = json(await handler(apiEvent('GET /persons', { sub: 'other' })));
    const foreign = await handler(
      apiEvent('PUT /persons/{id}', {
        pathParameters: { id: persons[0].personId },
        body: { name: 'X' },
      }),
    );
    expect(foreign).toMatchObject({ statusCode: 404 });

    const { persons: own } = json(await handler(apiEvent('GET /persons')));
    const empty = await handler(
      apiEvent('PUT /persons/{id}', {
        pathParameters: { id: own[0].personId },
        body: { name: ' ' },
      }),
    );
    expect(empty).toMatchObject({ statusCode: 400 });
  });

  it('rejects requests without a user', async () => {
    expect(await handler(apiEvent('GET /persons', { sub: null }))).toMatchObject({
      statusCode: 401,
    });
  });
});
