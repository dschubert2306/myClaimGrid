import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService, type SignInStep } from '../app/core/auth/auth.service';
import { AuthError } from '../app/core/auth/auth-error';
import { LOGIN_PATH } from '../app/core/auth/paths';

const SIGNED_IN = 'fake.auth';
const MODE = 'fake.mode'; // 'hang' never answers the sign-in and counts the calls
const SIGN_IN_CALLS = 'fake.signInCalls';
const SIGNED_OUT_FLAG = 'mcg.signedOut';

/** The password the fake accepts. Other passwords fail like a wrong password at Cognito. */
export const FAKE_PASSWORD = 'correct-horse-battery';
export const FAKE_MFA_CODE = '123456';
/** These addresses trigger the extra steps of the real flow. */
export const FAKE_USERS = {
  invited: 'invited@example.test', // asks for a new password first
  mfa: 'mfa@example.test', // asks for an authenticator code
  throttled: 'throttled@example.test', // "too many attempts"
  offline: 'offline@example.test', // no connection
} as const;

/**
 * Stand-in for Cognito in the end to end tests. It reproduces the steps of the real sign-in
 * (password, new password, code, reset) with the state kept in sessionStorage.
 */
@Injectable()
export class FakeAuthService extends AuthService {
  private readonly router = inject(Router);
  private signedIn = false;
  private initPromise?: Promise<boolean>;
  private pending: 'newPassword' | 'mfa' | null = null;

  override init(): Promise<boolean> {
    this.initPromise ??= Promise.resolve().then(
      () => (this.signedIn = sessionStorage.getItem(SIGNED_IN) === '1'),
    );
    return this.initPromise;
  }

  override isAuthenticated(): boolean {
    return this.signedIn;
  }

  override async signIn(email: string, password: string): Promise<SignInStep> {
    if (sessionStorage.getItem(MODE) === 'hang') {
      sessionStorage.setItem(
        SIGN_IN_CALLS,
        String(Number(sessionStorage.getItem(SIGN_IN_CALLS) ?? 0) + 1),
      );
      return new Promise<SignInStep>(() => undefined);
    }
    await Promise.resolve();
    if (email === FAKE_USERS.throttled) throw new AuthError('rate_limited');
    if (email === FAKE_USERS.offline) throw new AuthError('network');
    if (password !== FAKE_PASSWORD) throw new AuthError('invalid_credentials');
    if (email === FAKE_USERS.invited) return (this.pending = 'newPassword');
    if (email === FAKE_USERS.mfa) return (this.pending = 'mfa');
    return this.finish();
  }

  override async completeNewPassword(newPassword: string): Promise<SignInStep> {
    if (this.pending !== 'newPassword') throw new AuthError('session_expired');
    if (newPassword.length < 12) throw new AuthError('password_policy');
    return this.finish();
  }

  override async submitMfaCode(code: string): Promise<SignInStep> {
    if (this.pending !== 'mfa') throw new AuthError('session_expired');
    if (code.trim() !== FAKE_MFA_CODE) throw new AuthError('invalid_code');
    return this.finish();
  }

  override async requestPasswordReset(): Promise<void> {
    await Promise.resolve();
  }

  override async confirmPasswordReset(
    _email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    if (code.trim() !== FAKE_MFA_CODE) throw new AuthError('invalid_code');
    if (newPassword.length < 12) throw new AuthError('password_policy');
  }

  override logout(): void {
    this.signedIn = false;
    sessionStorage.removeItem(SIGNED_IN);
    sessionStorage.setItem(SIGNED_OUT_FLAG, '1');
    void this.router.navigate([LOGIN_PATH]);
  }

  private finish(): SignInStep {
    this.pending = null;
    this.signedIn = true;
    sessionStorage.setItem(SIGNED_IN, '1');
    return 'done';
  }
}
