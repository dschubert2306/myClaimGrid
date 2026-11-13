import { Injectable } from '@angular/core';
import { AuthService } from '../app/core/auth/auth.service';
import { CALLBACK_PATH, LOGIN_PATH } from '../app/core/auth/paths';

const SIGNED_IN = 'fake.auth';
const MODE = 'fake.mode'; // 'error' makes the sign-in fail, 'hang' stays on the page and counts the calls
const LOGIN_CALLS = 'fake.loginCalls';
const SIGNED_OUT_FLAG = 'mcg.signedOut';

/**
 * Stand-in for Cognito in the end to end tests. It reproduces the page flow of the real thing
 * (full redirects to /auth/callback and /login) with the state kept in sessionStorage.
 */
@Injectable()
export class FakeAuthService extends AuthService {
  private signedIn = false;
  private initPromise?: Promise<boolean>;

  override init(): Promise<boolean> {
    this.initPromise ??= Promise.resolve().then(() => {
      if (
        location.pathname === CALLBACK_PATH &&
        new URLSearchParams(location.search).get('code') === 'fake-code'
      ) {
        sessionStorage.setItem(SIGNED_IN, '1');
      }
      return (this.signedIn = sessionStorage.getItem(SIGNED_IN) === '1');
    });
    return this.initPromise;
  }

  override isAuthenticated(): boolean {
    return this.signedIn;
  }

  override login(): void {
    const mode = sessionStorage.getItem(MODE);
    if (mode === 'hang') {
      sessionStorage.setItem(
        LOGIN_CALLS,
        String(Number(sessionStorage.getItem(LOGIN_CALLS) ?? 0) + 1),
      );
      return;
    }
    const failing = mode === 'error';
    location.assign(`${CALLBACK_PATH}?${failing ? 'error=access_denied' : 'code=fake-code'}`);
  }

  override logout(): void {
    sessionStorage.removeItem(SIGNED_IN);
    sessionStorage.setItem(SIGNED_OUT_FLAG, '1');
    location.assign(LOGIN_PATH);
  }
}
