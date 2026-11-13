import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

type Item = Record<string, unknown>;

function awsError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/**
 * Minimal in-memory DynamoDB behind the DocumentClient. It supports exactly the access
 * patterns and condition expressions that the repository uses and fails loudly otherwise.
 */
export function fakeDynamo() {
  const store = new Map<string, Item>();
  const key = (pk: unknown, sk: unknown) => `${String(pk)}\u0000${String(sk)}`;
  const mock = mockClient(DynamoDBDocumentClient);

  function checkCondition(
    condition: string | undefined,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
    existing: Item | undefined,
    failure: string,
  ): void {
    if (!condition) return;
    for (const raw of condition.split(' AND ')) {
      const clause = raw.trim();
      if (clause === 'attribute_exists(pk)') {
        if (!existing) throw awsError(failure);
      } else if (clause === 'attribute_not_exists(pk)') {
        if (existing) throw awsError(failure);
      } else {
        const match = /^(#?\w+) = (:\w+)$/.exec(clause);
        if (!match) throw new Error(`Unsupported condition: ${clause}`);
        const attribute = names?.[match[1] as string] ?? (match[1] as string);
        if (!existing || existing[attribute] !== values?.[match[2] as string]) {
          throw awsError(failure);
        }
      }
    }
  }

  mock.on(PutCommand).callsFake((input) => {
    const item = input.Item as Item;
    const k = key(item.pk, item.sk);
    checkCondition(
      input.ConditionExpression,
      input.ExpressionAttributeNames,
      input.ExpressionAttributeValues,
      store.get(k),
      'ConditionalCheckFailedException',
    );
    store.set(k, structuredClone(item));
    return {};
  });

  mock.on(GetCommand).callsFake((input) => {
    const item = store.get(key(input.Key?.pk, input.Key?.sk));
    return { Item: item ? structuredClone(item) : undefined };
  });

  mock.on(DeleteCommand).callsFake((input) => {
    store.delete(key(input.Key?.pk, input.Key?.sk));
    return {};
  });

  mock.on(TransactWriteCommand).callsFake((input) => {
    const items = input.TransactItems ?? [];
    for (const entry of items) {
      if (entry.Delete) {
        const k = key(entry.Delete.Key?.pk, entry.Delete.Key?.sk);
        checkCondition(
          entry.Delete.ConditionExpression,
          undefined,
          undefined,
          store.get(k),
          'TransactionCanceledException',
        );
      }
      if (entry.Put) {
        const item = entry.Put.Item as Item;
        checkCondition(
          entry.Put.ConditionExpression,
          undefined,
          undefined,
          store.get(key(item.pk, item.sk)),
          'TransactionCanceledException',
        );
      }
    }
    for (const entry of items) {
      if (entry.Delete) store.delete(key(entry.Delete.Key?.pk, entry.Delete.Key?.sk));
      if (entry.Put) {
        const item = entry.Put.Item as Item;
        store.set(key(item.pk, item.sk), structuredClone(item));
      }
    }
    return {};
  });

  mock.on(QueryCommand).callsFake((input) => {
    const values = input.ExpressionAttributeValues ?? {};
    const expr = input.KeyConditionExpression ?? '';
    let rows: Item[];

    if (input.IndexName === 'byClaimId') {
      rows = [...store.values()].filter((i) => i.gsi1pk === values[':g']);
    } else {
      rows = [...store.values()].filter((i) => i.pk === values[':pk']);
      if (expr.includes('BETWEEN')) {
        rows = rows.filter(
          (i) => String(i.sk) >= String(values[':from']) && String(i.sk) <= String(values[':to']),
        );
      } else if (expr.includes('begins_with')) {
        rows = rows.filter((i) => String(i.sk).startsWith(String(values[':prefix'])));
      } else if (expr !== 'pk = :pk') {
        throw new Error(`Unsupported key condition: ${expr}`);
      }
      rows.sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
      if (input.ScanIndexForward === false) rows.reverse();
    }
    if (input.Limit) rows = rows.slice(0, input.Limit);
    if (input.ProjectionExpression === 'sk') rows = rows.map((i) => ({ sk: i.sk }));
    return { Items: structuredClone(rows) };
  });

  return {
    mock,
    items: () => [...store.values()],
    find: (predicate: (item: Item) => boolean) => [...store.values()].find(predicate),
    seed: (item: Item) => void store.set(key(item.pk, item.sk), structuredClone(item)),
  };
}
