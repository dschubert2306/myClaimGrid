import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { Claim, Person } from '@myclaimgrid/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { DashboardStore, type PersonFigures } from '../core/dashboard.store';
import { McgCurrencyPipe } from '../core/pipes';
import { ButtonComponent } from './button.component';
import { ClaimTableComponent } from './claim-table.component';
import { ProgressComponent } from './progress.component';

/** One dashboard column: name, total and count for the year, and the claims. */
@Component({
  selector: 'section[mcg-person-card]',
  imports: [
    TranslocoPipe,
    McgCurrencyPipe,
    ButtonComponent,
    ClaimTableComponent,
    ProgressComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mcg-person', '[style.--person]': "'var(--' + person().color + ')'" },
  template: `
    <div class="mcg-person__head">
      @if (editing()) {
        <form class="mcg-row app-grow" (submit)="$event.preventDefault(); commit()">
          <input
            #nameInput
            class="mcg-input app-grow"
            maxlength="60"
            [attr.aria-label]="'person.nameLabel' | transloco"
            [value]="draft()"
            (input)="draft.set($any($event.target).value)"
            (keydown.escape)="cancel()"
          />
          <button mcg-button size="sm" variant="primary" type="submit" [disabled]="saving()">
            {{ 'person.save' | transloco }}
          </button>
          <button mcg-button size="sm" (click)="cancel()">{{ 'person.cancel' | transloco }}</button>
        </form>
      } @else {
        <h2 class="mcg-person__name">{{ person().name }}</h2>
        <button mcg-button size="sm" variant="ghost" (click)="startEdit()">
          {{ 'person.rename' | transloco }}
        </button>
      }
    </div>
    @if (renameFailed()) {
      <span class="mcg-field__error" style="padding: 0 var(--space-6)">{{
        'person.renameError' | transloco
      }}</span>
    }
    <div class="mcg-person__stats">
      <div>
        <div class="mcg-label">{{ 'person.sum' | transloco: { year: year() } }}</div>
        <div class="mcg-person__total">{{ total() | mcgCurrency }}</div>
      </div>
      <div>
        <div class="mcg-label" style="text-align: right">{{ 'person.count' | transloco }}</div>
        <div class="mcg-person__count">{{ count() }}</div>
      </div>
    </div>
    <dl class="app-figures" [attr.aria-label]="'reimbursement.section' | transloco">
      <div>
        <dt class="mcg-label">{{ 'person.outstanding' | transloco }}</dt>
        <dd data-testid="figure-outstanding">{{ figures().outstandingAmount | mcgCurrency }}</dd>
      </div>
      <div>
        <dt class="mcg-label">{{ 'person.reimbursed' | transloco }}</dt>
        <dd data-testid="figure-reimbursed">{{ figures().reimbursedAmount | mcgCurrency }}</dd>
      </div>
      <div>
        <dt class="mcg-label">{{ 'person.selfBorne' | transloco }}</dt>
        <dd data-testid="figure-self-borne">{{ figures().selfBorneAmount | mcgCurrency }}</dd>
      </div>
    </dl>
    @if (person().deductible > 0) {
      <div class="app-deductible">
        <mcg-progress
          [label]="
            reached()
              ? ('person.deductibleReached'
                | transloco: { amount: (person().deductible | mcgCurrency) })
              : ('person.deductibleOpen'
                | transloco
                  : {
                      remaining: (person().deductible - total() | mcgCurrency),
                      amount: (person().deductible | mcgCurrency),
                    })
          "
          [percent]="deductiblePercent()"
        />
      </div>
    }
    @if (claims().length > 0) {
      <mcg-claim-table
        [claims]="claims()"
        [selectedId]="selectedId()"
        (open)="openClaim.emit($event)"
      />
    } @else {
      <p
        class="mcg-muted"
        style="margin: 0; padding: var(--space-6); font-size: 13px; line-height: 20px"
      >
        {{ 'person.noClaims' | transloco: { year: year() } }}
      </p>
    }
  `,
})
export class PersonCardComponent {
  private readonly store = inject(DashboardStore);

  readonly person = input.required<Person>();
  readonly year = input.required<number>();
  readonly figures = input.required<PersonFigures>();
  protected readonly total = computed(() => this.figures().totalAmount);
  protected readonly count = computed(() => this.figures().count);
  readonly claims = input.required<Claim[]>();
  readonly selectedId = input<string | null>(null);
  readonly openClaim = output<string>();

  protected readonly deductiblePercent = computed(() => {
    const deductible = this.person().deductible;
    return deductible > 0 ? Math.min(100, Math.floor((this.total() / deductible) * 100)) : 0;
  });
  protected readonly reached = computed(
    () => this.person().deductible > 0 && this.total() >= this.person().deductible,
  );

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly saving = signal(false);
  protected readonly renameFailed = signal(false);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  constructor() {
    effect(() => {
      if (this.editing()) this.nameInput()?.nativeElement.focus();
    });
  }

  protected startEdit(): void {
    this.draft.set(this.person().name);
    this.renameFailed.set(false);
    this.editing.set(true);
  }

  protected cancel(): void {
    this.editing.set(false);
  }

  protected async commit(): Promise<void> {
    const name = this.draft().trim();
    if (name === '' || name === this.person().name) return this.cancel();
    this.saving.set(true);
    try {
      await this.store.rename(this.person().personId, name);
      this.editing.set(false);
    } catch {
      this.renameFailed.set(true);
    } finally {
      this.saving.set(false);
    }
  }
}
