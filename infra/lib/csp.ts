/**
 * Content Security Policy of the frontend.
 *
 * The hosts are region wildcards on purpose. The CloudFront distribution is created first
 * (the other stacks need its domain), so the API, Cognito and bucket hostnames do not exist yet.
 * They are still limited to this region and to the services the app talks to.
 */
export function buildCsp(region: string, scriptHashes: string[]): string {
  const apiHost = `https://*.execute-api.${region}.amazonaws.com`;
  const cognitoIdp = `https://cognito-idp.${region}.amazonaws.com`;
  const cognitoHosted = `https://*.auth.${region}.amazoncognito.com`;
  const s3Host = `https://*.s3.${region}.amazonaws.com`;
  const hashes = scriptHashes.map((h) => `'${h}'`).join(' ');

  return [
    `default-src 'self'`,
    `script-src 'self'${hashes ? ` ${hashes}` : ''}`,
    // Angular writes component styles inline at runtime.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self' ${apiHost} ${cognitoIdp} ${cognitoHosted} ${s3Host}`,
    `frame-src ${s3Host}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}
