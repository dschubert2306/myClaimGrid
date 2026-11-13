import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** `<button mcg-button variant="primary">`: the native button with the `mcg-btn` classes. */
@Component({
  selector: 'button[mcg-button]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    class: 'mcg-btn',
    '[class.mcg-btn--primary]': "variant() === 'primary'",
    '[class.mcg-btn--ghost]': "variant() === 'ghost'",
    '[class.mcg-btn--danger]': "variant() === 'danger'",
    '[class.mcg-btn--sm]': "size() === 'sm'",
    '[class.mcg-btn--icon]': 'iconOnly()',
    '[attr.type]': 'type()',
  },
})
export class ButtonComponent {
  readonly variant = input<'default' | 'primary' | 'ghost' | 'danger'>('default');
  readonly size = input<'md' | 'sm'>('md');
  readonly iconOnly = input(false);
  readonly type = input<'button' | 'submit'>('button');
}
