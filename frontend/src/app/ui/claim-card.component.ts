import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Claim, Person } from '@myclaimgrid/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { McgCurrencyPipe, McgDatePipe } from '../core/pipes';
import { IconComponent } from './icon.component';
import { PaymentBadgeComponent, ReimbursementBadgeComponent } from './tracking-badges.component';

/**
 * One claim, compact (design-system/components/ClaimCard): provider, date and invoice number, a
 * file icon when insurer documents are attached, the reimbursement and the payment status as two
 * separate badges and the invoice amount. The provider is a real button that covers the whole
 * card, so a click anywhere opens the claim dialog and the keyboard has one tab stop per card.
 */
@Component({
  selector: 'article[mcg-claim-card]',
  imports: [
    TranslocoPipe,
    McgCurrencyPipe,
    McgDatePipe,
    IconComponent,
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
      @if (claim().documents.length > 0) {
        <span
          class="app-claim-card__docs"
          data-testid="card-documents"
          role="img"
          [attr.aria-label]="('card.documents' | transloco) + ': ' + claim().documents.length"
          [attr.title]="('card.documents' | transloco) + ': ' + claim().documents.length"
        >
          <mcg-icon name="file" />
        </span>
      }
    </p>
    <div class="app-claim-card__status">
      <div>
        <span class="mcg-label">{{ 'reimbursement.section' | transloco }}</span>
        <mcg-reimbursement-badge [status]="claim().reimbursement.status" />
      </div>
      <div>
        <span class="mcg-label">{{ 'payment.title' | transloco }}</span>
        <mcg-payment-badge [paidAt]="claim().paidAt" />
      </div>
      <div>
        <span class="mcg-label">{{ 'card.invoiceAmount' | transloco }}</span>
        <span class="app-claim-card__amount" data-testid="card-amount">{{
          claim().amount | mcgCurrency
        }}</span>
      </div>
    </div>
  `,
})
export class ClaimCardComponent {
  readonly claim = input.required<Claim>();
  /** Set where claims of several persons are mixed. */
  readonly person = input<Person | null>(null);
  readonly selected = input(false);
  readonly open = output<string>();
}
