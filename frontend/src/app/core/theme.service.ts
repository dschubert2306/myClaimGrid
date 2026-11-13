import { Injectable, computed, effect, signal } from '@angular/core';
import { STORAGE_KEYS, storageGet, storageSet } from './storage';
import { isThemeChoice, resolveTheme, type ThemeChoice } from './theme';

export type { ThemeChoice };

/**
 * Light, System or Dark, stored under `mcg.theme`. The inline script in index.html sets the first
 * value before Angular boots, this service keeps it in sync afterwards and follows the system live.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly query =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  private readonly systemDark = signal(this.query?.matches ?? false);

  readonly choice = signal<ThemeChoice>(
    (() => {
      const stored = storageGet('local', STORAGE_KEYS.theme);
      return isThemeChoice(stored) ? stored : 'system';
    })(),
  );
  readonly resolved = computed(() => resolveTheme(this.choice(), this.systemDark()));

  constructor() {
    this.query?.addEventListener('change', (event) => this.systemDark.set(event.matches));
    effect(() => document.documentElement.setAttribute('data-theme', this.resolved()));
  }

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    storageSet('local', STORAGE_KEYS.theme, choice);
  }
}
