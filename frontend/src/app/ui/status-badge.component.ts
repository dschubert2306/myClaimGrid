import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export type BadgeStatus = 'DRAFT' | 'OPEN' | 'PENDING' | 'DONE' | 'FAILED';

/** The word carries the meaning, the color and the square dot support it. */
@Component({
  selector: 'mcg-status-badge',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="mcg-badge"
    [class.mcg-badge--open]="status() === 'OPEN'"
    [class.mcg-badge--pending]="status() === 'PENDING'"
    [class.mcg-badge--done]="status() === 'DONE'"
    [class.mcg-badge--failed]="status() === 'FAILED'"
    >{{ 'status.' + status() | transloco }}</span
  >`,
})
export class StatusBadgeComponent {
  readonly status = input.required<BadgeStatus>();
}
