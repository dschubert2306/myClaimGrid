import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { LanguageService } from '../core/language.service';
import type { Lang } from '../core/locale';
import { ThemeService, type ThemeChoice } from '../core/theme.service';
import { SegmentedComponent, type SegmentOption } from './segmented.component';

@Component({
  selector: 'mcg-language-switch',
  imports: [SegmentedComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mcg-segmented
    [label]="'topbar.language' | transloco"
    [options]="options"
    [value]="language.lang()"
    (valueChange)="language.set($event)"
    [small]="small()"
  />`,
})
export class LanguageSwitchComponent {
  protected readonly language = inject(LanguageService);
  readonly small = input(false);
  protected readonly options: SegmentOption<Lang>[] = [
    { value: 'de', label: 'DE' },
    { value: 'en', label: 'EN' },
  ];
}

@Component({
  selector: 'mcg-theme-switch',
  imports: [SegmentedComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mcg-segmented
    [label]="'topbar.theme' | transloco"
    [options]="options()"
    [value]="theme.choice()"
    (valueChange)="theme.set($event)"
    [small]="small()"
    [iconOnly]="iconOnly()"
  />`,
})
export class ThemeSwitchComponent {
  protected readonly theme = inject(ThemeService);
  private readonly i18n = inject(TranslocoService);
  private readonly lang = inject(LanguageService);
  readonly small = input(false);
  readonly iconOnly = input(false);

  protected readonly options = computed<SegmentOption<ThemeChoice>[]>(() => {
    this.lang.lang(); // labels follow the language
    return [
      { value: 'light', label: this.i18n.translate('theme.light'), icon: 'sun' },
      { value: 'system', label: this.i18n.translate('theme.system'), icon: 'monitor' },
      { value: 'dark', label: this.i18n.translate('theme.dark'), icon: 'moon' },
    ];
  });
}
