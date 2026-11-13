import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export function apiEvent(
  routeKey: string,
  options: {
    sub?: string | null;
    body?: unknown;
    pathParameters?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const sub = options.sub === undefined ? 'user-1' : options.sub;
  return {
    version: '2.0',
    routeKey,
    rawPath: '/',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    pathParameters: options.pathParameters,
    queryStringParameters: options.query,
    requestContext: {
      authorizer: sub === null ? undefined : { jwt: { claims: { sub }, scopes: [] } },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper, shape checked by assertions
export function json(result: { body?: string }): any {
  return result.body ? JSON.parse(result.body) : undefined;
}
