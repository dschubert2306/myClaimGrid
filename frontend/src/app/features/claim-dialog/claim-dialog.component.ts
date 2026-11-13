import { A11yModule } from '@angular/cdk/a11y';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, type ValidationErrors } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ClaimDetail } from '@myclaimgrid/shared';
import { firstValueFrom, take, type Subscription } from 'rxjs';
import { ApiClient } from '../../core/api.client';
import {
  CLAIM_FIELD_NAMES,
  EMPTY_CLAIM_FORM,
  fieldMarkers,
  fromClaim,
  toClaimFields,
  validateField,
  type ClaimFieldName,
} from '../../core/claim-form';
import { DashboardStore } from '../../core/dashboard.store';
import { formatAmountPlain, formatInvoiceDate } from '../../core/format';
import { LanguageService } from '../../core/language.service';
import { parseAmountInput, parseDateInput } from '../../core/parse-input';
import { ButtonComponent } from '../../ui/button.component';
import { DropzoneComponent } from '../../ui/dropzone.component';
import { FieldComponent } from '../../ui/field.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { ProgressComponent } from '../../ui/progress.component';
import { SelectComponent } from '../../ui/select.component';
import { StatusBadgeComponent } from '../../ui/status-badge.component';
import { CLAIM_DIALOG_DATA, ClaimDialogRef } from './claim-dialog.tokens';

type Step = 'choose' | 'reading' | 'review';
type Mode = 'upload' | 'manual';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The claim dialog: choose person and entry mode, upload and wait for the extraction, review and save.
 * The same review step edits an existing claim. Layout and states follow design-system/components/Dialog.
 */
@Component({
  selector: 'mcg-claim-dialog',
  imports: [
    A11yModule,
    NgTemplateOutlet,
    ReactiveFormsModule,
    TranslocoPipe,
    ButtonComponent,
    DropzoneComponent,
    FieldComponent,
    IconComponent,
    NoticeComponent,
    ProgressComponent,
    SelectComponent,
    StatusBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './claim-dialog.component.html',
})
export class ClaimDialogComponent implements OnDestroy {
  private readonly data = inject(CLAIM_DIALOG_DATA);
  private readonly ref = inject(ClaimDialogRef);
  private readonly api = inject(ApiClient);
  private readonly store = inject(DashboardStore);
  private readonly language = inject(LanguageService);
  private readonly i18n = inject(TranslocoService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly isEdit = !!this.data.claimId;
  protected readonly mode = signal<Mode>('upload');
  protected readonly step = signal<Step>(this.isEdit ? 'review' : 'choose');
  protected readonly loadingExisting = signal(this.isEdit);
  protected readonly personId = signal<string | null>(null);
  protected readonly file = signal<File | null>(null);
  protected readonly chooseSubmitted = signal(false);
  protected readonly phase = signal<'uploading' | 'extracting'>('uploading');
  protected readonly uploadPercent = signal(0);
  protected readonly claim = signal<ClaimDetail | null>(null);
  protected readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  protected readonly extractionFailed = signal(false);
  protected readonly extractedFields = signal<ClaimFieldName[]>([]);
  protected readonly missingFields = signal<ClaimFieldName[]>([]);
  protected readonly error = signal<string | null>(null); // translation key
  protected readonly saving = signal(false);
  protected readonly confirm = signal<'discard' | 'delete' | null>(null);
  protected readonly formSubmitted = signal(false);

  /** Draft created by this dialog (upload mode). Cancelling deletes it, an existing claim is never deleted by cancel. */
  private draftId: string | null = null;
  private work?: Subscription;
  private closing = false;

  protected readonly form = new FormGroup(
    Object.fromEntries(
      CLAIM_FIELD_NAMES.map((name) => [
        name,
        new FormControl('', {
          nonNullable: true,
          validators: [
            (control): ValidationErrors | null => {
              const key = validateField(name, control.value, this.language.locale());
              return key ? { [key]: true } : null;
            },
          ],
        }),
      ]),
    ) as Record<ClaimFieldName, FormControl<string>>,
  );
  private readonly formEvents = toSignal(this.form.events);

  protected readonly persons = this.store.persons;
  protected readonly personOptions = computed(() =>
    this.persons().map((p) => ({ value: p.personId, label: p.name })),
  );
  protected readonly personName = computed(() => {
    const id = this.claim()?.personId ?? this.personId();
    return this.persons().find((p) => p.personId === id)?.name ?? '';
  });

  protected readonly showPdf = computed(() => this.pdfUrl() !== null);
  /** Entry step and manual mode are narrow (560px), the review with a PDF is wide. */
  protected readonly narrow = computed(() => this.step() !== 'review' || !this.showPdf());
  protected readonly title = computed(() => (this.isEdit ? 'dialog.editTitle' : 'dialog.newTitle'));
  protected readonly steps = computed(() =>
    this.mode() === 'upload'
      ? ['dialog.steps.type', 'dialog.steps.reading', 'dialog.steps.review']
      : ['dialog.steps.type', 'dialog.steps.review'],
  );
  protected readonly stepIndex = computed(() => {
    const order: Step[] =
      this.mode() === 'upload' ? ['choose', 'reading', 'review'] : ['choose', 'review'];
    return order.indexOf(this.step());
  });
  protected readonly canGoBack = computed(
    () => !this.isEdit && this.mode() === 'manual' && this.step() === 'review',
  );
  protected readonly personError = computed(() =>
    this.chooseSubmitted() && !this.personId() ? this.i18n.translate('errors.person') : null,
  );
  protected readonly fileError = computed(() =>
    this.chooseSubmitted() && this.mode() === 'upload' && !this.file()
      ? this.i18n.translate('errors.file')
      : null,
  );

  constructor() {
    this.focusFirst();
    if (this.data.claimId) void this.loadExisting(this.data.claimId);
  }

  ngOnDestroy(): void {
    this.closing = true;
    this.work?.unsubscribe();
  }

  // ------------------------------------------------------------ choose step

  protected next(): void {
    this.chooseSubmitted.set(true);
    if (!this.personId()) return;
    if (this.mode() === 'upload') {
      if (this.file()) void this.startUpload();
      return;
    }
    this.step.set('review');
    this.focusFirst();
  }

  protected back(): void {
    this.step.set('choose');
    this.focusFirst();
  }

  private async startUpload(): Promise<void> {
    const personId = this.personId();
    const file = this.file();
    if (!personId || !file) return;
    this.step.set('reading');
    this.phase.set('uploading');
    this.uploadPercent.set(0);
    this.error.set(null);
    try {
      const created = await firstValueFrom(this.api.createUpload(personId));
      this.draftId = created.claim.claimId;
      await new Promise<void>((resolve, reject) => {
        this.work = this.api.uploadToS3(created.upload, file).subscribe({
          next: (event) => event.kind === 'progress' && this.uploadPercent.set(event.percent),
          error: reject,
          complete: resolve,
        });
      });
      this.phase.set('extracting');
      this.showExtraction(await this.waitForExtraction(created.claim.claimId));
    } catch {
      if (!this.closing) await this.failUpload();
    }
  }

  /** Polls every 1.5 s for up to 60 s. A timeout is treated like a failed extraction. */
  private async waitForExtraction(claimId: string): Promise<ClaimDetail> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let failures = 0;
    let latest: ClaimDetail | null = null;
    while (Date.now() < deadline) {
      if (this.closing) throw new Error('closed');
      try {
        latest = await firstValueFrom(this.api.claim(claimId));
        failures = 0;
        if (latest.extractionStatus !== 'PENDING') return latest;
      } catch (error) {
        if (++failures >= 3) throw error;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return latest ?? (await firstValueFrom(this.api.claim(claimId)));
  }

  private async failUpload(): Promise<void> {
    await this.deleteDraft();
    this.step.set('choose');
    this.error.set('errors.uploadFailed');
    this.focusFirst();
  }

  private showExtraction(claim: ClaimDetail): void {
    const failed = claim.extractionStatus !== 'DONE';
    this.claim.set(claim);
    this.setPdf(claim.pdfUrl);
    this.extractionFailed.set(failed);
    this.fill(failed ? EMPTY_CLAIM_FORM : fromClaim(claim, this.language.locale()));
    const markers = failed ? { extracted: [], missing: [] } : fieldMarkers(claim);
    this.extractedFields.set(markers.extracted);
    this.missingFields.set(markers.missing);
    // The tags disappear as soon as the user edits the field.
    for (const name of [...markers.extracted, ...markers.missing]) {
      this.form.controls[name].valueChanges
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          this.extractedFields.update((list) => list.filter((n) => n !== name));
          this.missingFields.update((list) => list.filter((n) => n !== name));
        });
    }
    this.step.set('review');
    this.focusFirst();
  }

  // ------------------------------------------------------------ existing claim

  private async loadExisting(claimId: string): Promise<void> {
    try {
      const claim = await firstValueFrom(this.api.claim(claimId));
      this.claim.set(claim);
      this.personId.set(claim.personId);
      this.setPdf(claim.pdfUrl);
      this.fill(fromClaim(claim, this.language.locale()));
      this.focusFirst();
    } catch {
      this.error.set('errors.loadClaimFailed');
    } finally {
      this.loadingExisting.set(false);
    }
  }

  // ------------------------------------------------------------ review step

  protected tagFor(name: ClaimFieldName): 'extracted' | 'missing' | null {
    if (this.extractedFields().includes(name)) return 'extracted';
    if (this.missingFields().includes(name)) return 'missing';
    return null;
  }

  /** Error text after blur or submit, one sentence that says what to enter. */
  protected errorText(name: ClaimFieldName): string | null {
    this.formEvents(); // re-evaluated when the form changes
    this.language.lang();
    const control = this.form.controls[name];
    if (!(control.touched || this.formSubmitted()) || !control.errors) return null;
    const key = Object.keys(control.errors)[0];
    return key ? this.i18n.translate(`errors.${key}`) : null;
  }

  protected describedBy(name: ClaimFieldName): string | null {
    return this.errorText(name) ? `f-${name}-error` : null;
  }

  /** Shows what was typed in the format of the language once the field is left. */
  protected normalize(name: 'invoiceDate' | 'amount'): void {
    const control = this.form.controls[name];
    const locale = this.language.locale();
    if (name === 'amount') {
      const cents = parseAmountInput(control.value, locale);
      if (cents !== null) control.setValue(formatAmountPlain(cents, locale), { emitEvent: false });
    } else {
      const iso = parseDateInput(control.value, locale);
      if (iso !== null) control.setValue(formatInvoiceDate(iso, locale), { emitEvent: false });
    }
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.formSubmitted.set(true);
    this.form.markAllAsTouched();
    const result = toClaimFields(this.form.getRawValue(), this.language.locale());
    if (!result.ok) {
      const first = CLAIM_FIELD_NAMES.find((name) => result.errors[name]);
      if (first) this.host.nativeElement.querySelector<HTMLElement>(`#f-${first}`)?.focus();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const existing = this.claim();
      if (existing) {
        await firstValueFrom(this.api.saveClaim(existing.claimId, result.fields));
      } else {
        await firstValueFrom(
          this.api.createClaim({ personId: this.personId() as string, ...result.fields }),
        );
      }
      this.draftId = null; // saved, nothing left to discard
      this.finish('saved');
    } catch {
      this.error.set('errors.saveFailed');
      this.saving.set(false);
    }
  }

  protected async deleteClaim(): Promise<void> {
    const existing = this.claim();
    if (!existing || this.saving()) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.deleteClaim(existing.claimId));
      this.finish('deleted');
    } catch {
      this.confirm.set(null);
      this.error.set('errors.deleteFailed');
      this.saving.set(false);
    }
  }

  // ------------------------------------------------------------ closing

  protected onEscape(event: Event): void {
    event.stopPropagation();
    if (this.confirm() !== null) this.confirm.set(null);
    else this.requestClose();
  }

  /** Cancel, Escape and the close button. Asks once if the user has edited fields. */
  protected requestClose(): void {
    if (this.saving()) return;
    const hasEdits = this.step() === 'review' && this.form.dirty;
    if (hasEdits && this.confirm() === null) {
      this.confirm.set('discard');
      return;
    }
    void this.discardAndClose();
  }

  protected async discardAndClose(): Promise<void> {
    this.closing = true;
    this.work?.unsubscribe();
    await this.deleteDraft();
    this.ref.close('cancelled');
  }

  private async deleteDraft(): Promise<void> {
    const id = this.draftId;
    this.draftId = null;
    if (!id) return;
    try {
      await firstValueFrom(this.api.deleteClaim(id));
    } catch {
      /* best effort, the draft never appears on the dashboard */
    }
  }

  private finish(result: 'saved' | 'deleted'): void {
    this.closing = true;
    this.ref.close(result);
  }

  // ------------------------------------------------------------ helpers

  private fill(values: Record<ClaimFieldName, string>): void {
    this.form.reset(values, { emitEvent: false });
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private setPdf(url: string | null): void {
    this.pdfUrl.set(url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null);
  }

  private focusFirst(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[data-first-focus]')?.focus(),
      { injector: this.injector },
    );
  }
}
