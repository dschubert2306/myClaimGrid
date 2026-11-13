import { Injectable, computed, inject, signal } from '@angular/core';
import {
  isDatePreference,
  isTimePreference,
  resolveDateFormat,
  resolveTimeFormat,
  type DatePreference,
  type Formats,
  type TimePreference,
} from './date-format';
import { LanguageService } from './language.service';
import { STORAGE_KEYS, storageGet, storageSet } from './storage';

/**
 * Display preferences chosen in the settings: date and time format. "auto" follows the language.
 * Kept in the browser like language and theme, they are not part of the account data.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly language = inject(LanguageService);

  readonly datePreference = signal<DatePreference>(
    (() => {
      const stored = storageGet('local', STORAGE_KEYS.dateFormat);
      return isDatePreference(stored) ? stored : 'auto';
    })(),
  );
  readonly timePreference = signal<TimePreference>(
    (() => {
      const stored = storageGet('local', STORAGE_KEYS.timeFormat);
      return isTimePreference(stored) ? stored : 'auto';
    })(),
  );

  readonly dateFormat = computed(() =>
    resolveDateFormat(this.datePreference(), this.language.locale()),
  );
  readonly timeFormat = computed(() =>
    resolveTimeFormat(this.timePreference(), this.language.locale()),
  );
  /** Number locale and date pattern together, what the form helpers take. */
  readonly formats = computed<Formats>(() => ({
    locale: this.language.locale(),
    dateFormat: this.dateFormat(),
  }));

  setDate(preference: DatePreference): void {
    this.datePreference.set(preference);
    storageSet('local', STORAGE_KEYS.dateFormat, preference);
  }

  setTime(preference: TimePreference): void {
    this.timePreference.set(preference);
    storageSet('local', STORAGE_KEYS.timeFormat, preference);
  }
}
