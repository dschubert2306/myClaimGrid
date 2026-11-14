import { createHash } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { ClaimFields, PersonColor } from '@myclaimgrid/shared';
import { ddb } from './aws';
import { GSI_BY_CLAIM_ID, config } from './config';
import { type ClaimItem, type EntryItem, type PersonItem, yearOf } from './items';
import {
  ALL_YEARS_RANGE,
  claimGsiKey,
  datedSk,
  personPk,
  personSk,
  userPk,
  yearRange,
} from './keys';

const DEFAULT_COLORS: PersonColor[] = ['person-1', 'person-2', 'person-3'];

/** Stable UUID per user and slot, so concurrent first calls create the same three persons. */
export function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A timestamp later than `previous`, even within the same millisecond. `updatedAt` doubles as the
 * version for optimistic locking, so every write must change it.
 */
export function nextTimestamp(previous: string): string {
  const now = Date.now();
  const last = Date.parse(previous);
  return new Date(Number.isNaN(last) ? now : Math.max(now, last + 1)).toISOString();
}

async function queryAll<T>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let startKey: QueryCommandInput['ExclusiveStartKey'];
  do {
    const out = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...((out.Items ?? []) as T[]));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

// ---------------------------------------------------------------- persons

export async function listPersons(sub: string): Promise<PersonItem[]> {
  return queryAll<PersonItem>({
    TableName: config.tableName,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':pk': userPk(sub), ':prefix': 'PERSON#' },
  });
}

/** Lists the persons of a user and creates the three default ones on first use. Idempotent. */
export async function ensurePersons(sub: string): Promise<PersonItem[]> {
  const existing = await listPersons(sub);
  if (existing.length > 0) return existing;

  const now = new Date().toISOString();
  const created: PersonItem[] = DEFAULT_COLORS.map((color, index) => {
    const personId = deterministicUuid(`${sub}:person:${index + 1}`);
    return {
      pk: userPk(sub),
      sk: personSk(personId),
      entity: 'PERSON',
      personId,
      name: `Person ${index + 1}`,
      color,
      deductible: 0,
      createdAt: now,
    };
  });
  for (const item of created) {
    try {
      await ddb.send(
        new PutCommand({
          TableName: config.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (error) {
      if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
    }
  }
  return listPersons(sub);
}

export async function getPerson(sub: string, personId: string): Promise<PersonItem | undefined> {
  const out = await ddb.send(
    new GetCommand({
      TableName: config.tableName,
      Key: { pk: userPk(sub), sk: personSk(personId) },
    }),
  );
  return out.Item as PersonItem | undefined;
}

export async function savePerson(item: PersonItem): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: config.tableName,
      Item: item,
      ConditionExpression: 'attribute_exists(pk)',
    }),
  );
}

// ----------------------------------------------------------------- claims

export async function getClaimById(claimId: string): Promise<ClaimItem | undefined> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: config.tableName,
      IndexName: GSI_BY_CLAIM_ID,
      KeyConditionExpression: 'gsi1pk = :g',
      ExpressionAttributeValues: { ':g': claimGsiKey(claimId) },
      Limit: 1,
    }),
  );
  return out.Items?.[0] as ClaimItem | undefined;
}

export async function createClaim(item: ClaimItem): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: config.tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
}

/**
 * Stores the corrected fields and sets the status to OPEN. A draft has no invoice date and
 * therefore a different sort key, so the item is moved in one transaction. The same happens
 * when the invoice date changes later.
 */
export async function saveClaim(existing: ClaimItem, fields: ClaimFields): Promise<ClaimItem> {
  const updated: ClaimItem = {
    ...existing,
    sk: datedSk(fields.invoiceDate, existing.claimId),
    status: 'OPEN',
    year: yearOf(fields.invoiceDate),
    provider: fields.provider,
    invoiceNumber: fields.invoiceNumber,
    invoiceDate: fields.invoiceDate,
    amount: fields.amount,
    description: fields.description,
    // Absent in the request means "keep", null clears the date.
    submittedAt:
      fields.submittedAt === undefined ? (existing.submittedAt ?? null) : fields.submittedAt,
    paidAt: fields.paidAt === undefined ? (existing.paidAt ?? null) : fields.paidAt,
    // Results that arrive after the user saved are discarded, so do not stay PENDING.
    extractionStatus:
      existing.extractionStatus === 'PENDING' ? 'FAILED' : existing.extractionStatus,
    updatedAt: nextTimestamp(existing.updatedAt),
  };

  if (updated.sk === existing.sk) {
    await ddb.send(
      new PutCommand({
        TableName: config.tableName,
        Item: updated,
        ConditionExpression: 'attribute_exists(pk)',
      }),
    );
  } else {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: config.tableName,
              Key: { pk: existing.pk, sk: existing.sk },
              ConditionExpression: 'attribute_exists(pk)',
            },
          },
          {
            Put: {
              TableName: config.tableName,
              Item: updated,
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      }),
    );
  }
  return updated;
}

/**
 * Replaces the reimbursement history. Optimistic locking on `updatedAt`: if the claim changed since
 * it was read (another tab, a save that moved it to a new sort key), the write fails with a conflict.
 */
export async function saveEntries(existing: ClaimItem, entries: EntryItem[]): Promise<ClaimItem> {
  const updated: ClaimItem = {
    ...existing,
    reimbursementEntries: entries,
    updatedAt: nextTimestamp(existing.updatedAt),
  };
  await ddb.send(
    new PutCommand({
      TableName: config.tableName,
      Item: updated,
      ConditionExpression: 'attribute_exists(pk) AND updatedAt = :prev',
      ExpressionAttributeValues: { ':prev': existing.updatedAt },
    }),
  );
  return updated;
}

export async function deleteClaim(item: ClaimItem): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: config.tableName, Key: { pk: item.pk, sk: item.sk } }),
  );
}

/** Writes the extraction result, only while the claim is still a draft waiting for it. */
export async function storeExtractionResult(item: ClaimItem): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: config.tableName,
      Item: item,
      ConditionExpression:
        'attribute_exists(pk) AND #status = :draft AND extractionStatus = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':draft': 'DRAFT', ':pending': 'PENDING' },
    }),
  );
}

export async function listClaims(personId: string, year: number): Promise<ClaimItem[]> {
  const { from, to } = yearRange(year);
  return queryAll<ClaimItem>({
    TableName: config.tableName,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
    ExpressionAttributeValues: { ':pk': personPk(personId), ':from': from, ':to': to },
    ScanIndexForward: false,
  });
}

export async function listClaimYears(personId: string): Promise<number[]> {
  const items = await queryAll<{ sk: string }>({
    TableName: config.tableName,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
    ExpressionAttributeValues: {
      ':pk': personPk(personId),
      ':from': ALL_YEARS_RANGE.from,
      ':to': ALL_YEARS_RANGE.to,
    },
    ProjectionExpression: 'sk',
  });
  return [...new Set(items.map((i) => Number(i.sk.slice('CLAIM#'.length, 'CLAIM#'.length + 4))))];
}
