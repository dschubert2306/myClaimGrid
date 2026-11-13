import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe } from '@jsverse/transloco';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ButtonComponent } from './button.component';
import { IconComponent } from './icon.component';
import { SelectComponent } from './select.component';
import { LanguageSwitchComponent, ThemeSwitchComponent } from './switches.component';

/** The single app bar. Order on the right: year, language, theme, settings, sign out. */
@Component({
  selector: 'header[mcg-topbar]',
  imports: [
    TranslocoPipe,
    RouterLink,
    ButtonComponent,
    IconComponent,
    SelectComponent,
    LanguageSwitchComponent,
    ThemeSwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mcg-topbar' },
  template: `
    <div class="mcg-topbar__brand">
      <span class="mcg-topbar__mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span
      >myClaimGrid
    </div>
    <div class="mcg-topbar__spacer"></div>
    <div class="mcg-topbar__tools">
      <mcg-select
        [small]="narrow()"
        [ariaLabel]="'topbar.year' | transloco"
        [options]="yearOptions()"
        [value]="'' + year()"
        (valueChange)="yearChange.emit(+($event ?? year()))"
      />
      <mcg-language-switch [small]="narrow()" />
      <mcg-theme-switch [small]="narrow()" [iconOnly]="narrow()" />
      @if (narrow()) {
        <button
          mcg-button
          variant="ghost"
          size="sm"
          [iconOnly]="true"
          routerLink="/settings"
          [attr.aria-label]="'topbar.settings' | transloco"
        >
          <mcg-icon name="settings" />
        </button>
        <button
          mcg-button
          variant="ghost"
          size="sm"
          [iconOnly]="true"
          [attr.aria-label]="'topbar.signOut' | transloco"
          (click)="signOut.emit()"
        >
          <mcg-icon name="sign-out" />
        </button>
      } @else {
        <button mcg-button variant="ghost" routerLink="/settings">
          <mcg-icon name="settings" />{{ 'topbar.settings' | transloco }}
        </button>
        <button mcg-button variant="ghost" (click)="signOut.emit()">
          <mcg-icon name="sign-out" />{{ 'topbar.signOut' | transloco }}
        </button>
      }
    </div>
  `,
})
export class TopBarComponent {
  readonly years = input.required<number[]>();
  readonly year = input.required<number>();
  readonly yearChange = output<number>();
  readonly signOut = output<void>();

  protected readonly narrow = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 639.98px)')
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );
  protected readonly yearOptions = computed(() =>
    this.years().map((y) => ({ value: String(y), label: String(y) })),
  );
}
