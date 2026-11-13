import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { LOCALES, initialLang, type Lang } from './locale';
import { STORAGE_KEYS, storageGet, storageSet } from './storage';

/** Active language. Switching updates the texts and the locale of dates, numbers and currency at once. */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);

  readonly lang = signal<Lang>(
    initialLang(storageGet('local', STORAGE_KEYS.language), navigator.language),
  );
  readonly locale = computed(() => LOCALES[this.lang()]);

  /** Loads the texts of the initial language, so the first render has no missing keys. */
  async init(): Promise<void> {
    this.apply(this.lang());
    await firstValueFrom(this.transloco.load(this.lang()));
  }

  set(lang: Lang): void {
    this.lang.set(lang);
    storageSet('local', STORAGE_KEYS.language, lang);
    this.apply(lang);
  }

  private apply(lang: Lang): void {
    this.transloco.setActiveLang(lang);
    document.documentElement.lang = lang;
  }
}
