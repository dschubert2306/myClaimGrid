import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SelectOption {
  value: string;
  label: string;
}

/** Native select with the square styling. Used for the year and the person. */
@Component({
  selector: 'mcg-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="mcg-select" [class.mcg-select--sm]="small()">
      <select
        [attr.id]="inputId()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-invalid]="invalid() ? true : null"
        [attr.aria-describedby]="describedBy()"
        [style.min-width]="minWidth()"
        (change)="value.set($any($event.target).value || null)"
      >
        @if (placeholder()) {
          <option value="" [selected]="!value()">{{ placeholder() }}</option>
        }
        @for (option of options(); track option.value) {
          <option [value]="option.value" [selected]="option.value === value()">
            {{ option.label }}
          </option>
        }
      </select>
    </span>
  `,
})
export class SelectComponent {
  readonly options = input.required<SelectOption[]>();
  readonly value = model<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly inputId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly invalid = input(false);
  readonly small = input(false);
  readonly minWidth = input<string | null>(null);
}
