import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ReimbursementStatus } from '@myclaimgrid/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { McgDatePipe } from '../core/pipes';

/**
 * The two independent status indicators of a claim (design-system/components/StatusBadge):
 * how far the insurer is with the reimbursement, and whether the user paid the invoice.
 * They are never merged into one badge.
 */
@Component({
  selector: 'mcg-reimbursement-badge',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="mcg-badge"
    data-testid="reimbursement-badge"
    [class.mcg-badge--pending]="status() === 'IN_PROGRESS'"
    [class.mcg-badge--partial]="status() === 'PARTLY_PAID'"
    [class.mcg-badge--done]="status() === 'PAID'"
    >{{ 'reimbursement.status.' + status() | transloco }}</span
  >`,
})
export class ReimbursementBadgeComponent {
  readonly status = input.required<ReimbursementStatus>();
}

/** Payment status: "Paid on 20.03.2026" or "Not paid". The date is part of the badge. */
@Component({
  selector: 'mcg-payment-badge',
  imports: [TranslocoPipe, McgDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="mcg-badge"
    data-testid="payment-badge"
    [class.mcg-badge--done]="!!paidAt()"
    >{{
      paidAt()
        ? ('payment.paidOn' | transloco: { date: paidAt() | mcgDate })
        : ('payment.unpaid' | transloco)
    }}</span
  >`,
})
export class PaymentBadgeComponent {
  readonly paidAt = input.required<string | null>();
}
