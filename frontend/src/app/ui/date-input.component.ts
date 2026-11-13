import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  addDays,
  addMonths,
  datePlaceholder,
  formatIsoDate,
  monthGrid,
  splitIso,
  todayIso,
} from '../core/date-format';
import { LanguageService } from '../core/language.service';
import { parseDateInput } from '../core/parse-input';
import { PreferencesService } from '../core/preferences.service';
import { IconComponent } from './icon.component';
import { SelectComponent, type SelectOption } from './select.component';

const YEARS_BACK = 25;
const YEARS_AHEAD = 2;

/**
 * Date field: a text input in the chosen date format plus a calendar to pick from.
 * It is a form control whose value is the text as shown (the form parses it, so typing keeps working).
 * Keyboard: arrows move by day and week, Page Up and Page Down by month, Home and End to the week
 * start and end, Enter picks, Escape closes.
 */
@Component({
  selector: 'mcg-date-input',
  imports: [TranslocoPipe, IconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInputComponent), multi: true },
  ],
  host: {
    class: 'mcg-date',
    '(document:pointerdown)': 'onDocumentPointer($event)',
    '(keydown.escape)': 'onEscape($event)',
  },
  template: `
    <div class="mcg-input-wrap">
      <input
        #field
        class="mcg-input mcg-num mcg-input--date"
        autocomplete="off"
        inputmode="numeric"
        [attr.id]="inputId()"
        [placeholder]="placeholder()"
        [attr.aria-invalid]="invalid() ? true : null"
        [attr.aria-describedby]="describedBy()"
        [disabled]="disabled()"
        [value]="text()"
        (input)="onInput($any($event.target).value)"
        (blur)="onBlur()"
        (keydown.alt.arrowdown)="openCalendar(); $event.preventDefault()"
      />
      <button
        type="button"
        class="mcg-date__toggle"
        [disabled]="disabled()"
        [attr.aria-label]="'date.open' | transloco"
        aria-haspopup="dialog"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <mcg-icon name="calendar" />
      </button>
    </div>
    @if (open()) {
      <div class="mcg-date__pop" role="dialog" [attr.aria-label]="'date.choose' | transloco">
        <div class="mcg-date__head">
          <button
            type="button"
            class="mcg-date__nav"
            [attr.aria-label]="'date.prevMonth' | transloco"
            (click)="shiftMonth(-1)"
          >
            <mcg-icon name="chevron-left" />
          </button>
          <mcg-select
            [small]="true"
            [ariaLabel]="'date.month' | transloco"
            [options]="monthOptions()"
            [value]="'' + view().month"
            (valueChange)="setMonth(+($event ?? view().month))"
          />
          <mcg-select
            [small]="true"
            [ariaLabel]="'date.year' | transloco"
            [options]="yearOptions()"
            [value]="'' + view().year"
            (valueChange)="setYear(+($event ?? view().year))"
          />
          <button
            type="button"
            class="mcg-date__nav"
            [attr.aria-label]="'date.nextMonth' | transloco"
            (click)="shiftMonth(1)"
          >
            <mcg-icon name="chevron-right" />
          </button>
        </div>
        <div
          class="mcg-date__grid"
          role="grid"
          [attr.aria-label]="monthLabel()"
          (keydown)="onGridKey($event)"
        >
          <div class="mcg-date__row" role="row">
            @for (name of weekdays(); track $index) {
              <span class="mcg-date__weekday" role="columnheader">{{ name }}</span>
            }
          </div>
          @for (week of weeks(); track $index) {
            <div class="mcg-date__row" role="row">
              @for (cell of week; track cell.iso) {
                <button
                  type="button"
                  role="gridcell"
                  class="mcg-date__day"
                  [class.mcg-date__day--outside]="!cell.inMonth"
                  [class.mcg-date__day--today]="cell.iso === today"
                  [attr.aria-selected]="cell.iso === selectedIso() ? true : null"
                  [attr.aria-current]="cell.iso === today ? 'date' : null"
                  [attr.aria-label]="dayLabel(cell.iso)"
                  [attr.data-iso]="cell.iso"
                  [attr.tabindex]="cell.iso === focusIso() ? 0 : -1"
                  (click)="pick(cell.iso)"
                >
                  {{ cell.day }}
                </button>
              }
            </div>
          }
        </div>
        <div class="mcg-date__foot">
          <button type="button" class="mcg-date__link" (click)="pick(today)">
            {{ 'date.today' | transloco }}
          </button>
        </div>
      </div>
    }
  `,
})
export class DateInputComponent implements ControlValueAccessor {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly preferences = inject(PreferencesService);
  private readonly language = inject(LanguageService);

  readonly inputId = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly invalid = input(false);
  /** Fires when the text field loses focus (the form normalises the text there). */
  readonly blurred = output<void>();

  protected readonly text = signal('');
  protected readonly disabled = signal(false);
  protected readonly open = signal(false);
  protected readonly view = signal(splitIso(todayIso()));
  protected readonly focusIso = signal(todayIso());
  protected readonly today = todayIso();

  protected readonly placeholder = computed(() =>
    datePlaceholder(this.preferences.dateFormat(), this.language.lang()),
  );
  protected readonly selectedIso = computed(() =>
    parseDateInput(this.text(), this.preferences.dateFormat()),
  );
  protected readonly weeks = computed(() => {
    const { year, month } = this.view();
    const grid = monthGrid(year, month);
    return Array.from({ length: 6 }, (_, week) => grid.slice(week * 7, week * 7 + 7));
  });

  private readonly monthNames = computed(() => {
    const format = new Intl.DateTimeFormat(this.language.locale(), {
      month: 'long',
      timeZone: 'UTC',
    });
    return Array.from({ length: 12 }, (_, i) => format.format(Date.UTC(2026, i, 1)));
  });
  protected readonly monthOptions = computed<SelectOption[]>(() =>
    this.monthNames().map((label, i) => ({ value: String(i + 1), label })),
  );
  protected readonly yearOptions = computed<SelectOption[]>(() => {
    const current = new Date().getFullYear();
    const from = Math.min(current - YEARS_BACK, this.view().year);
    const to = Math.max(current + YEARS_AHEAD, this.view().year);
    return Array.from({ length: to - from + 1 }, (_, i) => ({
      value: String(to - i),
      label: String(to - i),
    }));
  });
  /** Monday first, as in Germany and the UK. 5 Jan 2026 is a Monday. */
  protected readonly weekdays = computed(() => {
    const format = new Intl.DateTimeFormat(this.language.locale(), {
      weekday: 'short',
      timeZone: 'UTC',
    });
    return Array.from({ length: 7 }, (_, i) => format.format(Date.UTC(2026, 0, 5 + i)));
  });
  protected readonly monthLabel = computed(
    () => `${this.monthNames()[this.view().month - 1]} ${this.view().year}`,
  );

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  // ---- ControlValueAccessor
  writeValue(value: string | null): void {
    this.text.set(value ?? '');
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
    if (disabled) this.open.set(false);
  }

  protected onInput(value: string): void {
    this.text.set(value);
    this.onChange(value);
  }

  protected onBlur(): void {
    this.onTouched();
    this.blurred.emit();
  }

  // ---- calendar
  protected toggle(): void {
    if (this.open()) this.closeCalendar(true);
    else this.openCalendar();
  }

  protected openCalendar(): void {
    if (this.disabled()) return;
    const start = this.selectedIso() ?? this.today;
    this.view.set(splitIso(start));
    this.focusIso.set(start);
    this.open.set(true);
    this.focusDay();
  }

  private closeCalendar(refocus: boolean): void {
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLElement>('input')?.focus();
  }

  protected pick(iso: string): void {
    this.text.set(formatIsoDate(iso, this.preferences.dateFormat()));
    this.onChange(this.text());
    this.onTouched();
    this.closeCalendar(true);
    this.blurred.emit(); // same as leaving a typed value: the form validates and normalises
  }

  protected shiftMonth(delta: number): void {
    this.moveTo(addMonths(this.focusIso(), delta), false);
  }
  protected setMonth(month: number): void {
    this.moveTo(this.withView(this.view().year, month), false);
  }
  protected setYear(year: number): void {
    this.moveTo(this.withView(year, this.view().month), false);
  }

  /** The focused day moved into another month, clamped to that month's length (31 -> 30). */
  private withView(year: number, month: number): string {
    const first = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    const lastDay = splitIso(addDays(addMonths(first, 1), -1)).day;
    const day = Math.min(splitIso(this.focusIso()).day, lastDay);
    return addDays(first, day - 1);
  }

  private moveTo(iso: string, focus: boolean): void {
    this.focusIso.set(iso);
    this.view.set(splitIso(iso));
    if (focus) this.focusDay();
  }

  private focusDay(): void {
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-iso="${this.focusIso()}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  protected onGridKey(event: KeyboardEvent): void {
    const current = this.focusIso();
    const weekday = (new Date(current + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
    const next: Record<string, string> = {
      ArrowLeft: addDays(current, -1),
      ArrowRight: addDays(current, 1),
      ArrowUp: addDays(current, -7),
      ArrowDown: addDays(current, 7),
      Home: addDays(current, -weekday),
      End: addDays(current, 6 - weekday),
      PageUp: addMonths(current, event.shiftKey ? -12 : -1),
      PageDown: addMonths(current, event.shiftKey ? 12 : 1),
    };
    const target = next[event.key];
    if (target) {
      event.preventDefault();
      this.moveTo(target, true);
    }
  }

  protected dayLabel(iso: string): string {
    const { year, month, day } = splitIso(iso);
    return new Intl.DateTimeFormat(this.language.locale(), {
      dateStyle: 'full',
      timeZone: 'UTC',
    }).format(Date.UTC(year, month - 1, day));
  }

  protected onEscape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation(); // closes the calendar, not the dialog around it
    this.closeCalendar(true);
  }

  protected onDocumentPointer(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.closeCalendar(false);
    }
  }
}
