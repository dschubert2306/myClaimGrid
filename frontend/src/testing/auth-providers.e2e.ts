import type { EnvironmentProviders, Provider } from '@angular/core';
import { AuthService } from '../app/core/auth/auth.service';
import { FakeAuthService } from './fake-auth.service';

/** Replaces src/app/core/auth/auth-providers.ts in the "e2e" build configuration. */
export function provideAuthentication(): (Provider | EnvironmentProviders)[] {
  return [{ provide: AuthService, useClass: FakeAuthService }];
}

export const authHttpInterceptors = [];
