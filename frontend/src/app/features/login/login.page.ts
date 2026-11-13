import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { peekReturnTo } from '../../core/auth/return-to';
import { STORAGE_KEYS, storageTake } from '../../core/storage';
import { ButtonComponent } from '../../ui/button.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { LanguageSwitchComponent, ThemeSwitchComponent } from '../../ui/switches.component';

/**
 * Sign-in landing page for signed-out users (design-system/components/LoginPage).
 * It has no password field: the button starts the Cognito authorization code flow.
 */
@Component({
  selector: 'mcg-login-page',
  imports: [
    TranslocoPipe,
    ButtonComponent,
    IconComponent,
    NoticeComponent,
    LanguageSwitchComponent,
    ThemeSwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mcg-login">
      <div class="mcg-login__main">
        <div class="mcg-login__bar">
          <div class="mcg-topbar__brand">
            <span class="mcg-topbar__mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span
            >myClaimGrid
          </div>
          <div class="mcg-row">
            <mcg-language-switch [small]="true" />
            <mcg-theme-switch [small]="true" [iconOnly]="true" />
          </div>
        </div>
        <div class="mcg-login__body">
          @switch (notice()) {
            @case ('signedOut') {
              <mcg-notice>{{ 'login.signedOut' | transloco }}</mcg-notice>
            }
            @case ('error') {
              <mcg-notice variant="error">{{ 'login.error' | transloco }}</mcg-notice>
            }
          }
          <h1 class="mcg-login__title">{{ 'login.title' | transloco }}</h1>
          <p class="mcg-login__text">{{ 'login.text' | transloco }}</p>
          <div class="mcg-login__actions">
            <button mcg-button variant="primary" [disabled]="redirecting()" (click)="signIn()">
              @if (redirecting()) {
                {{ 'login.redirecting' | transloco }}
              } @else {
                {{ 'login.signIn' | transloco }}<mcg-icon name="arrow-right" />
              }
            </button>
            <span class="mcg-login__meta">{{ 'login.meta' | transloco }}</span>
          </div>
        </div>
        <div class="mcg-login__foot">{{ 'login.invitationOnly' | transloco }}</div>
      </div>
      <div class="mcg-login__art" aria-hidden="true">
        <i style="left: 96px; top: 0; width: 240px; height: 144px; background: var(--accent)"></i>
        <i style="left: 336px; top: 0; width: 96px; height: 100%; background: var(--ink)"></i>
        <i style="left: 0; top: 144px; width: 96px; height: 96px; background: var(--person-1)"></i>
        <i
          style="left: 192px; top: 144px; width: 96px; height: 48px; background: var(--person-2)"
        ></i>
        <i
          style="left: 288px; top: 192px; width: 48px; height: 48px; background: var(--person-3)"
        ></i>
        <i
          style="left: 96px; top: 384px; width: 144px; height: 48px; background: var(--accent-soft)"
        ></i>
      </div>
    </main>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly redirecting = signal(false);
  // Read once: the sign-out flag is removed, the error notice comes from the URL and is cleaned up.
  private readonly signedOut = storageTake('session', STORAGE_KEYS.signedOut) === '1';
  private readonly failed = inject(ActivatedRoute).snapshot.queryParamMap.get('notice') === 'error';
  protected readonly notice = computed<'error' | 'signedOut' | null>(() =>
    this.failed ? 'error' : this.signedOut ? 'signedOut' : null,
  );

  constructor() {
    if (this.failed) void this.router.navigate([], { replaceUrl: true, queryParams: {} });
    // Someone who is already signed in has no use for this page.
    void this.auth.init().then((signedIn) => {
      if (signedIn) void this.router.navigateByUrl(peekReturnTo());
    });
  }

  protected signIn(): void {
    this.redirecting.set(true); // a double click must not start two flows
    this.auth.login();
  }
}
