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
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  isPaymentStatus,
  reimbursementStatusSchema,
  type ClaimDetail,
  type InsurerDocument,
} from '@myclaimgrid/shared';
import { firstValueFrom, take, type Subscription } from 'rxjs';
import { ApiClient } from '../../core/api.client';
import {
  CLAIM_FIELD_NAMES,
  EMPTY_CLAIM_FORM,
  fieldMarkers,
  fromClaim,
  newestFirst,
  paymentDateAfterToggle,
  reimbursementDateFor,
  reimbursementPreview,
  showsReimbursementDetails,
  suggestedReimbursement,
  toClaimRequest,
  type ClaimFieldName,
  type ClaimFormValues,
} from '../../core/claim-form';
import { DashboardStore } from '../../core/dashboard.store';
import { documentContentType } from '../../core/file-validation';
import { formatAmountPlain, formatInvoiceDate } from '../../core/format';
import { LanguageService } from '../../core/language.service';
import { McgCurrencyPipe, McgDatePipe } from '../../core/pipes';
import { parseAmountInput, parseDateInput } from '../../core/parse-input';
import { PreferencesService } from '../../core/preferences.service';
import { saveErrorKey } from '../../core/save-error';
import { ButtonComponent } from '../../ui/button.component';
import { DateInputComponent } from '../../ui/date-input.component';
import { DocumentPickerComponent } from '../../ui/document-picker.component';
import { DropzoneComponent } from '../../ui/dropzone.component';
import { FieldComponent } from '../../ui/field.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { ProgressComponent } from '../../ui/progress.component';
import { SelectComponent } from '../../ui/select.component';
import { StatusBadgeComponent } from '../../ui/status-badge.component';
import { ReimbursementBadgeComponent } from '../../ui/tracking-badges.component';
import { CLAIM_DIALOG_DATA, ClaimDialogRef } from './claim-dialog.tokens';

type FormControls = Record<ClaimFieldName, FormControl<string>> & { paid: FormControl<boolean> };
type Busy = 'idle' | 'uploadingInvoice' | 'extracting' | 'uploadingDocuments' | 'saving';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The fields an invoice PDF can fill. Fields the user has already filled in are left alone. */
const EXTRACTED_FIELDS = [
  'provider',
  'invoiceNumber',
  'invoiceDate',
  'amount',
  'description',
] as const;

/**
 * The claim dialog: everything about one claim in one place, for a new claim and for an existing
 * one. Invoice data (optionally read from a PDF), submission, reimbursement with its history,
 * payment, and the insurer documents. One primary action saves it all in a single request.
 * Layout and states follow design-system/components/Dialog.
 */
@Component({
  selector: 'mcg-claim-dialog',
  imports: [
    A11yModule,
    NgTemplateOutlet,
    ReactiveFormsModule,
    TranslocoPipe,
    McgCurrencyPipe,
    McgDatePipe,
    ButtonComponent,
    DateInputComponent,
    DocumentPickerComponent,
    DropzoneComponent,
    FieldComponent,
    IconComponent,
    NoticeComponent,
    ProgressComponent,
    ReimbursementBadgeComponent,
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
  private readonly preferences = inject(PreferencesService);
  private readonly i18n = inject(TranslocoService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly isEdit = !!this.data.claimId;
  protected readonly statuses = reimbursementStatusSchema.options;
  protected readonly loadingExisting = signal(this.isEdit);
  protected readonly personId = signal<string | null>(null);
  /** The saved claim being edited, or the draft that an invoice upload created for a new claim. */
  protected readonly claim = signal<ClaimDetail | null>(null);
  protected readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  protected readonly extractionFailed = signal(false);
  protected readonly extractedFields = signal<ClaimFieldName[]>([]);
  protected readonly missingFields = signal<ClaimFieldName[]>([]);
  protected readonly busy = signal<Busy>('idle');
  protected readonly uploadPercent = signal(0);
  protected readonly error = signal<string | null>(null); // translation key
  protected readonly confirm = signal<'discard' | 'delete' | null>(null);
  protected readonly submitted = signal(false);
  protected readonly personMissing = signal(false);
  private readonly invoiceDropzone = viewChild(DropzoneComponent);
  /** Insurer documents chosen but not saved yet, and stored ones marked for removal. */
  protected readonly files = signal<File[]>([]);
  protected readonly removedIds = signal<string[]>([]);

  /** Draft created by this dialog (invoice upload). Cancelling deletes it, a saved claim never. */
  private draftId: string | null = null;
  private work?: Subscription;
  private closing = false;
  /** The form as it was when the claim was opened: what "changed" is measured against. */
  private baseline: ClaimFormValues = EMPTY_CLAIM_FORM;

  protected readonly form = new FormGroup({
    ...Object.fromEntries(
      CLAIM_FIELD_NAMES.map((name) => [name, new FormControl('', { nonNullable: true })]),
    ),
    paid: new FormControl(false, { nonNullable: true }),
  }) as unknown as FormGroup<FormControls>;
  /** Bumped on every change of the form, so what is derived from it recomputes. */
  private readonly revision = signal(0);
  protected readonly values = computed(() => {
    this.revision();
    return this.form.getRawValue() as ClaimFormValues;
  });

  protected readonly persons = this.store.persons;
  protected readonly personOptions = computed(() =>
    this.persons().map((p) => ({ value: p.personId, label: p.name })),
  );
  protected readonly personName = computed(() => {
    const id = this.claim()?.personId ?? this.personId();
    return this.persons().find((p) => p.personId === id)?.name ?? '';
  });

  private readonly entries = computed(() => this.claim()?.reimbursement.entries ?? []);
  protected readonly history = computed(() => newestFirst(this.entries()));
  protected readonly pays = computed(() => {
    const status = reimbursementStatusSchema.safeParse(this.values().status);
    return status.success && isPaymentStatus(status.data);
  });
  protected readonly details = computed(() =>
    showsReimbursementDetails(this.values().status, this.entries()),
  );
  protected readonly preview = computed(() =>
    reimbursementPreview(this.values(), this.language.locale()),
  );
  protected readonly result = computed(() =>
    toClaimRequest(this.values(), this.preferences.formats(), this.entries()),
  );
  /** Stored documents without the ones that are removed once the claim is saved. */
  protected readonly documents = computed(() =>
    (this.claim()?.documents ?? []).filter((d) => !this.removedIds().includes(d.documentId)),
  );

  protected readonly showPdf = computed(() => this.pdfUrl() !== null);
  protected readonly narrow = computed(() => !this.showPdf());
  protected readonly title = computed(() => (this.isEdit ? 'dialog.editTitle' : 'dialog.newTitle'));
  protected readonly working = computed(() => this.busy() !== 'idle');
  protected readonly readingInvoice = computed(
    () => this.busy() === 'uploadingInvoice' || this.busy() === 'extracting',
  );
  protected readonly personError = computed(() =>
    this.personMissing() && !this.personId() ? this.i18n.translate('errors.person') : null,
  );

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.revision.update((n) => n + 1));
    this.fill(EMPTY_CLAIM_FORM);
    this.focusFirst();
    if (this.data.claimId) void this.loadExisting(this.data.claimId);
  }

  ngOnDestroy(): void {
    this.closing = true;
    this.work?.unsubscribe();
  }

  // ------------------------------------------------------------ invoice PDF

  /** The optional invoice PDF of a new claim: upload it, wait for the extraction, fill the form. */
  protected async onInvoiceFile(file: File | null): Promise<void> {
    if (!file || this.claim()) return;
    const personId = this.personId();
    if (!personId) {
      // Nothing is uploaded without a person: ask for one, the file can be chosen again.
      this.personMissing.set(true);
      this.invoiceDropzone()?.clear();
      return;
    }
    this.busy.set('uploadingInvoice');
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
      this.busy.set('extracting');
      this.showExtraction(await this.waitForExtraction(created.claim.claimId));
    } catch {
      if (!this.closing) await this.failInvoiceUpload();
    }
    if (!this.closing) this.busy.set('idle');
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

  private async failInvoiceUpload(): Promise<void> {
    await this.deleteDraft();
    this.error.set('errors.uploadFailed');
  }

  private showExtraction(claim: ClaimDetail): void {
    const failed = claim.extractionStatus !== 'DONE';
    this.claim.set(claim);
    this.setPdf(claim.pdfUrl);
    this.extractionFailed.set(failed);
    if (failed) return;

    // Only empty fields are filled, so nothing the user typed while waiting is lost.
    const extracted = fromClaim(claim, this.preferences.formats());
    for (const name of EXTRACTED_FIELDS) {
      const control = this.form.controls[name];
      if (control.value.trim() === '' && extracted[name] !== '') control.setValue(extracted[name]);
    }
    const markers = fieldMarkers(claim);
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
  }

  // ------------------------------------------------------------ existing claim

  private async loadExisting(claimId: string): Promise<void> {
    try {
      const claim = await firstValueFrom(this.api.claim(claimId));
      this.claim.set(claim);
      this.personId.set(claim.personId);
      this.setPdf(claim.pdfUrl);
      this.fill(fromClaim(claim, this.preferences.formats()));
      this.focusFirst();
    } catch {
      this.error.set('errors.loadClaimFailed');
    } finally {
      this.loadingExisting.set(false);
    }
  }

  // ------------------------------------------------------------ the form

  protected tagFor(name: ClaimFieldName): 'extracted' | 'missing' | null {
    if (this.extractedFields().includes(name)) return 'extracted';
    if (this.missingFields().includes(name)) return 'missing';
    return null;
  }

  /** Error text after blur or submit, one sentence that says what to enter. */
  protected errorText(name: ClaimFieldName): string | null {
    this.language.lang();
    const control = this.form.controls[name];
    const result = this.result();
    if (result.ok || !(control.touched || this.submitted())) return null;
    const key = result.errors[name];
    return key ? this.i18n.translate(`errors.${key}`) : null;
  }

  protected describedBy(name: ClaimFieldName): string | null {
    return this.errorText(name) ? `f-${name}-error` : null;
  }

  /** Shows what was typed in the format of the language once the field is left. */
  protected normalize(
    name: 'invoiceDate' | 'amount' | 'submittedAt' | 'reimbursementDate' | 'paidAt',
  ): void {
    const control = this.form.controls[name];
    const { locale, dateFormat } = this.preferences.formats();
    if (name === 'amount') {
      const cents = parseAmountInput(control.value, locale);
      if (cents !== null) control.setValue(formatAmountPlain(cents, locale), { emitEvent: false });
    } else {
      const iso = parseDateInput(control.value, dateFormat);
      if (iso !== null) control.setValue(formatInvoiceDate(iso, dateFormat), { emitEvent: false });
    }
    this.revision.update((n) => n + 1);
  }

  /** The status was chosen by the user: the date and a final payment follow, unless edited. */
  protected onStatusChanged(): void {
    this.followReimbursement();
    const control = this.form.controls.reimbursedAmount;
    if (!control.pristine) return;
    const status = this.form.controls.status.value;
    // Back at the status it had: the amount it had, too.
    const suggested =
      status !== this.baseline.status
        ? suggestedReimbursement(status, this.form.getRawValue(), this.preferences.formats().locale)
        : null;
    control.setValue(
      suggested === null
        ? this.baseline.reimbursedAmount
        : formatAmountPlain(suggested, this.preferences.formats().locale),
    );
  }

  /** The date of a change is today until the user picks one, see reimbursementDateFor. */
  protected followReimbursement(): void {
    const date = this.form.controls.reimbursementDate;
    if (date.dirty) return;
    const next = reimbursementDateFor(
      this.form.getRawValue(),
      this.baseline,
      this.preferences.formats(),
    );
    if (next !== date.value) date.setValue(next);
  }

  /**
   * The payment toggle was switched by the user. Switching on fills the current date, switching off
   * clears it. Opening a saved claim never comes through here, so a saved date is never overwritten.
   */
  protected onPaidToggled(): void {
    const { paid, paidAt } = this.form.controls;
    paidAt.setValue(paymentDateAfterToggle(paid.value, paidAt.value, this.preferences.formats()));
  }

  // ------------------------------------------------------------ documents

  protected removeStored(document: InsurerDocument): void {
    this.form.markAsDirty();
    this.removedIds.update((ids) => [...ids, document.documentId]);
  }

  /**
   * Opens the document in a new tab with a link that is valid for a minute. The tab is opened
   * inside the click (popup blockers), the signed URL is set once it arrives.
   */
  protected async openDocument(document: InsurerDocument): Promise<void> {
    const claim = this.claim();
    if (!claim) return;
    this.error.set(null);
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await firstValueFrom(
        this.api.documentUrl(claim.claimId, document.documentId),
      );
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch {
      tab?.close();
      this.error.set('documents.openFailed');
    }
  }

  /** Files go to S3 first, the claim is saved last and references them: no half saved claim. */
  private async uploadDocuments(): Promise<{ uploadId: string; fileName: string }[]> {
    const files = this.files();
    const uploaded: { uploadId: string; fileName: string }[] = [];
    this.busy.set('uploadingDocuments');
    this.uploadPercent.set(0);
    for (const [index, file] of files.entries()) {
      const contentType = documentContentType(file);
      if (!contentType) throw new Error('type');
      const { uploadId, upload } = await firstValueFrom(
        this.api.createDocumentUpload({ contentType, size: file.size }),
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
      uploaded.push({ uploadId, fileName: file.name });
    }
    return uploaded;
  }

  // ------------------------------------------------------------ saving

  /** The one save: the whole state of the dialog in one request. */
  protected async save(): Promise<void> {
    if (this.working()) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const existing = this.claim();
    const personId = this.personId();
    if (!existing && !personId) this.personMissing.set(true);
    const result = this.result();
    if (!result.ok || (!existing && !personId)) {
      const first = CLAIM_FIELD_NAMES.find((name) => !result.ok && result.errors[name]);
      if (first) this.host.nativeElement.querySelector<HTMLElement>(`#f-${first}`)?.focus();
      return;
    }
    this.error.set(null);
    try {
      const newDocuments = await this.uploadDocuments();
      this.busy.set('saving');
      const body = { ...result.request, newDocuments, removedDocumentIds: this.removedIds() };
      if (existing) {
        await firstValueFrom(
          this.api.saveClaim(existing.claimId, { ...body, version: existing.updatedAt }),
        );
      } else {
        await firstValueFrom(this.api.createClaim({ ...body, personId: personId as string }));
      }
      this.draftId = null; // saved, nothing left to discard
      this.finish('saved');
    } catch (error) {
      this.error.set(saveErrorKey(error));
      this.busy.set('idle');
    }
  }

  protected async deleteClaim(): Promise<void> {
    const existing = this.claim();
    if (!existing || this.working()) return;
    this.busy.set('saving');
    try {
      await firstValueFrom(this.api.deleteClaim(existing.claimId));
      this.finish('deleted');
    } catch {
      this.confirm.set(null);
      this.error.set('errors.deleteFailed');
      this.busy.set('idle');
    }
  }

  // ------------------------------------------------------------ closing

  protected onEscape(event: Event): void {
    event.stopPropagation();
    if (this.confirm() !== null) this.confirm.set(null);
    else this.requestClose();
  }

  /** Cancel, Escape and the close button. Asks once if the user has edited anything. */
  protected requestClose(): void {
    if (this.busy() === 'saving' || this.busy() === 'uploadingDocuments') return;
    const hasEdits = this.form.dirty || this.files().length > 0 || this.removedIds().length > 0;
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

  private fill(values: ClaimFormValues): void {
    this.baseline = values;
    this.form.reset(values, { emitEvent: false });
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.revision.update((n) => n + 1);
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
