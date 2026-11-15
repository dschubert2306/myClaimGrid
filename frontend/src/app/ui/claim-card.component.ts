import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { differenceToInvoice, type Claim, type Person } from '@myclaimgrid/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { McgCurrencyPipe, McgDatePipe } from '../core/pipes';
import { PaymentBadgeComponent, ReimbursementBadgeComponent } from './tracking-badges.component';

/**
 * One claim with all its status fields at a glance (design-system/components/ClaimCard): the
 * reimbursement and the payment status as two separate badges, the amounts, the submission date
 * and the number of insurer documents. The provider is a real button that covers the whole card,
 * so a click anywhere opens the claim dialog and the keyboard has one tab stop per card.
 */
@Component({
  selector: 'article[mcg-claim-card]',
  imports: [
    TranslocoPipe,
    McgCurrencyPipe,
    McgDatePipe,
    PaymentBadgeComponent,
    ReimbursementBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'app-claim-card',
    '[class.is-selected]': 'selected()',
    '[attr.aria-current]': "selected() ? 'true' : null",
  },
  template: `
    <h3 class="app-claim-card__title">
      <button type="button" class="app-claim-card__open" (click)="open.emit(claim().claimId)">
        {{ claim().provider }}
      </button>
    </h3>
    <p class="app-claim-card__meta">
      <span class="mcg-num">{{ claim().invoiceDate | mcgDate }}</span>
      @if (claim().invoiceNumber) {
        <span class="mcg-mono">{{ claim().invoiceNumber }}</span>
      }
      @if (person(); as p) {
        <span class="app-person-mark" [style.--person]="'var(--' + p.color + ')'">{{
          p.name
        }}</span>
      }
    </p>
    <div class="app-claim-card__badges">
      <div>
        <span class="mcg-label">{{ 'reimbursement.section' | transloco }}</span>
        <mcg-reimbursement-badge [status]="claim().reimbursement.status" />
      </div>
      <div>
        <span class="mcg-label">{{ 'payment.title' | transloco }}</span>
        <mcg-payment-badge [paidAt]="claim().paidAt" />
      </div>
    </div>
    <dl class="app-claim-card__figures">
      <div>
        <dt class="mcg-label">{{ 'card.invoiceAmount' | transloco }}</dt>
        <dd data-testid="card-amount">{{ claim().amount | mcgCurrency }}</dd>
      </div>
      <div>
        <dt class="mcg-label">{{ 'card.reimbursed' | transloco }}</dt>
        <dd data-testid="card-reimbursed">{{ claim().reimbursement.reimbursed | mcgCurrency }}</dd>
      </div>
      <div>
        <dt class="mcg-label">{{ 'card.outstanding' | transloco }}</dt>
        <dd data-testid="card-outstanding">
          {{ claim().reimbursement.outstanding | mcgCurrency }}
        </dd>
      </div>
      @if (difference() !== null) {
        <div>
          <dt class="mcg-label">{{ 'card.difference' | transloco }}</dt>
          <dd data-testid="card-difference">{{ difference() | mcgCurrency }}</dd>
        </div>
      }
      <div>
        <dt class="mcg-label">{{ 'card.submitted' | transloco }}</dt>
        <dd data-testid="card-submitted" class="app-claim-card__plain">
          {{ claim().submittedAt ? (claim().submittedAt | mcgDate) : ('card.notYet' | transloco) }}
        </dd>
      </div>
      <div>
        <dt class="mcg-label">{{ 'card.documents' | transloco }}</dt>
        <dd data-testid="card-documents" class="app-claim-card__plain">
          {{ claim().documents.length }}
        </dd>
      </div>
    </dl>
  `,
})
export class ClaimCardComponent {
  readonly claim = input.required<Claim>();
  /** Set in the list view, where claims of all persons are mixed. */
  readonly person = input<Person | null>(null);
  readonly selected = input(false);
  readonly open = output<string>();

  /** What the insurer has not paid out yet: only shown for a partial reimbursement. */
  protected readonly difference = computed(() => {
    const { amount, reimbursement } = this.claim();
    return reimbursement.status === 'PARTLY_PAID' && amount !== null
      ? differenceToInvoice(amount, reimbursement.reimbursed)
      : null;
  });
}
