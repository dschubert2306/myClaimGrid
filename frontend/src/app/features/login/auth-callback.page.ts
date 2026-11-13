import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { LOGIN_PATH } from '../../core/auth/paths';
import { takeReturnTo } from '../../core/auth/return-to';
import { ProgressComponent } from '../../ui/progress.component';

/** /auth/callback: finishes the sign-in, then goes to the remembered route or the dashboard. */
@Component({
  selector: 'mcg-auth-callback-page',
  imports: [TranslocoPipe, ProgressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="app-center">
      <div class="app-center__box">
        <mcg-progress [label]="'callback.completing' | transloco" [percent]="null" />
      </div>
    </main>
  `,
})
export class AuthCallbackPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    void this.finish();
  }

  private async finish(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const isCallback = params.has('code') || params.has('error');
    const signedIn = await this.auth.init();
    if (signedIn) {
      await this.router.navigateByUrl(takeReturnTo(), { replaceUrl: true });
    } else {
      // A visit without a code is just a stray URL. A failed callback shows the error notice.
      await this.router.navigate([LOGIN_PATH], {
        replaceUrl: true,
        queryParams: isCallback ? { notice: 'error' } : {},
      });
    }
  }
}
