import type { EnvironmentProviders, Provider } from '@angular/core';

import {
  StsConfigHttpLoader,
  StsConfigLoader,
  authInterceptor,
  provideAuth,
} from 'angular-auth-oidc-client';
import { map } from 'rxjs';
import { ConfigService } from '../config.service';
import { AuthService } from './auth.service';
import { OidcAuthService } from './oidc-auth.service';
import { toOidcConfig } from './oidc-config';

/**
 * Real authentication with Cognito. The end to end build replaces this file with
 * src/testing/auth-providers.e2e.ts (angular.json, configuration "e2e").
 */
export function provideAuthentication(): (Provider | EnvironmentProviders)[] {
  return [
    provideAuth({
      loader: {
        provide: StsConfigLoader,
        useFactory: (config: ConfigService) =>
          new StsConfigHttpLoader(
            config.config$.pipe(map((c) => toOidcConfig(c, window.location.origin))),
          ),
        deps: [ConfigService],
      },
    }),
    { provide: AuthService, useClass: OidcAuthService },
  ];
}

/** Adds the access token to calls to the API (the secure routes of the OIDC config). */
export const authHttpInterceptors = [authInterceptor()];
