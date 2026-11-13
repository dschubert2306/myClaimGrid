import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** 4px bar. `percent` null means indeterminate. Extra content (a badge) is shown on the right. */
@Component({
  selector: 'mcg-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mcg-progress">
      <div class="mcg-row" style="justify-content: space-between">
        <span style="font-size: 13px">{{ label() }}</span>
        @if (percent() !== null) {
          <span class="mcg-muted mcg-num" style="font-size: 13px">{{ percent() }} %</span>
        }
        <ng-content />
      </div>
      <div
        class="mcg-progress__bar"
        [class.mcg-progress__bar--indeterminate]="percent() === null"
        role="progressbar"
        [attr.aria-label]="label()"
        [attr.aria-valuenow]="percent()"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <i [style.width.%]="percent()"></i>
      </div>
    </div>
  `,
})
export class ProgressComponent {
  readonly label = input.required<string>();
  readonly percent = input<number | null>(null);
}
