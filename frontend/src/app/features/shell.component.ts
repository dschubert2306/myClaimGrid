import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { DashboardStore } from '../core/dashboard.store';
import { TopBarComponent } from '../ui/topbar.component';

/** Frame of the signed-in app: top bar and content. */
@Component({
  selector: 'mcg-shell',
  imports: [RouterOutlet, TopBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header
      mcg-topbar
      [years]="store.years()"
      [year]="store.year()"
      (yearChange)="store.setYear($event)"
      (signOut)="auth.logout()"
    ></header>
    <main class="app-content"><router-outlet /></main>
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(DashboardStore);
}
