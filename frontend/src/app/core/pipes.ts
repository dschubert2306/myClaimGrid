import { Pipe, type PipeTransform, inject } from '@angular/core';
import { formatAmount, formatInvoiceDate } from './format';
import { LanguageService } from './language.service';
import { PreferencesService } from './preferences.service';

/** Amount in cents -> "1.234,56 €" in the active language. Impure so it follows a language switch. */
@Pipe({ name: 'mcgCurrency', pure: false })
export class McgCurrencyPipe implements PipeTransform {
  private readonly language = inject(LanguageService);
  transform(cents: number | null | undefined): string {
    return cents === null || cents === undefined ? '' : formatAmount(cents, this.language.locale());
  }
}

/** ISO date -> "12.03.2026" in the date format of the settings. */
@Pipe({ name: 'mcgDate', pure: false })
export class McgDatePipe implements PipeTransform {
  private readonly preferences = inject(PreferencesService);
  transform(iso: string | null | undefined): string {
    return iso ? formatInvoiceDate(iso, this.preferences.dateFormat()) : '';
  }
}
