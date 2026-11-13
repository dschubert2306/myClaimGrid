import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from './icon.component';

@Component({
  selector: 'mcg-notice',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mcg-notice',
    '[class.mcg-notice--error]': "variant() === 'error'",
    '[attr.role]': "variant() === 'error' ? 'alert' : 'status'",
  },
  template: `<mcg-icon [name]="variant() === 'error' ? 'alert' : 'info'" /><span
      ><ng-content
    /></span>`,
})
export class NoticeComponent {
  readonly variant = input<'info' | 'error'>('info');
}
