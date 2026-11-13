import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { EventTypes, OidcSecurityService, PublicEventsService } from 'angular-auth-oidc-client';
import { filter, firstValueFrom } from 'rxjs';
import { STORAGE_KEYS, storageSet } from '../storage';
import { AuthService } from './auth.service';
import { LOGIN_PATH } from './paths';

@Injectable()
export class OidcAuthService extends AuthService {
  private readonly oidc = inject(OidcSecurityService);
  private readonly router = inject(Router);
  private signedIn = false;
  private initPromise?: Promise<boolean>;

  constructor() {
    super();
    // A refresh token that can no longer be used ends the session: back to the login page.
    inject(PublicEventsService)
      .registerForEvents()
      .pipe(filter((event) => event.type === EventTypes.SilentRenewFailed))
      .subscribe(() => {
        this.signedIn = false;
        this.oidc.logoffLocal();
        void this.router.navigate([LOGIN_PATH], { queryParams: { notice: 'error' } });
      });
  }

  override init(): Promise<boolean> {
    this.initPromise ??= firstValueFrom(this.oidc.checkAuth())
      .then((result) => (this.signedIn = result.isAuthenticated))
      .catch(() => (this.signedIn = false));
    return this.initPromise;
  }

  override isAuthenticated(): boolean {
    return this.signedIn;
  }

  override login(): void {
    this.oidc.authorize();
  }

  override logout(): void {
    this.signedIn = false;
    storageSet('session', STORAGE_KEYS.signedOut, '1'); // LoginPage shows "You have been signed out" once
    this.oidc.logoffAndRevokeTokens().subscribe({
      // Revoking can fail (offline, expired token). The user still has to be signed out locally.
      error: () => {
        this.oidc.logoffLocal();
        void this.router.navigate([LOGIN_PATH]);
      },
    });
  }
}
