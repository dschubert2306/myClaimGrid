import { describe, expect, it } from 'vitest';
import { toOidcConfig } from './oidc-config';
import { sanitizeReturnTo } from './return-to';

describe('sanitizeReturnTo', () => {
  it('keeps in-app paths', () => {
    expect(sanitizeReturnTo('/')).toBe('/');
    expect(sanitizeReturnTo('/?year=2025')).toBe('/?year=2025');
  });

  it('never redirects to another site or back into the login flow', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/login',
      '/login?notice=error',
      '/auth/callback?code=x',
      '',
      null,
      undefined,
    ]) {
      expect(sanitizeReturnTo(value)).toBe('/');
    }
  });
});

describe('toOidcConfig', () => {
  const config = toOidcConfig(
    {
      region: 'eu-central-1',
      apiUrl: 'https://api.example.test',
      userPoolId: 'eu-central-1_abc',
      clientId: 'client-1',
      authority: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc',
      hostedUiUrl: 'https://mcg.auth.eu-central-1.amazoncognito.com/',
    },
    'https://app.example.test',
  );

  it('uses the authorization code flow with PKCE (code, no secret) and the refresh token', () => {
    expect(config.responseType).toBe('code');
    expect(config.useRefreshToken).toBe(true);
    expect(config.clientId).toBe('client-1');
  });

  it('matches the routes registered in the Cognito app client', () => {
    expect(config.redirectUrl).toBe('https://app.example.test/auth/callback');
    expect(config.postLogoutRedirectUri).toBe('https://app.example.test/login');
    expect(config.customParamsEndSessionRequest).toEqual({
      client_id: 'client-1',
      logout_uri: 'https://app.example.test/login',
    });
  });

  it('points the endpoints at the hosted UI and sends the token only to the API', () => {
    expect(config.authWellknownEndpoints?.authorizationEndpoint).toBe(
      'https://mcg.auth.eu-central-1.amazoncognito.com/oauth2/authorize',
    );
    expect(config.authWellknownEndpoints?.endSessionEndpoint).toBe(
      'https://mcg.auth.eu-central-1.amazoncognito.com/logout',
    );
    expect(config.secureRoutes).toEqual(['https://api.example.test']);
  });
});
