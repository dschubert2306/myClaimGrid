import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Line icons on a 20px grid, 1.5px stroke, square caps and miter joins, colored with currentColor. */
const ICONS = {
  upload: ['M10 13V4M6 8l4-4 4 4M4 13v3h12v-3'],
  file: ['M5 2.75h6.5L15 6.25v11H5z', 'M11.5 2.75v3.5H15'],
  plus: ['M10 4v12M4 10h12'],
  close: ['M5 5l10 10M15 5L5 15'],
  'chevron-down': ['M5 8l5 5 5-5'],
  sun: [
    'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4',
  ],
  moon: ['M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z'],
  monitor: ['M2.75 3.75h14.5v10H2.75zM7 17.25h6M10 13.75v3.5'],
  'sign-out': ['M8 3.75H3.75v12.5H8M12 6.5L15.5 10 12 13.5M15.5 10H7.5'],
  'arrow-right': ['M4 10h11M11 6l4 4-4 4'],
  info: ['M10 2.75a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5zM10 9v5M10 6v.5'],
  alert: ['M10 3L18 17H2zM10 8v4M10 14.25v.5'],
} as const;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'mcg-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `<svg
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="square"
    stroke-linejoin="miter"
    viewBox="0 0 20 20"
    aria-hidden="true"
  >
    @for (d of paths(); track d) {
      <path [attr.d]="d" />
    }
  </svg>`,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  protected readonly paths = computed(() => ICONS[this.name()]);
}
