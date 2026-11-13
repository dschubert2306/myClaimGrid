import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** Two or three mutually exclusive toggle buttons (language, theme). */
@Component({
  selector: 'mcg-segmented',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mcg-seg" role="group" [class.mcg-seg--sm]="small()" [attr.aria-label]="label()">
      @for (option of options(); track option.value) {
        <button
          type="button"
          [attr.aria-pressed]="option.value === value()"
          [attr.aria-label]="iconOnly() ? option.label : null"
          (click)="value.set(option.value)"
        >
          @if (option.icon) {
            <mcg-icon [name]="option.icon" />
          }
          @if (!iconOnly()) {
            {{ option.label }}
          }
        </button>
      }
    </div>
  `,
})
export class SegmentedComponent<T extends string> {
  readonly label = input.required<string>();
  readonly options = input.required<SegmentOption<T>[]>();
  readonly value = model.required<T>();
  readonly small = input(false);
  readonly iconOnly = input(false);
}
