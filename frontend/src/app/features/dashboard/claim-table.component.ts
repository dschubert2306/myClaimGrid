import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { reimbursementStatusSchema } from '@myclaimgrid/shared';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api.client';
import {
  editText,
  inlineEditError,
  inlineEditRequest,
  type InlineEdit,
  type InlineField,
  type InlineTextField,
} from '../../core/claim-inline-edit';
import { DashboardStore } from '../../core/dashboard.store';
import { datePlaceholder } from '../../core/date-format';
import { LanguageService } from '../../core/language.service';
import { McgCurrencyPipe, McgDatePipe } from '../../core/pipes';
import { PreferencesService } from '../../core/preferences.service';
import { saveErrorKey } from '../../core/save-error';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { ReimbursementBadgeComponent } from '../../ui/tracking-badges.component';
import type { ClaimRow } from './claim-list.component';

interface Cell {
  claimId: string;
  field: InlineField;
}

/** Placeholder of an empty cell, so there is still something to click. */
const EMPTY = '–';

/**
 * The list view as a table, one row per claim (design-system/components/ClaimTable): doctor or
 * hospital, invoice number, date, amount, reimbursement status, payment, and an icon when the
 * invoice PDF is attached. Every one of those cells but the icon is edited in place.
 *
 * Editing: click a cell (or focus it and press Enter) to edit, Enter saves, Escape cancels, and
 * leaving the field saves too. The status is chosen from a list and the payment is a checkbox, both
 * save at once. A cell saves the whole claim with that one change, through the same validation as
 * the claim dialog. The last column opens the dialog for everything the table does not show.
 */
@Component({
  selector: 'mcg-claim-table',
  imports: [
    NgTemplateOutlet,
    TranslocoPipe,
    McgCurrencyPipe,
    McgDatePipe,
    IconComponent,
    NoticeComponent,
    ReimbursementBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (notice(); as key) {
      <div class="app-table__notice">
        <mcg-notice variant="error">{{ key | transloco }}</mcg-notice>
      </div>
    }

    <ng-template
      #textCell
      let-row="row"
      let-field="field"
      let-display="display"
      let-numeric="numeric"
    >
      @if (isEditing(row, field)) {
        <input
          class="mcg-input app-cell__input"
          [class.mcg-num]="numeric"
          [class.app-cell__input--end]="field === 'amount'"
          autocomplete="off"
          [attr.inputmode]="field === 'amount' ? 'decimal' : null"
          [attr.maxlength]="field === 'provider' ? 200 : null"
          [placeholder]="placeholder(field)"
          [value]="draft()"
          [attr.aria-label]="cellLabel(row, field)"
          [attr.aria-invalid]="cellError() ? true : null"
          [attr.aria-describedby]="cellError() ? 'cell-error' : null"
          (input)="draft.set($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); commit(row, field, true)"
          (keydown.escape)="cancel(row, field, $event)"
          (blur)="commit(row, field, false)"
        />
        @if (cellError(); as key) {
          <span id="cell-error" class="app-cell__error" role="alert">{{ key | transloco }}</span>
        }
      } @else {
        <button
          type="button"
          class="app-cell__btn"
          [class.app-cell__btn--end]="field === 'amount'"
          [class.mcg-num]="numeric"
          [class.is-empty]="!display"
          [disabled]="isSaving(row)"
          [attr.data-cell]="row.claim.claimId + ':' + field"
          [attr.aria-label]="cellLabel(row, field, display)"
          (click)="startEdit(row, field)"
        >
          {{ display || empty }}
        </button>
      }
    </ng-template>

    <div class="app-table__scroll">
      <table
        class="app-table"
        data-testid="claim-list"
        [attr.aria-label]="'list.tableLabel' | transloco"
      >
        <thead>
          <tr>
            <th scope="col">{{ 'form.provider' | transloco }}</th>
            <th scope="col">{{ 'form.invoiceNumber' | transloco }}</th>
            <th scope="col">{{ 'form.invoiceDate' | transloco }}</th>
            <th scope="col" class="app-table__end">{{ 'form.amount' | transloco }}</th>
            <th scope="col">{{ 'list.statusColumn' | transloco }}</th>
            <th scope="col">{{ 'payment.title' | transloco }}</th>
            <th scope="col" class="app-table__icon">
              <span class="app-sr-only">{{ 'list.invoiceColumn' | transloco }}</span>
            </th>
            <th scope="col" class="app-table__icon">
              <span class="app-sr-only">{{ 'list.detailsColumn' | transloco }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.claim.claimId) {
            <tr
              [class.is-selected]="row.claim.claimId === selectedId()"
              [class.is-saving]="isSaving(row)"
              [attr.aria-busy]="isSaving(row) ? true : null"
            >
              <th scope="row" class="app-table__provider">
                <ng-container
                  *ngTemplateOutlet="
                    textCell;
                    context: { row, field: 'provider', display: row.claim.provider, numeric: false }
                  "
                />
                <span
                  class="app-person-mark app-table__person"
                  [style.--person]="'var(--' + row.person.color + ')'"
                  >{{ row.person.name }}</span
                >
              </th>
              <td>
                <ng-container
                  *ngTemplateOutlet="
                    textCell;
                    context: {
                      row,
                      field: 'invoiceNumber',
                      display: row.claim.invoiceNumber,
                      numeric: false,
                    }
                  "
                />
              </td>
              <td>
                <ng-container
                  *ngTemplateOutlet="
                    textCell;
                    context: {
                      row,
                      field: 'invoiceDate',
                      display: row.claim.invoiceDate | mcgDate,
                      numeric: true,
                    }
                  "
                />
              </td>
              <td class="app-table__end">
                <ng-container
                  *ngTemplateOutlet="
                    textCell;
                    context: {
                      row,
                      field: 'amount',
                      display: row.claim.amount | mcgCurrency,
                      numeric: true,
                    }
                  "
                />
              </td>
              <td>
                @if (isEditing(row, 'status')) {
                  <span class="mcg-select mcg-select--sm">
                    <select
                      class="app-cell__select"
                      [attr.aria-label]="cellLabel(row, 'status')"
                      (change)="chooseStatus(row, $any($event.target).value)"
                      (keydown.escape)="cancel(row, 'status', $event)"
                      (blur)="stopEditing(row, 'status')"
                    >
                      @for (status of statuses; track status) {
                        <option
                          [value]="status"
                          [selected]="status === row.claim.reimbursement.status"
                          [disabled]="
                            status === 'PARTLY_PAID' && row.claim.reimbursement.status !== status
                          "
                        >
                          {{ 'reimbursement.status.' + status | transloco }}
                        </option>
                      }
                    </select>
                  </span>
                } @else {
                  <button
                    type="button"
                    class="app-cell__btn"
                    [disabled]="isSaving(row)"
                    [attr.data-cell]="row.claim.claimId + ':status'"
                    [attr.aria-label]="
                      cellLabel(
                        row,
                        'status',
                        'reimbursement.status.' + row.claim.reimbursement.status | transloco
                      )
                    "
                    (click)="startEdit(row, 'status')"
                  >
                    <mcg-reimbursement-badge [status]="row.claim.reimbursement.status" />
                  </button>
                }
              </td>
              <td>
                <div class="app-cell__pay">
                  <input
                    type="checkbox"
                    class="app-cell__check"
                    data-testid="payment-check"
                    [checked]="row.claim.paidAt !== null"
                    [attr.aria-label]="('payment.toggle' | transloco) + ': ' + row.claim.provider"
                    (change)="togglePaid(row, $event)"
                  />
                  @if (row.claim.paidAt) {
                    <ng-container
                      *ngTemplateOutlet="
                        textCell;
                        context: {
                          row,
                          field: 'paidAt',
                          display: row.claim.paidAt | mcgDate,
                          numeric: true,
                        }
                      "
                    />
                  } @else {
                    <span class="mcg-muted">{{ 'payment.unpaid' | transloco }}</span>
                  }
                </div>
              </td>
              <td class="app-table__icon">
                @if (row.claim.hasPdf) {
                  <span
                    class="app-table__attached"
                    data-testid="invoice-icon"
                    role="img"
                    [attr.aria-label]="'list.invoiceAttached' | transloco"
                    [attr.title]="'list.invoiceAttached' | transloco"
                  >
                    <mcg-icon name="file" />
                  </span>
                }
              </td>
              <td class="app-table__icon">
                <button
                  type="button"
                  class="app-table__open"
                  [attr.aria-label]="('list.openDetails' | transloco) + ': ' + row.claim.provider"
                  [attr.title]="'list.openDetails' | transloco"
                  (click)="open.emit(row.claim.claimId)"
                >
                  <mcg-icon name="chevron-right" />
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ClaimTableComponent {
  private readonly api = inject(ApiClient);
  private readonly store = inject(DashboardStore);
  private readonly preferences = inject(PreferencesService);
  private readonly language = inject(LanguageService);
  private readonly i18n = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly rows = input.required<ClaimRow[]>();
  readonly selectedId = input<string | null>(null);
  readonly open = output<string>();

  protected readonly statuses = reimbursementStatusSchema.options;
  protected readonly empty = EMPTY;

  /** The cell being edited, its text, and what is wrong with it (translation key). */
  protected readonly editing = signal<Cell | null>(null);
  protected readonly draft = signal('');
  protected readonly cellError = signal<string | null>(null);
  /** Claims with a save in flight: their cells wait, so two saves never race on one version. */
  private readonly saving = signal<ReadonlySet<string>>(new Set());
  /** A failed edit that is no longer open for correction (translation key). */
  protected readonly notice = signal<string | null>(null);

  protected isEditing(row: ClaimRow, field: InlineField): boolean {
    const cell = this.editing();
    return cell?.claimId === row.claim.claimId && cell.field === field;
  }

  protected isSaving(row: ClaimRow): boolean {
    return this.saving().has(row.claim.claimId);
  }

  protected placeholder(field: InlineField): string {
    this.language.lang();
    return field === 'invoiceDate' || field === 'paidAt'
      ? datePlaceholder(this.preferences.dateFormat(), this.language.lang())
      : '';
  }

  /** "Edit Date: Praxis Dr. Huber 12.03.2026": the column, the row and the current value. */
  protected cellLabel(row: ClaimRow, field: InlineField, value?: string): string {
    this.language.lang();
    const column = this.i18n.translate(
      {
        provider: 'form.provider',
        invoiceNumber: 'form.invoiceNumber',
        invoiceDate: 'form.invoiceDate',
        amount: 'form.amount',
        status: 'list.statusColumn',
        paid: 'payment.title',
        paidAt: 'payment.date',
      }[field],
    );
    const claim = row.claim;
    if (value === undefined) return `${column}: ${claim.provider ?? ''}`;
    return this.i18n.translate('list.editCell', {
      column,
      provider: claim.provider ?? '',
      value: value || this.i18n.translate('list.emptyValue'),
    });
  }

  // ------------------------------------------------------------ editing

  protected startEdit(row: ClaimRow, field: InlineField): void {
    if (this.isSaving(row)) return;
    this.notice.set(null);
    this.cellError.set(null);
    if (field !== 'status' && field !== 'paid') {
      this.draft.set(editText(row.claim, field, this.preferences.formats()));
    }
    this.editing.set({ claimId: row.claim.claimId, field });
    afterNextRender(
      () => {
        const control = this.host.nativeElement.querySelector<HTMLInputElement | HTMLSelectElement>(
          '.app-cell__input, .app-cell__select',
        );
        control?.focus();
        if (control instanceof HTMLInputElement) control.select();
        else {
          try {
            control?.showPicker();
          } catch {
            /* not supported or not allowed: the select is focused and works with the keyboard */
          }
        }
      },
      { injector: this.injector },
    );
  }

  /** Enter saves and keeps the cell focused, leaving the field saves too and leaves the focus alone. */
  protected async commit(row: ClaimRow, field: InlineTextField, byKey: boolean): Promise<void> {
    // Already committed (Enter, then the blur of the removed input), or a save is still running.
    if (!this.isEditing(row, field) || this.isSaving(row)) return;
    const text = this.draft();
    if (text.trim() === editText(row.claim, field, this.preferences.formats()).trim()) {
      this.finish(row, field, byKey);
      return;
    }
    const failed = await this.save(row, { field, text }, byKey);
    if (failed === 'invalid' && byKey) return; // stays open: the user can fix it
    this.finish(row, field, byKey);
  }

  protected cancel(row: ClaimRow, field: InlineField, event: Event): void {
    event.stopPropagation();
    this.cellError.set(null);
    this.finish(row, field, true);
  }

  protected stopEditing(row: ClaimRow, field: InlineField): void {
    if (this.isEditing(row, field)) this.finish(row, field, false);
  }

  protected async chooseStatus(row: ClaimRow, value: string): Promise<void> {
    const status = reimbursementStatusSchema.safeParse(value);
    if (status.success && status.data !== row.claim.reimbursement.status && !this.isSaving(row)) {
      await this.save(row, { field: 'status', status: status.data }, true);
    }
    this.finish(row, 'status', true);
  }

  protected async togglePaid(row: ClaimRow, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    // The box stays enabled while a save runs (a disabled box would drop the keyboard focus).
    const result = this.isSaving(row)
      ? 'failed'
      : await this.save(row, { field: 'paid', paid: box.checked }, false);
    // A refused change: the box goes back to what is saved.
    if (result !== 'saved') box.checked = this.currentPaid(row);
  }

  /** The saved payment state of the row, read from the store: `row` may be a version behind. */
  private currentPaid(row: ClaimRow): boolean {
    const claims = this.store.claims()[row.claim.personId] ?? [];
    return (claims.find((c) => c.claimId === row.claim.claimId) ?? row.claim).paidAt !== null;
  }

  private finish(row: ClaimRow, field: InlineField, refocus: boolean): void {
    if (this.isEditing(row, field)) this.editing.set(null);
    this.cellError.set(null);
    if (!refocus) return;
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-cell="${row.claim.claimId}:${field}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  // ------------------------------------------------------------ saving

  /**
   * Saves the one change as a full save of the claim. A change the dialog would refuse is not sent:
   * its error is shown at the cell while it is open, else above the table.
   */
  private async save(
    row: ClaimRow,
    edit: InlineEdit,
    open: boolean,
  ): Promise<'saved' | 'invalid' | 'failed'> {
    const { claim } = row;
    const result = inlineEditRequest(claim, edit, this.preferences.formats());
    if (!result.ok) {
      const key = `errors.${inlineEditError(result, edit.field)}`;
      if (open && edit.field !== 'status' && edit.field !== 'paid') this.cellError.set(key);
      else this.notice.set(key);
      return 'invalid';
    }
    this.notice.set(null);
    this.cellError.set(null);
    this.saving.update((ids) => new Set(ids).add(claim.claimId));
    try {
      const saved = await firstValueFrom(
        this.api.saveClaim(claim.claimId, {
          ...result.request,
          newDocuments: [],
          removedDocumentIds: [],
          version: claim.updatedAt,
        }),
      );
      this.store.replaceClaim(saved);
      void this.store.refresh(); // the totals of the overview and the order of the list
      return 'saved';
    } catch (error) {
      const key = saveErrorKey(error);
      this.notice.set(key);
      if (key === 'errors.conflict') void this.store.refresh(); // show what the other tab saved
      return 'failed';
    } finally {
      this.saving.update((ids) => {
        const next = new Set(ids);
        next.delete(claim.claimId);
        return next;
      });
    }
  }
}
