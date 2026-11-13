import { Injectable } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';

/** The texts are bundled (lazy chunks per language), so no request and no flash of missing keys. */
@Injectable({ providedIn: 'root' })
export class TranslocoBundleLoader implements TranslocoLoader {
  getTranslation(lang: string): Promise<Translation> {
    return lang === 'de'
      ? import('../../i18n/de.json').then((m) => m.default)
      : import('../../i18n/en.json').then((m) => m.default);
  }
}
