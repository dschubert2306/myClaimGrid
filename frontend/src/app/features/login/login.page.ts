import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthError, type AuthErrorCode } from '../../core/auth/auth-error';
import { AuthService, type SignInStep } from '../../core/auth/auth.service';
import { peekReturnTo, takeReturnTo } from '../../core/auth/return-to';
import { LanguageService } from '../../core/language.service';
import { STORAGE_KEYS, storageTake } from '../../core/storage';
import { ButtonComponent } from '../../ui/button.component';
import { FieldComponent } from '../../ui/field.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { LanguageSwitchComponent, ThemeSwitchComponent } from '../../ui/switches.component';

type Step = 'credentials' | 'newPassword' | 'mfa' | 'forgot' | 'reset';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign-in landing page for signed-out users (design-system/components/LoginPage).
 * It holds the Cognito sign-in itself: email and password, and when Cognito asks for it the
 * new-password step (first sign-in of an invited user) and the authenticator code. A second flow
 * resets a forgotten password with a code sent by mail.
 */
@Component({
  selector: 'mcg-login-page',
  imports: [
    NgTemplateOutlet,
    TranslocoPipe,
    ButtonComponent,
    FieldComponent,
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
            @case ('expired') {
              <mcg-notice variant="error">{{ 'login.sessionExpired' | transloco }}</mcg-notice>
            }
            @case ('passwordChanged') {
              <mcg-notice>{{ 'login.passwordChanged' | transloco }}</mcg-notice>
            }
          }
          @if (errorCode(); as code) {
            <mcg-notice variant="error">{{ 'login.errors.' + code | transloco }}</mcg-notice>
          }

          @switch (step()) {
            @case ('credentials') {
              <h1 class="mcg-login__title">{{ 'login.title' | transloco }}</h1>
              <p class="mcg-login__text">{{ 'login.text' | transloco }}</p>
              <form
                class="mcg-stack"
                novalidate
                (submit)="$event.preventDefault(); submitCredentials()"
              >
                <mcg-field
                  [label]="'login.email' | transloco"
                  inputId="l-email"
                  [error]="emailError()"
                >
                  <input
                    id="l-email"
                    class="mcg-input"
                    type="email"
                    name="email"
                    autocomplete="username"
                    inputmode="email"
                    autocapitalize="none"
                    spellcheck="false"
                    [value]="email()"
                    [attr.aria-invalid]="emailError() ? true : null"
                    [attr.aria-describedby]="emailError() ? 'l-email-error' : null"
                    (input)="email.set($any($event.target).value)"
                  />
                </mcg-field>
                <mcg-field
                  [label]="'login.password' | transloco"
                  inputId="l-password"
                  [error]="required('password')"
                >
                  <input
                    id="l-password"
                    class="mcg-input"
                    type="password"
                    name="password"
                    autocomplete="current-password"
                    [value]="password()"
                    [attr.aria-invalid]="required('password') ? true : null"
                    [attr.aria-describedby]="required('password') ? 'l-password-error' : null"
                    (input)="password.set($any($event.target).value)"
                  />
                </mcg-field>
                <div class="mcg-login__actions">
                  <button mcg-button variant="primary" type="submit" [disabled]="busy()">
                    @if (busy()) {
                      {{ 'login.signingIn' | transloco }}
                    } @else {
                      {{ 'login.signIn' | transloco }}<mcg-icon name="arrow-right" />
                    }
                  </button>
                  <button mcg-button variant="ghost" size="sm" (click)="goForgot()">
                    {{ 'login.forgot' | transloco }}
                  </button>
                </div>
              </form>
            }

            @case ('newPassword') {
              <h1 class="mcg-login__title">{{ 'login.newPassword.title' | transloco }}</h1>
              <p class="mcg-login__text">{{ 'login.newPassword.text' | transloco }}</p>
              <form
                class="mcg-stack"
                novalidate
                (submit)="$event.preventDefault(); submitNewPassword()"
              >
                <ng-container *ngTemplateOutlet="passwordPair" />
                <div class="mcg-login__actions">
                  <button mcg-button variant="primary" type="submit" [disabled]="busy()">
                    {{ 'login.continue' | transloco }}
                  </button>
                  <button mcg-button variant="ghost" size="sm" (click)="backToCredentials()">
                    {{ 'login.backToSignIn' | transloco }}
                  </button>
                </div>
              </form>
            }

            @case ('mfa') {
              <h1 class="mcg-login__title">{{ 'login.mfa.title' | transloco }}</h1>
              <p class="mcg-login__text">{{ 'login.mfa.text' | transloco }}</p>
              <form class="mcg-stack" novalidate (submit)="$event.preventDefault(); submitMfa()">
                <ng-container *ngTemplateOutlet="codeField" />
                <div class="mcg-login__actions">
                  <button mcg-button variant="primary" type="submit" [disabled]="busy()">
                    {{ 'login.mfa.verify' | transloco }}
                  </button>
                  <button mcg-button variant="ghost" size="sm" (click)="backToCredentials()">
                    {{ 'login.backToSignIn' | transloco }}
                  </button>
                </div>
              </form>
            }

            @case ('forgot') {
              <h1 class="mcg-login__title">{{ 'login.forgotStep.title' | transloco }}</h1>
              <p class="mcg-login__text">{{ 'login.forgotStep.text' | transloco }}</p>
              <form class="mcg-stack" novalidate (submit)="$event.preventDefault(); submitForgot()">
                <mcg-field
                  [label]="'login.email' | transloco"
                  inputId="l-email"
                  [error]="emailError()"
                >
                  <input
                    id="l-email"
                    class="mcg-input"
                    type="email"
                    name="email"
                    autocomplete="username"
                    inputmode="email"
                    autocapitalize="none"
                    spellcheck="false"
                    [value]="email()"
                    [attr.aria-invalid]="emailError() ? true : null"
                    [attr.aria-describedby]="emailError() ? 'l-email-error' : null"
                    (input)="email.set($any($event.target).value)"
                  />
                </mcg-field>
                <div class="mcg-login__actions">
                  <button mcg-button variant="primary" type="submit" [disabled]="busy()">
                    {{ 'login.forgotStep.send' | transloco }}
                  </button>
                  <button mcg-button variant="ghost" size="sm" (click)="backToCredentials()">
                    {{ 'login.backToSignIn' | transloco }}
                  </button>
                </div>
              </form>
            }

            @case ('reset') {
              <h1 class="mcg-login__title">{{ 'login.reset.title' | transloco }}</h1>
              <p class="mcg-login__text">
                {{ 'login.reset.text' | transloco: { email: email() } }}
              </p>
              <form class="mcg-stack" novalidate (submit)="$event.preventDefault(); submitReset()">
                <ng-container *ngTemplateOutlet="codeField" />
                <ng-container *ngTemplateOutlet="passwordPair" />
                <div class="mcg-login__actions">
                  <button mcg-button variant="primary" type="submit" [disabled]="busy()">
                    {{ 'login.reset.submit' | transloco }}
                  </button>
                  <button mcg-button variant="ghost" size="sm" (click)="backToCredentials()">
                    {{ 'login.backToSignIn' | transloco }}
                  </button>
                </div>
              </form>
            }
          }
        </div>

        <ng-template #codeField>
          <mcg-field [label]="'login.code' | transloco" inputId="l-code" [error]="required('code')">
            <input
              id="l-code"
              class="mcg-input mcg-num"
              name="code"
              autocomplete="one-time-code"
              inputmode="numeric"
              [value]="code()"
              [attr.aria-invalid]="required('code') ? true : null"
              [attr.aria-describedby]="required('code') ? 'l-code-error' : null"
              (input)="code.set($any($event.target).value)"
            />
          </mcg-field>
        </ng-template>

        <ng-template #passwordPair>
          <mcg-field
            [label]="'login.newPassword.label' | transloco"
            inputId="l-new"
            [hint]="'login.newPassword.hint' | transloco"
            [error]="required('newPassword')"
          >
            <input
              id="l-new"
              class="mcg-input"
              type="password"
              name="new-password"
              autocomplete="new-password"
              [value]="newPassword()"
              [attr.aria-invalid]="required('newPassword') ? true : null"
              [attr.aria-describedby]="required('newPassword') ? 'l-new-error' : null"
              (input)="newPassword.set($any($event.target).value)"
            />
          </mcg-field>
          <mcg-field
            [label]="'login.newPassword.repeat' | transloco"
            inputId="l-repeat"
            [error]="repeatError()"
          >
            <input
              id="l-repeat"
              class="mcg-input"
              type="password"
              name="repeat-password"
              autocomplete="new-password"
              [value]="repeat()"
              [attr.aria-invalid]="repeatError() ? true : null"
              [attr.aria-describedby]="repeatError() ? 'l-repeat-error' : null"
              (input)="repeat.set($any($event.target).value)"
            />
          </mcg-field>
        </ng-template>
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
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly i18n = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  protected readonly step = signal<Step>('credentials');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly newPassword = signal('');
  protected readonly repeat = signal('');
  protected readonly code = signal('');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly errorCode = signal<AuthErrorCode | null>(null);
  private readonly passwordChanged = signal(false);

  // Read once: the sign-out flag is removed, the expired notice comes from the URL and is cleaned up.
  private readonly signedOut = storageTake('session', STORAGE_KEYS.signedOut) === '1';
  private readonly expired =
    inject(ActivatedRoute).snapshot.queryParamMap.get('notice') === 'expired';
  protected readonly notice = computed<'expired' | 'signedOut' | 'passwordChanged' | null>(() =>
    this.passwordChanged()
      ? 'passwordChanged'
      : this.expired
        ? 'expired'
        : this.signedOut
          ? 'signedOut'
          : null,
  );

  constructor() {
    if (this.expired) void this.router.navigate([], { replaceUrl: true, queryParams: {} });
    // Someone who is already signed in has no use for this page.
    void this.auth.init().then((signedIn) => {
      if (signedIn) void this.router.navigateByUrl(peekReturnTo());
    });
  }

  // ------------------------------------------------------------ validation

  /** "Please fill in this field." once the form was submitted with the field empty. */
  protected required(field: 'password' | 'newPassword' | 'code'): string | null {
    this.language.lang(); // texts follow the language
    if (!this.submitted()) return null;
    return this[field]().trim() === '' ? this.i18n.translate('errors.required') : null;
  }

  protected emailError(): string | null {
    this.language.lang();
    if (!this.submitted()) return null;
    const value = this.email().trim();
    if (value === '') return this.i18n.translate('errors.required');
    return EMAIL_PATTERN.test(value) ? null : this.i18n.translate('login.emailInvalid');
  }

  protected repeatError(): string | null {
    this.language.lang();
    if (!this.submitted()) return null;
    if (this.repeat() === '') return this.i18n.translate('errors.required');
    return this.repeat() === this.newPassword() ? null : this.i18n.translate('login.mismatch');
  }

  // ------------------------------------------------------------ steps

  protected submitCredentials(): void {
    this.submitted.set(true);
    if (this.emailError() || this.required('password')) return this.focusInvalid();
    void this.run(async () => this.proceed(await this.auth.signIn(this.email(), this.password())));
  }

  protected submitNewPassword(): void {
    this.submitted.set(true);
    if (this.required('newPassword') || this.repeatError()) return this.focusInvalid();
    void this.run(async () =>
      this.proceed(await this.auth.completeNewPassword(this.newPassword())),
    );
  }

  protected submitMfa(): void {
    this.submitted.set(true);
    if (this.required('code')) return this.focusInvalid();
    void this.run(async () => this.proceed(await this.auth.submitMfaCode(this.code())));
  }

  protected goForgot(): void {
    this.goTo('forgot');
  }

  protected submitForgot(): void {
    this.submitted.set(true);
    if (this.emailError()) return this.focusInvalid();
    void this.run(async () => {
      await this.auth.requestPasswordReset(this.email());
      this.goTo('reset', { keepEmail: true });
    });
  }

  protected submitReset(): void {
    this.submitted.set(true);
    if (this.required('code') || this.required('newPassword') || this.repeatError()) {
      return this.focusInvalid();
    }
    void this.run(async () => {
      await this.auth.confirmPasswordReset(this.email(), this.code(), this.newPassword());
      this.goTo('credentials', { keepEmail: true });
      this.passwordChanged.set(true);
    });
  }

  protected backToCredentials(): void {
    this.goTo('credentials', { keepEmail: true });
  }

  // ------------------------------------------------------------ internals

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return; // a double click must not start two requests
    this.busy.set(true);
    this.errorCode.set(null);
    this.passwordChanged.set(false);
    try {
      await action();
    } catch (error) {
      this.fail(error instanceof AuthError ? error.code : 'unknown');
    } finally {
      this.busy.set(false);
    }
  }

  private fail(code: AuthErrorCode): void {
    this.password.set('');
    if (code === 'session_expired') {
      // The few minutes Cognito gives for the second step ran out: start again.
      this.goTo('credentials', { keepEmail: true });
    } else if (code === 'password_reset_required') {
      this.goTo('forgot', { keepEmail: true });
    }
    this.errorCode.set(code);
    if (code !== 'session_expired' && code !== 'password_reset_required') this.focusInvalid(true);
  }

  private proceed(next: SignInStep): void {
    if (next === 'done') {
      this.clearSecrets();
      void this.router.navigateByUrl(takeReturnTo());
    } else {
      this.goTo(next);
    }
  }

  private goTo(step: Step, options: { keepEmail?: boolean } = {}): void {
    this.clearSecrets();
    if (!options.keepEmail) this.email.set('');
    this.submitted.set(false);
    this.errorCode.set(null);
    this.step.set(step);
    this.focusFirst();
  }

  private clearSecrets(): void {
    this.password.set('');
    this.newPassword.set('');
    this.repeat.set('');
    this.code.set('');
  }

  private focusFirst(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('.mcg-login__body input')?.focus(),
      { injector: this.injector },
    );
  }

  /** Moves focus to the first field with an error, or (after a failed request) to the first field. */
  private focusInvalid(afterRequest = false): void {
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        const target = afterRequest
          ? root.querySelector<HTMLElement>('.mcg-login__body input')
          : root.querySelector<HTMLElement>('.mcg-login__body input[aria-invalid="true"]');
        target?.focus();
      },
      { injector: this.injector },
    );
  }
}
