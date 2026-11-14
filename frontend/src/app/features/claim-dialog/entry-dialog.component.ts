import { A11yModule } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  isPaymentStatus,
  reimbursementStatusSchema,
  type Claim,
  type ReimbursementStatus,
} from '@myclaimgrid/shared';
import { firstValueFrom, type Subscription } from 'rxjs';
import { ApiClient } from '../../core/api.client';
import { todayIso } from '../../core/date-format';
import {
  ENTRY_FIELD_NAMES,
  entryPreview,
  suggestedAmount,
  toEntryRequest,
  type EntryErrorKey,
  type EntryFieldName,
} from '../../core/entry-form';
import { documentContentType } from '../../core/file-validation';
import { formatAmountPlain, formatInvoiceDate } from '../../core/format';
import { LanguageService } from '../../core/language.service';
import { McgCurrencyPipe } from '../../core/pipes';
import { PreferencesService } from '../../core/preferences.service';
import { ButtonComponent } from '../../ui/button.component';
import { DateInputComponent } from '../../ui/date-input.component';
import { DocumentPickerComponent } from '../../ui/document-picker.component';
import { FieldComponent } from '../../ui/field.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { ProgressComponent } from '../../ui/progress.component';

/** API error codes of the entry routes -> message keys. */
const ERROR_KEYS: Record<string, string> = {
  amount_above_invoice: 'errors.aboveInvoice',
  invalid_document: 'errors.invalidDocument',
  upload_missing: 'entry.saveFailed',
  conflict: 'errors.conflict',
};

/**
 * Adds one reimbursement history entry with its documents. Shown above the claim dialog (its own
 * scrim, focus trap and Escape). The files go to S3 first, the entry is saved last and references
 * them, so a failed upload never leaves a half entry behind.
 */
@Component({
  selector: 'mcg-entry-dialog',
  imports: [
    A11yModule,
    ReactiveFormsModule,
    TranslocoPipe,
    McgCurrencyPipe,
    ButtonComponent,
    DateInputComponent,
    DocumentPickerComponent,
    FieldComponent,
    IconComponent,
    NoticeComponent,
    ProgressComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mcg-scrim app-scrim app-scrim--nested" (keydown.escape)="onEscape($event)">
      <div
        class="mcg-dialog mcg-dialog--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-dialog-title"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
      >
        <div class="mcg-dialog__head">
          <h2 class="mcg-dialog__title" id="entry-dialog-title">{{ 'entry.title' | transloco }}</h2>
          <button
            mcg-button
            variant="ghost"
            [iconOnly]="true"
            [attr.aria-label]="'dialog.close' | transloco"
            (click)="cancel()"
          >
            <mcg-icon name="close" />
          </button>
        </div>

        <form
          class="mcg-dialog__body mcg-stack"
          id="entry-form"
          novalidate
          [formGroup]="form"
          (ngSubmit)="save()"
        >
          @if (error()) {
            <mcg-notice variant="error">{{ error()! | transloco }}</mcg-notice>
          }
          <div class="mcg-fields-2">
            <mcg-field [label]="'entry.status' | transloco" inputId="e-status">
              <span class="mcg-select app-select--full">
                <select id="e-status" formControlName="status" data-first-focus>
                  @for (status of statuses; track status) {
                    <option [value]="status">
                      {{ 'reimbursement.status.' + status | transloco }}
                    </option>
                  }
                </select>
              </span>
            </mcg-field>
            <mcg-field
              [label]="'entry.date' | transloco"
              inputId="e-date"
              [error]="errorText('date')"
            >
              <mcg-date-input
                inputId="e-date"
                formControlName="date"
                [invalid]="!!errorText('date')"
                [describedBy]="errorText('date') ? 'e-date-error' : null"
              />
            </mcg-field>
          </div>

          @if (pays()) {
            <div class="mcg-fields-2">
              <mcg-field
                [label]="'entry.reimbursedAmount' | transloco"
                inputId="e-reimbursedAmount"
                [hint]="'entry.reimbursedHint' | transloco"
                [error]="errorText('reimbursedAmount')"
              >
                <div class="mcg-input-wrap">
                  <input
                    id="e-reimbursedAmount"
                    class="mcg-input mcg-input--amount"
                    formControlName="reimbursedAmount"
                    autocomplete="off"
                    inputmode="decimal"
                    [attr.aria-invalid]="errorText('reimbursedAmount') ? true : null"
                    [attr.aria-describedby]="
                      errorText('reimbursedAmount') ? 'e-reimbursedAmount-error' : null
                    "
                    (blur)="normalize('reimbursedAmount')"
                  />
                  <span class="mcg-input-suffix" aria-hidden="true">€</span>
                </div>
              </mcg-field>
              <mcg-field
                [label]="'entry.rejectedAmount' | transloco"
                inputId="e-rejectedAmount"
                [hint]="'entry.rejectedHint' | transloco"
                [error]="errorText('rejectedAmount')"
              >
                <div class="mcg-input-wrap">
                  <input
                    id="e-rejectedAmount"
                    class="mcg-input mcg-input--amount"
                    formControlName="rejectedAmount"
                    autocomplete="off"
                    inputmode="decimal"
                    [attr.aria-invalid]="errorText('rejectedAmount') ? true : null"
                    [attr.aria-describedby]="
                      errorText('rejectedAmount') ? 'e-rejectedAmount-error' : null
                    "
                    (blur)="normalize('rejectedAmount')"
                  />
                  <span class="mcg-input-suffix" aria-hidden="true">€</span>
                </div>
              </mcg-field>
            </div>
            @if (preview(); as p) {
              <p class="mcg-field__hint" style="margin: 0" data-testid="entry-preview">
                {{
                  'entry.preview'
                    | transloco
                      : {
                          reimbursed: (p.reimbursed | mcgCurrency),
                          amount: (claim().amount | mcgCurrency),
                          difference: (p.difference | mcgCurrency),
                        }
                }}
              </p>
            }
          }

          <mcg-field
            [label]="'entry.note' | transloco"
            inputId="e-note"
            [error]="errorText('note')"
          >
            <textarea
              id="e-note"
              class="mcg-input"
              formControlName="note"
              maxlength="500"
              [placeholder]="'entry.notePlaceholder' | transloco"
            ></textarea>
          </mcg-field>

          <div class="mcg-field">
            <div class="mcg-field__head">
              <span class="mcg-label">{{ 'entry.documents' | transloco }}</span>
            </div>
            <mcg-document-picker [(files)]="files" [disabled]="saving()" />
          </div>

          @if (saving()) {
            <mcg-progress
              [label]="(phase() === 'uploading' ? 'entry.uploading' : 'entry.saving') | transloco"
              [percent]="phase() === 'uploading' ? uploadPercent() : null"
            />
          }
        </form>

        <div class="mcg-dialog__foot">
          <span class="mcg-topbar__spacer"></span>
          <button mcg-button [disabled]="saving()" (click)="cancel()">
            {{ 'dialog.cancel' | transloco }}
          </button>
          <button
            mcg-button
            variant="primary"
            type="submit"
            form="entry-form"
            [disabled]="saving()"
          >
            {{ 'entry.save' | transloco }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class EntryDialogComponent implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(TranslocoService);
  private readonly language = inject(LanguageService);
  private readonly preferences = inject(PreferencesService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The saved claim (status OPEN, with amount). */
  readonly claim = input.required<Claim & { amount: number }>();
  readonly saved = output<Claim>();
  readonly cancelled = output<void>();

  protected readonly statuses = reimbursementStatusSchema.options;
  protected readonly files = signal<File[]>([]);
  protected readonly saving = signal(false);
  protected readonly phase = signal<'uploading' | 'saving'>('uploading');
  protected readonly uploadPercent = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly submitted = signal(false);
  private work?: Subscription;

  protected readonly form = new FormGroup(
    Object.fromEntries(
      ENTRY_FIELD_NAMES.map((name) => [name, new FormControl('', { nonNullable: true })]),
    ) as Record<EntryFieldName, FormControl<string>>,
  );
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  protected readonly pays = computed(() =>
    isPaymentStatus((this.values().status ?? 'OPEN') as ReimbursementStatus),
  );
  private readonly context = computed(() => ({
    amount: this.claim().amount,
    entries: this.claim().reimbursement.entries,
  }));
  protected readonly preview = computed(() => {
    const v = this.values();
    return entryPreview(
      {
        status: v.status ?? 'OPEN',
        reimbursedAmount: v.reimbursedAmount ?? '',
        rejectedAmount: v.rejectedAmount ?? '',
      },
      this.language.locale(),
      this.context(),
    );
  });
  private readonly result = computed(() => {
    this.values();
    return toEntryRequest(this.form.getRawValue(), this.preferences.formats(), this.context());
  });

  constructor() {
    // Default: the next step after the current one, dated today.
    const next: Record<ReimbursementStatus, ReimbursementStatus> = {
      OPEN: 'IN_PROGRESS',
      IN_PROGRESS: 'PARTLY_PAID',
      PARTLY_PAID: 'PARTLY_PAID',
      PAID: 'PAID',
    };
    afterNextRender(
      () => {
        this.form.controls.date.setValue(
          formatInvoiceDate(todayIso(), this.preferences.dateFormat()),
        );
        // Last, so the prefill below is not overwritten by the other fields.
        this.form.controls.status.setValue(next[this.claim().reimbursement.status]);
        this.host.nativeElement.querySelector<HTMLElement>('[data-first-focus]')?.focus();
      },
      { injector: this.injector },
    );
    // A final payment is prefilled with what is left, the user can still change it.
    this.form.controls.status.valueChanges.subscribe((status) => {
      const amount = suggestedAmount(status as ReimbursementStatus, this.context());
      const control = this.form.controls.reimbursedAmount;
      if (amount !== null && control.value.trim() === '') {
        control.setValue(formatAmountPlain(amount, this.language.locale()));
      }
    });
  }

  ngOnDestroy(): void {
    this.work?.unsubscribe();
  }

  protected errorText(name: EntryFieldName): string | null {
    this.language.lang();
    const control = this.form.controls[name];
    const result = this.result();
    if (result.ok || !(control.touched || this.submitted())) return null;
    const key: EntryErrorKey | undefined = result.errors[name];
    return key ? this.i18n.translate(`errors.${key}`) : null;
  }

  protected normalize(name: 'reimbursedAmount' | 'rejectedAmount'): void {
    this.form.controls[name].markAsTouched();
  }

  protected onEscape(event: Event): void {
    event.stopPropagation(); // the claim dialog behind stays open
    this.cancel();
  }

  protected cancel(): void {
    if (this.saving()) return;
    this.cancelled.emit();
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const result = this.result();
    if (!result.ok) return;

    const claimId = this.claim().claimId;
    const files = this.files();
    this.saving.set(true);
    this.error.set(null);
    this.phase.set('uploading');
    this.uploadPercent.set(0);
    try {
      const documents: { uploadId: string; fileName: string }[] = [];
      for (const [index, file] of files.entries()) {
        const contentType = documentContentType(file);
        if (!contentType) throw new Error('type');
        const { uploadId, upload } = await firstValueFrom(
          this.api.createDocumentUpload(claimId, { contentType, size: file.size }),
        );
        // The presigned POST pins the content type, the browser must send the same one.
        const typed =
          file.type === contentType ? file : new File([file], file.name, { type: contentType });
        await new Promise<void>((resolve, reject) => {
          this.work = this.api.uploadToS3(upload, typed).subscribe({
            next: (event) => {
              if (event.kind === 'progress') {
                this.uploadPercent.set(
                  Math.round(((index + event.percent / 100) / files.length) * 100),
                );
              }
            },
            error: reject,
            complete: resolve,
          });
        });
        documents.push({ uploadId, fileName: file.name });
      }
      this.phase.set('saving');
      const claim = await firstValueFrom(
        this.api.addEntry(claimId, { ...result.request, documents }),
      );
      this.saved.emit(claim);
    } catch (error) {
      const code =
        error instanceof HttpErrorResponse
          ? error.status === 409
            ? 'conflict'
            : (error.error?.error?.code as string | undefined)
          : undefined;
      this.error.set((code && ERROR_KEYS[code]) || 'entry.saveFailed');
      this.saving.set(false);
    }
  }
}
