/**
 * What the app needs from authentication. The real implementation talks to Cognito through an
 * OIDC library, the end to end tests replace it with a fake one (see auth-providers.ts).
 */
export abstract class AuthService {
  /** Restores a session or completes a sign-in callback. Resolves once, to "signed in or not". */
  abstract init(): Promise<boolean>;
  abstract isAuthenticated(): boolean;
  /** Redirects to the Cognito sign-in (authorization code flow with PKCE). */
  abstract login(): void;
  /** Redirects to the Cognito sign-out and then back to /login. */
  abstract logout(): void;
}
