import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent } from './button.component';
import { IconComponent } from './icon.component';

/** Shown only when the whole account has no claim in any year. */
@Component({
  selector: 'mcg-empty-state',
  imports: [TranslocoPipe, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mcg-empty' },
  template: `
    <div class="mcg-empty__grid" aria-hidden="true">
      <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
    </div>
    <h2 class="mcg-empty__title">{{ 'empty.title' | transloco: { year: year() } }}</h2>
    <p class="mcg-empty__text">{{ 'empty.text' | transloco }}</p>
    <button mcg-button variant="primary" (click)="create.emit()">
      <mcg-icon name="plus" />{{ 'dashboard.newClaim' | transloco }}
    </button>
  `,
})
export class EmptyStateComponent {
  readonly year = input.required<number>();
  readonly create = output<void>();
}
