import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Label, tag, control (projected) and hint or error. The host is the `.mcg-field` element.
 * The control needs `id` = inputId; wire `aria-invalid` and `aria-describedby="<inputId>-error"` on it.
 */
@Component({
  selector: 'mcg-field',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mcg-field',
    '[class.mcg-field--missing]': "tag() === 'missing'",
    '[class.mcg-field--error]': '!!error()',
  },
  template: `
    <div class="mcg-field__head">
      <label [attr.for]="inputId()">{{ label() }}</label>
      @if (tag() === 'extracted') {
        <span class="mcg-tag mcg-tag--extracted">{{ 'field.fromPdf' | transloco }}</span>
      } @else if (tag() === 'missing') {
        <span class="mcg-tag mcg-tag--missing">{{ 'field.notRecognised' | transloco }}</span>
      }
    </div>
    <ng-content />
    @if (error()) {
      <span class="mcg-field__error" [id]="inputId() + '-error'">{{ error() }}</span>
    } @else if (hint()) {
      <span class="mcg-field__hint">{{ hint() }}</span>
    }
  `,
})
export class FieldComponent {
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly tag = input<'extracted' | 'missing' | null>(null);
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
}
