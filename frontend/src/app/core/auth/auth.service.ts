import type { SignInStep } from './cognito-core';

export type { SignInStep };

/**
 * What the app needs from authentication. The real implementation talks to Cognito
 * (cognito-auth.service.ts), the end to end tests replace it with a fake one (see auth-providers.ts).
 * Failed steps reject with an AuthError (auth-error.ts).
 */
export abstract class AuthService {
  /** Restores a stored session. Resolves once, to "signed in or not". */
  abstract init(): Promise<boolean>;
  abstract isAuthenticated(): boolean;
  /** Email and password. "done" means signed in, the other steps need one more form. */
  abstract signIn(email: string, password: string): Promise<SignInStep>;
  /** Replaces the temporary password of a user the administrator created. */
  abstract completeNewPassword(newPassword: string): Promise<SignInStep>;
  /** Code of the authenticator app, only for users with TOTP. */
  abstract submitMfaCode(code: string): Promise<SignInStep>;
  /** Sends a reset code by mail. Looks the same for unknown addresses. */
  abstract requestPasswordReset(email: string): Promise<void>;
  abstract confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void>;
  /** Signs out everywhere this session reaches and goes back to /login. */
  abstract logout(): void;
}
