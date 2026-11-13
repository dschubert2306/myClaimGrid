import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Claim } from '@myclaimgrid/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { McgCurrencyPipe, McgDatePipe } from '../core/pipes';
import { StatusBadgeComponent } from './status-badge.component';

@Component({
  selector: 'mcg-claim-table',
  imports: [TranslocoPipe, McgCurrencyPipe, McgDatePipe, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table class="mcg-table">
      <thead>
        <tr>
          <th>{{ 'table.date' | transloco }}</th>
          <th>{{ 'table.provider' | transloco }}</th>
          <th class="mcg-table__invoice">{{ 'table.invoiceNumber' | transloco }}</th>
          <th class="mcg-table__amount" style="font-size: 12px">
            {{ 'table.amount' | transloco }}
          </th>
          <th class="mcg-table__status">{{ 'table.status' | transloco }}</th>
        </tr>
      </thead>
      <tbody>
        @for (claim of claims(); track claim.claimId) {
          <tr
            tabindex="0"
            [attr.aria-selected]="claim.claimId === selectedId()"
            (click)="open.emit(claim.claimId)"
            (keydown.enter)="open.emit(claim.claimId)"
            (keydown.space)="$event.preventDefault(); open.emit(claim.claimId)"
          >
            <td class="mcg-num">{{ claim.invoiceDate | mcgDate }}</td>
            <td class="mcg-table__provider">{{ claim.provider }}</td>
            <td class="mcg-table__invoice mcg-mono">{{ claim.invoiceNumber }}</td>
            <td class="mcg-table__amount">{{ claim.amount | mcgCurrency }}</td>
            <td class="mcg-table__status"><mcg-status-badge [status]="claim.status" /></td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class ClaimTableComponent {
  readonly claims = input.required<Claim[]>();
  readonly selectedId = input<string | null>(null);
  readonly open = output<string>();
}
