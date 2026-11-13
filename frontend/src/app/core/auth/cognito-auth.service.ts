import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ConfigService } from '../config.service';
import { STORAGE_KEYS, storageRemove, storageGet, storageSet } from '../storage';
import { AuthService } from './auth.service';
import { CognitoAuthCore, type SignInStep, type TokenStore } from './cognito-core';
import { LOGIN_PATH } from './paths';

/** Tokens live in sessionStorage: gone when the tab closes, not shared with other tabs. */
const tokenStore: TokenStore = {
  read: () => storageGet('session', STORAGE_KEYS.session),
  write: (value) => storageSet('session', STORAGE_KEYS.session, value),
  clear: () => storageRemove('session', STORAGE_KEYS.session),
};

/** Angular wrapper around CognitoAuthCore: loads the deploy time config and handles the navigation. */
@Injectable()
export class CognitoAuthService extends AuthService {
  private readonly config = inject(ConfigService);
  private readonly router = inject(Router);
  private core?: Promise<CognitoAuthCore>;
  private signedIn = false;
  private initPromise?: Promise<boolean>;

  private getCore(): Promise<CognitoAuthCore> {
    this.core ??= new Promise<CognitoAuthCore>((resolve, reject) => {
      this.config.config$.subscribe({
        next: (config) => {
          const core = new CognitoAuthCore(
            { region: config.region, clientId: config.clientId },
            tokenStore,
          );
          // A refresh token that can no longer be used ends the session: back to the login page.
          core.onSessionLost = () => {
            this.signedIn = false;
            void this.router.navigate([LOGIN_PATH], { queryParams: { notice: 'expired' } });
          };
          resolve(core);
        },
        error: reject,
      });
    });
    return this.core;
  }

  /** The access token for API calls (used by the HTTP interceptor). */
  async accessToken(): Promise<string | null> {
    return (await this.getCore()).accessToken();
  }

  override init(): Promise<boolean> {
    this.initPromise ??= this.getCore()
      .then((core) => core.restore())
      .catch(() => false)
      .then((signedIn) => (this.signedIn = signedIn));
    return this.initPromise;
  }

  override isAuthenticated(): boolean {
    return this.signedIn;
  }

  override async signIn(email: string, password: string): Promise<SignInStep> {
    return this.track((await this.getCore()).signIn(email, password));
  }

  override async completeNewPassword(newPassword: string): Promise<SignInStep> {
    return this.track((await this.getCore()).completeNewPassword(newPassword));
  }

  override async submitMfaCode(code: string): Promise<SignInStep> {
    return this.track((await this.getCore()).submitMfaCode(code));
  }

  override async requestPasswordReset(email: string): Promise<void> {
    await (await this.getCore()).requestPasswordReset(email);
  }

  override async confirmPasswordReset(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    await (await this.getCore()).confirmPasswordReset(email, code, newPassword);
  }

  override logout(): void {
    this.signedIn = false;
    storageSet('session', STORAGE_KEYS.signedOut, '1'); // LoginPage shows "You have been signed out" once
    void this.getCore()
      .then((core) => core.signOut())
      .catch(() => undefined)
      .finally(() => void this.router.navigate([LOGIN_PATH]));
  }

  private async track(step: Promise<SignInStep>): Promise<SignInStep> {
    const result = await step;
    if (result === 'done') this.signedIn = true;
    return result;
  }
}
