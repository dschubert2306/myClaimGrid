import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  matchesFilters,
  type Claim,
  type PaymentFilter,
  type Person,
  type ReimbursementFilter,
} from '@myclaimgrid/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { LanguageService } from '../../core/language.service';
import { McgCurrencyPipe } from '../../core/pipes';
import { ButtonComponent } from '../../ui/button.component';
import { SelectComponent } from '../../ui/select.component';
import { ClaimTableComponent } from './claim-table.component';

export interface ClaimRow {
  claim: Claim;
  person: Person;
}

const PRESET = { reimbursement: 'NOT_REIMBURSED', payment: 'PAID' } as const;

/** Filters outlive the list: it is re-created whenever the dashboard reloads after a save. */
@Injectable({ providedIn: 'root' })
export class ClaimListFilters {
  readonly person = signal<string>('ALL');
  readonly reimbursement = signal<ReimbursementFilter>('ALL');
  readonly payment = signal<PaymentFilter>('ALL');
}

/**
 * All claims of the year as an editable table, with filters for both status dimensions and the
 * totals of what is shown (design-system/components/ClaimTable).
 */
@Component({
  selector: 'mcg-claim-list',
  imports: [TranslocoPipe, McgCurrencyPipe, ButtonComponent, ClaimTableComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-filters" role="search" [attr.aria-label]="'dashboard.views.list' | transloco">
      <div class="mcg-field">
        <label class="mcg-label" for="filter-person">{{ 'list.person' | transloco }}</label>
        <mcg-select
          inputId="filter-person"
          [options]="personOptions()"
          [value]="person()"
          (valueChange)="person.set($event ?? 'ALL')"
        />
      </div>
      <div class="mcg-field">
        <label class="mcg-label" for="filter-reimbursement">{{
          'list.reimbursementFilter' | transloco
        }}</label>
        <mcg-select
          inputId="filter-reimbursement"
          [options]="reimbursementOptions()"
          [value]="reimbursement()"
          (valueChange)="reimbursement.set($any($event) ?? 'ALL')"
        />
      </div>
      <div class="mcg-field">
        <label class="mcg-label" for="filter-payment">{{ 'list.paymentFilter' | transloco }}</label>
        <mcg-select
          inputId="filter-payment"
          [options]="paymentOptions()"
          [value]="payment()"
          (valueChange)="payment.set($any($event) ?? 'ALL')"
        />
      </div>
      <div class="app-filters__actions">
        <button
          mcg-button
          [attr.aria-pressed]="presetActive()"
          [variant]="presetActive() ? 'primary' : 'default'"
          (click)="applyPreset()"
        >
          {{ 'list.preset' | transloco }}
        </button>
        @if (filtered()) {
          <button mcg-button variant="ghost" (click)="reset()">
            {{ 'list.reset' | transloco }}
          </button>
        }
      </div>
    </div>

    <div class="app-list">
      <p class="app-list__count mcg-muted" role="status">
        {{ 'list.count' | transloco: { count: visible().length, total: rows().length } }}
        @if (visible().length > 0) {
          <span class="mcg-num" style="margin-left: var(--space-3)" data-testid="list-totals">
            {{
              'list.totals'
                | transloco
                  : {
                      amount: (totals().amount | mcgCurrency),
                      reimbursed: (totals().reimbursed | mcgCurrency),
                      outstanding: (totals().outstanding | mcgCurrency),
                    }
            }}
          </span>
        }
      </p>
      @if (rows().length === 0) {
        <p class="app-list__empty mcg-muted">{{ 'list.noClaims' | transloco: { year: year() } }}</p>
      } @else if (visible().length === 0) {
        <p class="app-list__empty mcg-muted">{{ 'list.empty' | transloco }}</p>
      } @else {
        <mcg-claim-table
          [rows]="visible()"
          [selectedId]="selectedId()"
          (open)="open.emit($event)"
        />
      }
    </div>
  `,
})
export class ClaimListComponent {
  private readonly i18n = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  readonly rows = input.required<ClaimRow[]>();
  readonly persons = input.required<Person[]>();
  readonly year = input.required<number>();
  readonly selectedId = input<string | null>(null);
  readonly open = output<string>();

  private readonly filters = inject(ClaimListFilters);
  protected readonly person = this.filters.person;
  protected readonly reimbursement = this.filters.reimbursement;
  protected readonly payment = this.filters.payment;

  protected readonly visible = computed(() => {
    const person = this.person();
    const filters = { reimbursement: this.reimbursement(), payment: this.payment() };
    return this.rows().filter(
      (row) =>
        (person === 'ALL' || row.person.personId === person) && matchesFilters(row.claim, filters),
    );
  });
  protected readonly totals = computed(() =>
    this.visible().reduce(
      (acc, { claim }) => ({
        amount: acc.amount + (claim.amount ?? 0),
        reimbursed: acc.reimbursed + claim.reimbursement.reimbursed,
        outstanding: acc.outstanding + claim.reimbursement.outstanding,
      }),
      { amount: 0, reimbursed: 0, outstanding: 0 },
    ),
  );
  protected readonly presetActive = computed(
    () => this.reimbursement() === PRESET.reimbursement && this.payment() === PRESET.payment,
  );
  protected readonly filtered = computed(
    () => this.person() !== 'ALL' || this.reimbursement() !== 'ALL' || this.payment() !== 'ALL',
  );

  protected readonly personOptions = computed(() => {
    this.language.lang();
    return [
      { value: 'ALL', label: this.i18n.translate('list.allPersons') },
      ...this.persons().map((p) => ({ value: p.personId, label: p.name })),
    ];
  });
  protected readonly reimbursementOptions = computed(() => {
    this.language.lang();
    const t = (key: string) => this.i18n.translate(key);
    return [
      { value: 'ALL', label: t('list.filterAll') },
      { value: 'NOT_SUBMITTED', label: t('list.notSubmitted') },
      { value: 'NOT_REIMBURSED', label: t('list.notReimbursed') },
      ...(['OPEN', 'IN_PROGRESS', 'PARTLY_PAID', 'PAID'] as const).map((status) => ({
        value: status,
        label: t(`reimbursement.status.${status}`),
      })),
    ];
  });
  protected readonly paymentOptions = computed(() => {
    this.language.lang();
    const t = (key: string) => this.i18n.translate(key);
    return [
      { value: 'ALL', label: t('list.filterAll') },
      { value: 'PAID', label: t('list.paid') },
      { value: 'UNPAID', label: t('list.unpaid') },
    ];
  });

  /** "Bezahlt, aber noch nicht erstattet": the combination people look for most. Toggles. */
  protected applyPreset(): void {
    if (this.presetActive()) {
      this.reimbursement.set('ALL');
      this.payment.set('ALL');
      return;
    }
    this.reimbursement.set(PRESET.reimbursement);
    this.payment.set(PRESET.payment);
  }

  protected reset(): void {
    this.person.set('ALL');
    this.reimbursement.set('ALL');
    this.payment.set('ALL');
  }
}
