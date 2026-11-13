import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { idSchema } from '@myclaimgrid/shared';
import { ZodError, type ZodType, type z } from 'zod';
import { log } from './log';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface Reply {
  status: number;
  body?: unknown;
}
export const ok = (body: unknown): Reply => ({ status: 200, body });
export const created = (body: unknown): Reply => ({ status: 201, body });
export const noContent = (): Reply => ({ status: 204 });

export interface Request {
  sub: string;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  rawBody: string | undefined;
}

export type RouteHandler = (req: Request) => Promise<Reply>;
export type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/** Path parameter that must be a UUID. Anything else is treated as not found. */
export function idParam(req: Request, name: string): string {
  const parsed = idSchema.safeParse(req.params[name]);
  if (!parsed.success) throw new HttpError(404, 'not_found');
  return parsed.data;
}

export function parseBody<S extends ZodType>(req: Request, schema: S): z.output<S> {
  if (req.rawBody === undefined || req.rawBody === '') throw new HttpError(400, 'body_required');
  let json: unknown;
  try {
    json = JSON.parse(req.rawBody);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  return schema.parse(json);
}

export function parseQuery<S extends ZodType>(req: Request, schema: S): z.output<S> {
  return schema.parse(req.query);
}

function toResult(reply: Reply): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: reply.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: reply.body === undefined ? undefined : JSON.stringify(reply.body),
  };
}

function errorReply(status: number, code: string, issues?: { path: string; message: string }[]) {
  return toResult({ status, body: { error: { code, ...(issues ? { issues } : {}) } } });
}

/** Routes by `routeKey` (for example "GET /claims/{id}"), maps errors to JSON responses. */
export function createHandler(routes: Record<string, RouteHandler>) {
  return async (event: Event): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
      if (typeof sub !== 'string' || sub === '') throw new HttpError(401, 'unauthorized');
      const handler = routes[event.routeKey];
      if (!handler) throw new HttpError(404, 'not_found');

      const rawBody =
        event.body !== undefined && event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body;
      const reply = await handler({
        sub,
        params: event.pathParameters ?? {},
        query: event.queryStringParameters ?? {},
        rawBody,
      });
      return toResult(reply);
    } catch (error) {
      if (error instanceof HttpError) return errorReply(error.status, error.code);
      if (error instanceof ZodError) {
        return errorReply(
          400,
          'validation_failed',
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        );
      }
      const name = error instanceof Error ? error.name : 'Unknown';
      if (name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException') {
        log('warn', 'conflicting write', { route: event.routeKey, errorName: name });
        return errorReply(409, 'conflict');
      }
      // Never log the message or the event, they may contain invoice data.
      log('error', 'unhandled error', { route: event.routeKey, errorName: name });
      return errorReply(500, 'internal_error');
    }
  };
}
