import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
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
  host: { class: 'app-badge-group' },
  template: `<span
      class="mcg-badge"
      data-testid="reimbursement-badge"
      [class.mcg-badge--pending]="status() === 'IN_PROGRESS'"
      [class.mcg-badge--partial]="status() === 'PARTLY_PAID'"
      [class.mcg-badge--done]="status() === 'PAID'"
      >{{ 'reimbursement.status.' + status() | transloco }}</span
    >
    @if (notSubmitted()) {
      <span class="app-badge-note">{{ 'reimbursement.notSubmitted' | transloco }}</span>
    }`,
})
export class ReimbursementBadgeComponent {
  readonly status = input.required<ReimbursementStatus>();
  /** Pass the submission date to show "nicht eingereicht" next to an OPEN status. */
  readonly submittedAt = input<string | null | undefined>(undefined);
  protected readonly notSubmitted = computed(
    () => this.status() === 'OPEN' && this.submittedAt() === null,
  );
}

@Component({
  selector: 'mcg-payment-badge',
  imports: [TranslocoPipe, McgDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="mcg-badge"
    data-testid="payment-badge"
    [class.mcg-badge--done]="!!paidAt()"
    [attr.title]="
      paidAt() ? ('reimbursement.payment.paidOn' | transloco: { date: paidAt() | mcgDate }) : null
    "
    >{{
      (paidAt() ? 'reimbursement.payment.paid' : 'reimbursement.payment.unpaid') | transloco
    }}</span
  >`,
})
export class PaymentBadgeComponent {
  readonly paidAt = input.required<string | null>();
}
