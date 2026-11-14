import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Claim, InsurerDocument, ReimbursementEntry } from '@myclaimgrid/shared';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api.client';
import { LanguageService } from '../../core/language.service';
import { McgCurrencyPipe, McgDatePipe } from '../../core/pipes';
import { ButtonComponent } from '../../ui/button.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { ReimbursementBadgeComponent } from '../../ui/tracking-badges.component';
import { EntryDialogComponent } from './entry-dialog.component';

type Confirm =
  { kind: 'entry'; entry: ReimbursementEntry } | { kind: 'document'; document: InsurerDocument };

/**
 * "Erstattung" in the detail view of a saved claim: the derived figures, the history (newest first)
 * with its documents, and the dialog to add an entry. Changes are saved right away, independent of
 * the claim form above.
 */
@Component({
  selector: 'mcg-reimbursement-section',
  imports: [
    TranslocoPipe,
    McgCurrencyPipe,
    McgDatePipe,
    ButtonComponent,
    IconComponent,
    NoticeComponent,
    ReimbursementBadgeComponent,
    EntryDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="app-reimbursement" aria-labelledby="reimbursement-title">
      <div class="app-reimbursement__head">
        <h3 class="app-section-title" id="reimbursement-title">
          {{ 'reimbursement.section' | transloco }}
        </h3>
        <mcg-reimbursement-badge
          [status]="claim().reimbursement.status"
          [submittedAt]="claim().submittedAt"
        />
      </div>

      <dl class="app-figures app-figures--flush" data-testid="reimbursement-figures">
        <div>
          <dt class="mcg-label">{{ 'reimbursement.invoiceAmount' | transloco }}</dt>
          <dd>{{ claim().amount | mcgCurrency }}</dd>
        </div>
        <div>
          <dt class="mcg-label">{{ 'reimbursement.reimbursed' | transloco }}</dt>
          <dd data-testid="detail-reimbursed">
            {{ claim().reimbursement.reimbursed | mcgCurrency }}
          </dd>
        </div>
        <div>
          <dt class="mcg-label">{{ 'reimbursement.outstanding' | transloco }}</dt>
          <dd data-testid="detail-outstanding">
            {{ claim().reimbursement.outstanding | mcgCurrency }}
          </dd>
        </div>
        @if (claim().reimbursement.status === 'PARTLY_PAID') {
          <div>
            <dt class="mcg-label">{{ 'reimbursement.difference' | transloco }}</dt>
            <dd data-testid="detail-difference">{{ difference() | mcgCurrency }}</dd>
          </div>
        }
        @if (claim().reimbursement.rejected > 0) {
          <div>
            <dt class="mcg-label">{{ 'reimbursement.rejected' | transloco }}</dt>
            <dd>{{ claim().reimbursement.rejected | mcgCurrency }}</dd>
          </div>
        }
        <div>
          <dt class="mcg-label">{{ 'reimbursement.selfBorne' | transloco }}</dt>
          <dd data-testid="detail-self-borne">
            {{ claim().reimbursement.selfBorne | mcgCurrency }}
          </dd>
        </div>
      </dl>

      @if (error()) {
        <mcg-notice variant="error">{{ error()! | transloco }}</mcg-notice>
      }

      <div class="app-reimbursement__head">
        <span class="mcg-label">{{ 'reimbursement.history' | transloco }}</span>
        <button mcg-button size="sm" [disabled]="busy()" (click)="entryOpen.set(true)">
          <mcg-icon name="plus" />{{ 'reimbursement.add' | transloco }}
        </button>
      </div>

      @if (entries().length === 0) {
        <p class="mcg-muted app-small" style="margin: 0">{{ 'reimbursement.empty' | transloco }}</p>
      } @else {
        <ol class="app-history" data-testid="history">
          @for (entry of entries(); track entry.entryId) {
            <li class="app-history__item">
              <div class="app-history__row">
                <span class="mcg-num app-small">{{ entry.date | mcgDate }}</span>
                <mcg-reimbursement-badge [status]="entry.status" />
                @if (entry.reimbursedAmount !== null) {
                  <span class="mcg-num app-small">{{
                    'reimbursement.entryReimbursed'
                      | transloco: { amount: (entry.reimbursedAmount | mcgCurrency) }
                  }}</span>
                }
                @if (entry.rejectedAmount) {
                  <span class="mcg-num app-small mcg-muted">{{
                    'reimbursement.entryRejected'
                      | transloco: { amount: (entry.rejectedAmount | mcgCurrency) }
                  }}</span>
                }
                <span class="mcg-topbar__spacer"></span>
                <button
                  mcg-button
                  variant="ghost"
                  size="sm"
                  [disabled]="busy()"
                  (click)="confirm.set({ kind: 'entry', entry })"
                >
                  {{ 'reimbursement.deleteEntry' | transloco }}
                </button>
              </div>
              @if (entry.note) {
                <p class="app-history__note mcg-muted app-small">{{ entry.note }}</p>
              }
              @for (document of entry.documents; track document.documentId) {
                <div class="app-history__doc">
                  <button
                    type="button"
                    class="app-doc-link"
                    [attr.aria-label]="
                      'reimbursement.openDocument' | transloco: { name: document.fileName }
                    "
                    (click)="openDocument(document)"
                  >
                    <mcg-icon name="file" /><span>{{ document.fileName }}</span>
                  </button>
                  <button
                    mcg-button
                    variant="ghost"
                    size="sm"
                    [iconOnly]="true"
                    [disabled]="busy()"
                    [attr.aria-label]="
                      'reimbursement.deleteDocument' | transloco: { name: document.fileName }
                    "
                    (click)="confirm.set({ kind: 'document', document })"
                  >
                    <mcg-icon name="close" />
                  </button>
                </div>
              }
              @if (confirmsEntry(entry) || confirmsDocumentOf(entry)) {
                <div class="app-history__confirm">
                  <mcg-notice class="app-grow">{{ confirmText() }}</mcg-notice>
                  <button mcg-button size="sm" (click)="confirm.set(null)">
                    {{ 'dialog.cancel' | transloco }}
                  </button>
                  <button
                    mcg-button
                    size="sm"
                    variant="danger"
                    [disabled]="busy()"
                    (click)="runDelete()"
                  >
                    {{ 'dialog.delete' | transloco }}
                  </button>
                </div>
              }
            </li>
          }
        </ol>
      }
      <p class="mcg-field__hint" style="margin: 0">{{ 'reimbursement.immediate' | transloco }}</p>
    </section>

    @if (entryOpen()) {
      <mcg-entry-dialog
        [claim]="savedClaim()"
        (saved)="onSaved($event)"
        (cancelled)="entryOpen.set(false)"
      />
    }
  `,
})
export class ReimbursementSectionComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  readonly claim = input.required<Claim>();
  /** The claim after a change of its history, so the dialog and the dashboard can update. */
  readonly changed = output<Claim>();

  protected readonly entryOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirm = signal<Confirm | null>(null);

  protected readonly entries = computed(() => [...this.claim().reimbursement.entries].reverse());
  protected readonly savedClaim = computed(() => this.claim() as Claim & { amount: number });
  protected readonly difference = computed(
    () => (this.claim().amount ?? 0) - this.claim().reimbursement.reimbursed,
  );

  protected confirmsEntry(entry: ReimbursementEntry): boolean {
    const c = this.confirm();
    return c?.kind === 'entry' && c.entry.entryId === entry.entryId;
  }

  protected confirmsDocumentOf(entry: ReimbursementEntry): boolean {
    const c = this.confirm();
    return (
      c?.kind === 'document' && entry.documents.some((d) => d.documentId === c.document.documentId)
    );
  }

  protected readonly confirmText = computed(() => {
    this.language.lang();
    const c = this.confirm();
    if (!c) return '';
    return c.kind === 'entry'
      ? this.i18n.translate('reimbursement.confirmDeleteEntry')
      : this.i18n.translate('reimbursement.confirmDeleteDocument', { name: c.document.fileName });
  });

  protected onSaved(claim: Claim): void {
    this.entryOpen.set(false);
    this.error.set(null);
    this.changed.emit(claim);
  }

  protected async runDelete(): Promise<void> {
    const c = this.confirm();
    if (!c || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const claimId = this.claim().claimId;
    try {
      const claim = await firstValueFrom(
        c.kind === 'entry'
          ? this.api.deleteEntry(claimId, c.entry.entryId)
          : this.api.deleteDocument(claimId, c.document.documentId),
      );
      this.confirm.set(null);
      this.changed.emit(claim);
    } catch {
      this.error.set('reimbursement.deleteFailed');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Opens the document in a new tab with a link that is valid for a minute. The tab is opened
   * inside the click (popup blockers), the signed URL is set once it arrives.
   */
  protected async openDocument(document: InsurerDocument): Promise<void> {
    this.error.set(null);
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await firstValueFrom(
        this.api.documentUrl(this.claim().claimId, document.documentId),
      );
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch {
      tab?.close();
      this.error.set('reimbursement.documentFailed');
    }
  }
}
