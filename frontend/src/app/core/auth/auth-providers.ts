import type { HttpInterceptorFn } from '@angular/common/http';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { ConfigService } from '../config.service';
import { AuthService } from './auth.service';
import { CognitoAuthService } from './cognito-auth.service';

/**
 * Real authentication with Cognito. The end to end build replaces this file with
 * src/testing/auth-providers.e2e.ts (angular.json, configuration "e2e").
 */
export function provideAuthentication(): (Provider | EnvironmentProviders)[] {
  return [{ provide: AuthService, useClass: CognitoAuthService }];
}

/** Adds the access token to calls to the API. Other hosts (S3) never get it. */
const bearerInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService) as CognitoAuthService;
  return inject(ConfigService).config$.pipe(
    switchMap((config) => {
      if (!request.url.startsWith(config.apiUrl)) return next(request);
      return from(auth.accessToken()).pipe(
        switchMap((token) =>
          next(
            token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request,
          ),
        ),
      );
    }),
  );
};

export const authHttpInterceptors = [bearerInterceptor];
