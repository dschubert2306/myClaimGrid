import { AuthError, mapCognitoError, type AuthContext } from './auth-error';

/**
 * Sign-in against the Cognito user pool without a redirect: the login page collects the
 * credentials and this class talks to the Cognito API (InitiateAuth, RespondToAuthChallenge and
 * friends) with the USER_PASSWORD_AUTH flow over HTTPS. No framework code in here, so it can be
 * tested with a fake `fetch`.
 */

export interface CognitoSettings {
  region: string;
  clientId: string;
}

/** Where the tokens live between page loads (sessionStorage in the app). */
export interface TokenStore {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

/** What the page has to do next after a sign-in step. */
export type SignInStep = 'done' | 'newPassword' | 'mfa';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

interface Challenge {
  kind: 'newPassword' | 'mfa';
  session: string;
  username: string;
}

interface AuthenticationResult {
  AccessToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

interface CognitoResponse {
  AuthenticationResult?: AuthenticationResult;
  ChallengeName?: string;
  ChallengeParameters?: Record<string, string>;
  Session?: string;
  __type?: string;
}

/** Refresh when less than this is left, so a request never leaves with a token about to expire. */
const REFRESH_MARGIN_MS = 60_000;

export class CognitoAuthCore {
  private tokens: Tokens | null = null;
  private challenge: Challenge | null = null;
  private refreshing: Promise<boolean> | null = null;

  /** Called when a stored session can no longer be renewed (refresh token expired or revoked). */
  onSessionLost: () => void = () => undefined;

  constructor(
    private readonly settings: CognitoSettings,
    private readonly store: TokenStore,
    private readonly doFetch: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  // ------------------------------------------------------------------ session

  /** Loads a stored session and renews it if needed. Resolves to "signed in or not". */
  async restore(): Promise<boolean> {
    this.tokens = this.readStored();
    if (!this.tokens) return false;
    if (this.tokens.expiresAt - this.now() > REFRESH_MARGIN_MS) return true;
    return this.refresh();
  }

  isSignedIn(): boolean {
    return this.tokens !== null;
  }

  /** A valid access token for the API, renewed first when it is about to expire. Null when signed out. */
  async accessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (this.tokens.expiresAt - this.now() <= REFRESH_MARGIN_MS) await this.refresh();
    return this.tokens?.accessToken ?? null;
  }

  /** Revokes the refresh token (best effort: offline must not keep the user signed in) and forgets everything. */
  async signOut(): Promise<void> {
    const refreshToken = this.tokens?.refreshToken;
    this.forget();
    if (!refreshToken) return;
    try {
      await this.call(
        'RevokeToken',
        { ClientId: this.settings.clientId, Token: refreshToken },
        'signIn',
      );
    } catch {
      /* the local session is gone either way */
    }
  }

  // ------------------------------------------------------------------ sign in

  async signIn(email: string, password: string): Promise<SignInStep> {
    this.challenge = null;
    const username = email.trim();
    const response = await this.call(
      'InitiateAuth',
      {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: this.settings.clientId,
        AuthParameters: { USERNAME: username, PASSWORD: password },
      },
      'signIn',
    );
    return this.handle(response, username);
  }

  /** First sign-in of a user created by the administrator: the temporary password must be replaced. */
  async completeNewPassword(newPassword: string): Promise<SignInStep> {
    const challenge = this.requireChallenge('newPassword');
    const response = await this.call(
      'RespondToAuthChallenge',
      {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: this.settings.clientId,
        Session: challenge.session,
        ChallengeResponses: { USERNAME: challenge.username, NEW_PASSWORD: newPassword },
      },
      'challenge',
    );
    return this.handle(response, challenge.username);
  }

  /** Six digit code of the authenticator app, for users who have TOTP switched on. */
  async submitMfaCode(code: string): Promise<SignInStep> {
    const challenge = this.requireChallenge('mfa');
    const response = await this.call(
      'RespondToAuthChallenge',
      {
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        ClientId: this.settings.clientId,
        Session: challenge.session,
        ChallengeResponses: {
          USERNAME: challenge.username,
          SOFTWARE_TOKEN_MFA_CODE: code.replace(/\s/g, ''),
        },
      },
      'challenge',
    );
    return this.handle(response, challenge.username);
  }

  /** Sends the code by mail. An unknown address looks the same as a known one (no account guessing). */
  async requestPasswordReset(email: string): Promise<void> {
    try {
      await this.call(
        'ForgotPassword',
        { ClientId: this.settings.clientId, Username: email.trim() },
        'forgot',
      );
    } catch (error) {
      if (error instanceof AuthError && error.code === 'invalid_credentials') return;
      throw error;
    }
  }

  async confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
    await this.call(
      'ConfirmForgotPassword',
      {
        ClientId: this.settings.clientId,
        Username: email.trim(),
        ConfirmationCode: code.trim(),
        Password: newPassword,
      },
      'confirm',
    );
  }

  // ------------------------------------------------------------------ internals

  private requireChallenge(kind: Challenge['kind']): Challenge {
    if (this.challenge?.kind !== kind) throw new AuthError('session_expired');
    return this.challenge;
  }

  private handle(response: CognitoResponse, username: string): SignInStep {
    const result = response.AuthenticationResult;
    if (result?.AccessToken && result.RefreshToken) {
      this.challenge = null;
      this.setTokens({
        accessToken: result.AccessToken,
        refreshToken: result.RefreshToken,
        expiresAt: this.now() + (result.ExpiresIn ?? 3600) * 1000,
      });
      return 'done';
    }
    const kind =
      response.ChallengeName === 'NEW_PASSWORD_REQUIRED'
        ? 'newPassword'
        : response.ChallengeName === 'SOFTWARE_TOKEN_MFA'
          ? 'mfa'
          : null;
    if (kind && response.Session) {
      // Cognito wants the user name it resolved, which can differ from what was typed.
      const resolved = response.ChallengeParameters?.['USER_ID_FOR_SRP'] ?? username;
      this.challenge = { kind, session: response.Session, username: resolved };
      return kind;
    }
    // Another challenge (MFA setup, SMS) that this app does not offer.
    throw new AuthError('unknown');
  }

  private refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const current = this.tokens;
    if (!current) return false;
    try {
      const response = await this.call(
        'InitiateAuth',
        {
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: this.settings.clientId,
          AuthParameters: { REFRESH_TOKEN: current.refreshToken },
        },
        'challenge',
      );
      const result = response.AuthenticationResult;
      if (!result?.AccessToken) throw new AuthError('unknown');
      this.setTokens({
        accessToken: result.AccessToken,
        refreshToken: result.RefreshToken ?? current.refreshToken,
        expiresAt: this.now() + (result.ExpiresIn ?? 3600) * 1000,
      });
      return true;
    } catch (error) {
      // Offline: keep the session, the next call tries again. Anything else ends it.
      if (error instanceof AuthError && error.code === 'network') {
        return this.now() < current.expiresAt;
      }
      this.forget();
      this.onSessionLost();
      return false;
    }
  }

  private async call(
    target: string,
    body: Record<string, unknown>,
    context: AuthContext,
  ): Promise<CognitoResponse> {
    let response: Response;
    try {
      response = await this.doFetch(`https://cognito-idp.${this.settings.region}.amazonaws.com/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new AuthError('network');
    }
    const data = (await response.json().catch(() => ({}))) as CognitoResponse;
    if (!response.ok) throw new AuthError(mapCognitoError(data.__type, context));
    return data;
  }

  private setTokens(tokens: Tokens): void {
    this.tokens = tokens;
    this.store.write(JSON.stringify(tokens));
  }

  private forget(): void {
    this.tokens = null;
    this.challenge = null;
    this.store.clear();
  }

  private readStored(): Tokens | null {
    const raw = this.store.read();
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<Tokens>;
      if (
        typeof value.accessToken === 'string' &&
        typeof value.refreshToken === 'string' &&
        typeof value.expiresAt === 'number'
      ) {
        return value as Tokens;
      }
    } catch {
      /* fall through */
    }
    this.store.clear();
    return null;
  }
}
