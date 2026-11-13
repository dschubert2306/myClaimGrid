import { LogLevel, type OpenIdConfiguration } from 'angular-auth-oidc-client';
import type { AppConfig } from '../config.service';

import { CALLBACK_PATH, LOGIN_PATH } from './paths';

/**
 * Maps the deploy time config to the OIDC library. The Cognito endpoints are given explicitly:
 * the discovery document of a user pool has no end session endpoint, and the hosted UI needs
 * `client_id` and `logout_uri` to sign out.
 */
export function toOidcConfig(config: AppConfig, origin: string): OpenIdConfiguration {
  const hosted = config.hostedUiUrl.replace(/\/$/, '');
  return {
    authority: config.authority,
    authWellknownEndpoints: {
      issuer: config.authority,
      jwksUri: `${config.authority}/.well-known/jwks.json`,
      authorizationEndpoint: `${hosted}/oauth2/authorize`,
      tokenEndpoint: `${hosted}/oauth2/token`,
      userInfoEndpoint: `${hosted}/oauth2/userInfo`,
      endSessionEndpoint: `${hosted}/logout`,
      revocationEndpoint: `${hosted}/oauth2/revoke`,
    },
    redirectUrl: `${origin}${CALLBACK_PATH}`,
    postLogoutRedirectUri: `${origin}${LOGIN_PATH}`,
    clientId: config.clientId,
    scope: 'openid email profile',
    responseType: 'code',
    silentRenew: true,
    useRefreshToken: true,
    renewTimeBeforeTokenExpiresInSeconds: 60,
    ignoreNonceAfterRefresh: true, // Cognito leaves the nonce out of refreshed ID tokens
    autoUserInfo: false,
    secureRoutes: [config.apiUrl],
    customParamsEndSessionRequest: {
      client_id: config.clientId,
      logout_uri: `${origin}${LOGIN_PATH}`,
    },
    logLevel: LogLevel.Error,
  };
}
