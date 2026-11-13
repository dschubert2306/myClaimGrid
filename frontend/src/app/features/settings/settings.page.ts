import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Person } from '@myclaimgrid/shared';
import { DashboardStore } from '../../core/dashboard.store';
import {
  DATE_FORMATS,
  TIME_FORMATS,
  isDatePreference,
  isTimePreference,
  formatIsoDate,
  formatTime,
  resolveDateFormat,
  resolveTimeFormat,
  type DatePreference,
  type TimePreference,
} from '../../core/date-format';
import { formatAmountPlain } from '../../core/format';
import { LanguageService } from '../../core/language.service';
import { parseDeductibleInput } from '../../core/parse-input';
import { PreferencesService } from '../../core/preferences.service';
import { ButtonComponent } from '../../ui/button.component';
import { FieldComponent } from '../../ui/field.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { ProgressComponent } from '../../ui/progress.component';
import { SelectComponent, type SelectOption } from '../../ui/select.component';

interface Draft {
  name: string;
  deductible: string;
}
type NameError = 'required' | 'maxLength';

const SAMPLE_DATE = '2026-03-12';
const SAMPLE_TIME = new Date(2026, 2, 12, 14, 30);

/**
 * Settings: names and Selbstbehalt of the three persons (saved to the account), and the date and
 * time format (kept in this browser, like language and theme).
 */
@Component({
  selector: 'mcg-settings-page',
  imports: [
    TranslocoPipe,
    RouterLink,
    ButtonComponent,
    FieldComponent,
    IconComponent,
    NoticeComponent,
    ProgressComponent,
    SelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-page' },
  template: `
    <div class="app-page__head">
      <h1 class="mcg-type-title-1" style="margin: 0">{{ 'settings.title' | transloco }}</h1>
      <button mcg-button routerLink="/">
        <mcg-icon name="arrow-left" />{{ 'settings.back' | transloco }}
      </button>
    </div>

    <section class="app-card" aria-labelledby="settings-persons">
      <h2 id="settings-persons" class="app-card__title">
        {{ 'settings.persons.title' | transloco }}
      </h2>
      <p class="mcg-muted app-card__text">{{ 'settings.persons.text' | transloco }}</p>

      @switch (status()) {
        @case ('loading') {
          <mcg-progress [label]="'dashboard.loading' | transloco" [percent]="null" />
        }
        @case ('error') {
          <mcg-notice variant="error">
            {{ 'dashboard.loadError' | transloco }}
            <button mcg-button size="sm" style="margin-left: var(--space-2)" (click)="load()">
              {{ 'dashboard.retry' | transloco }}
            </button>
          </mcg-notice>
        }
        @default {
          <form class="mcg-stack" novalidate (submit)="$event.preventDefault(); save()">
            @for (person of persons(); track person.personId) {
              <div class="app-person-row" [style.--person]="'var(--' + person.color + ')'">
                <mcg-field
                  [label]="'settings.persons.name' | transloco"
                  [inputId]="'s-name-' + person.personId"
                  [error]="nameError(person.personId)"
                >
                  <input
                    class="mcg-input"
                    maxlength="60"
                    autocomplete="off"
                    [id]="'s-name-' + person.personId"
                    [value]="draft(person.personId).name"
                    [attr.aria-invalid]="nameError(person.personId) ? true : null"
                    [attr.aria-describedby]="
                      nameError(person.personId) ? 's-name-' + person.personId + '-error' : null
                    "
                    (input)="edit(person.personId, 'name', $any($event.target).value)"
                  />
                </mcg-field>
                <mcg-field
                  [label]="'settings.persons.deductible' | transloco"
                  [inputId]="'s-ded-' + person.personId"
                  [hint]="'settings.persons.deductibleHint' | transloco"
                  [error]="deductibleError(person.personId)"
                >
                  <div class="mcg-input-wrap">
                    <input
                      class="mcg-input mcg-input--amount"
                      inputmode="decimal"
                      autocomplete="off"
                      [id]="'s-ded-' + person.personId"
                      [value]="draft(person.personId).deductible"
                      [attr.aria-invalid]="deductibleError(person.personId) ? true : null"
                      [attr.aria-describedby]="
                        deductibleError(person.personId)
                          ? 's-ded-' + person.personId + '-error'
                          : null
                      "
                      (input)="edit(person.personId, 'deductible', $any($event.target).value)"
                    />
                    <span class="mcg-input-suffix" aria-hidden="true">€</span>
                  </div>
                </mcg-field>
              </div>
            }
            @if (saveFailed()) {
              <mcg-notice variant="error">{{
                'settings.persons.saveError' | transloco
              }}</mcg-notice>
            }
            @if (saved()) {
              <mcg-notice>{{ 'settings.persons.saved' | transloco }}</mcg-notice>
            }
            <div class="mcg-row">
              <button mcg-button variant="primary" type="submit" [disabled]="saving() || !dirty()">
                {{ 'settings.persons.save' | transloco }}
              </button>
            </div>
          </form>
        }
      }
    </section>

    <section class="app-card" aria-labelledby="settings-format">
      <h2 id="settings-format" class="app-card__title">
        {{ 'settings.format.title' | transloco }}
      </h2>
      <p class="mcg-muted app-card__text">{{ 'settings.format.text' | transloco }}</p>
      <div class="mcg-fields-2">
        <mcg-field [label]="'settings.format.date' | transloco" inputId="s-date-format">
          <mcg-select
            inputId="s-date-format"
            [options]="dateOptions()"
            [value]="preferences.datePreference()"
            (valueChange)="setDate($event)"
          />
        </mcg-field>
        <mcg-field [label]="'settings.format.time' | transloco" inputId="s-time-format">
          <mcg-select
            inputId="s-time-format"
            [options]="timeOptions()"
            [value]="preferences.timePreference()"
            (valueChange)="setTime($event)"
          />
        </mcg-field>
      </div>
      <p class="app-card__preview">
        <span class="mcg-label">{{ 'settings.format.preview' | transloco }}</span>
        <span class="mcg-num">{{ preview() }}</span>
      </p>
    </section>
  `,
})
export class SettingsPage {
  protected readonly preferences = inject(PreferencesService);
  private readonly store = inject(DashboardStore);
  private readonly language = inject(LanguageService);
  private readonly i18n = inject(TranslocoService);

  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly persons = this.store.persons;
  private readonly drafts = signal<Record<string, Draft>>({});
  private readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly saveFailed = signal(false);

  protected readonly dirty = computed(() =>
    this.persons().some((p) => {
      const d = this.drafts()[p.personId];
      return d !== undefined && (d.name !== p.name || d.deductible !== this.deductibleText(p));
    }),
  );

  protected readonly dateOptions = computed<SelectOption[]>(() => {
    this.language.lang(); // labels follow the language
    const auto = resolveDateFormat('auto', this.language.locale());
    return [
      {
        value: 'auto',
        label: `${this.i18n.translate('settings.format.auto')} (${formatIsoDate(SAMPLE_DATE, auto)})`,
      },
      ...DATE_FORMATS.map((format) => ({
        value: format,
        label: `${formatIsoDate(SAMPLE_DATE, format)}  (${format})`,
      })),
    ];
  });
  protected readonly timeOptions = computed<SelectOption[]>(() => {
    this.language.lang();
    const auto = resolveTimeFormat('auto', this.language.locale());
    return [
      {
        value: 'auto',
        label: `${this.i18n.translate('settings.format.auto')} (${formatTime(SAMPLE_TIME, auto)})`,
      },
      ...TIME_FORMATS.map((format) => ({
        value: format,
        label: `${this.i18n.translate(`settings.format.${format}`)} (${formatTime(SAMPLE_TIME, format)})`,
      })),
    ];
  });
  protected readonly preview = computed(
    () =>
      `${formatIsoDate(SAMPLE_DATE, this.preferences.dateFormat())}, ${formatTime(SAMPLE_TIME, this.preferences.timeFormat())}`,
  );

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    try {
      await this.store.ensurePersons();
      this.resetDrafts();
      this.status.set('ready');
    } catch {
      this.status.set('error');
    }
  }

  private deductibleText(person: Person): string {
    return person.deductible > 0
      ? formatAmountPlain(person.deductible, this.language.locale())
      : '';
  }

  private resetDrafts(): void {
    this.drafts.set(
      Object.fromEntries(
        this.persons().map((p) => [
          p.personId,
          { name: p.name, deductible: this.deductibleText(p) },
        ]),
      ),
    );
  }

  protected draft(personId: string): Draft {
    return this.drafts()[personId] ?? { name: '', deductible: '' };
  }

  protected edit(personId: string, field: keyof Draft, value: string): void {
    this.saved.set(false);
    this.drafts.update((all) => ({
      ...all,
      [personId]: { ...this.draft(personId), [field]: value },
    }));
  }

  private nameProblem(name: string): NameError | null {
    const trimmed = name.trim();
    if (trimmed === '') return 'required';
    return trimmed.length > 60 ? 'maxLength' : null;
  }

  protected nameError(personId: string): string | null {
    this.language.lang();
    if (!this.submitted()) return null;
    const key = this.nameProblem(this.draft(personId).name);
    return key ? this.i18n.translate(`errors.${key}`) : null;
  }

  protected deductibleError(personId: string): string | null {
    this.language.lang();
    if (!this.submitted()) return null;
    const cents = parseDeductibleInput(this.draft(personId).deductible, this.language.locale());
    return cents === null ? this.i18n.translate('settings.persons.deductibleInvalid') : null;
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.submitted.set(true);
    this.saved.set(false);
    this.saveFailed.set(false);
    const locale = this.language.locale();

    const changes: { personId: string; name: string; deductible: number }[] = [];
    for (const person of this.persons()) {
      const d = this.draft(person.personId);
      const deductible = parseDeductibleInput(d.deductible, locale);
      if (this.nameProblem(d.name) || deductible === null) return; // errors are shown under the fields
      if (d.name.trim() !== person.name || deductible !== person.deductible) {
        changes.push({ personId: person.personId, name: d.name.trim(), deductible });
      }
    }

    this.saving.set(true);
    try {
      for (const change of changes) {
        await this.store.savePerson(change.personId, {
          name: change.name,
          deductible: change.deductible,
        });
      }
      this.resetDrafts();
      this.submitted.set(false);
      this.saved.set(true);
    } catch {
      this.saveFailed.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  protected setDate(value: string | null): void {
    if (isDatePreference(value)) this.preferences.setDate(value as DatePreference);
  }

  protected setTime(value: string | null): void {
    if (isTimePreference(value)) this.preferences.setTime(value as TimePreference);
  }
}
