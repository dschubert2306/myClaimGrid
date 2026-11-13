import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DashboardStore } from '../../core/dashboard.store';
import { ButtonComponent } from '../../ui/button.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { PersonCardComponent } from '../../ui/person-card.component';
import { ProgressComponent } from '../../ui/progress.component';
import { ClaimDialogService } from '../claim-dialog/claim-dialog.service';

@Component({
  selector: 'mcg-dashboard-page',
  imports: [
    TranslocoPipe,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    NoticeComponent,
    PersonCardComponent,
    ProgressComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-page' },
  template: `
    <div class="app-page__head">
      <h1 class="mcg-type-title-1" style="margin: 0">
        {{ 'dashboard.title' | transloco: { year: store.year() } }}
      </h1>
      <button mcg-button variant="primary" (click)="openNew()">
        <mcg-icon name="plus" />{{ 'dashboard.newClaim' | transloco }}
      </button>
    </div>

    @switch (store.status()) {
      @case ('error') {
        <mcg-notice variant="error">
          {{ 'dashboard.loadError' | transloco }}
          <button mcg-button size="sm" style="margin-left: var(--space-2)" (click)="store.load()">
            {{ 'dashboard.retry' | transloco }}
          </button>
        </mcg-notice>
      }
      @case ('ready') {
        @if (!store.hasAnyClaims()) {
          <mcg-empty-state [year]="store.year()" (create)="openNew()" />
        } @else {
          <div class="app-grid">
            @for (person of store.persons(); track person.personId) {
              <section
                mcg-person-card
                [person]="person"
                [year]="store.year()"
                [total]="store.figures(person.personId).totalAmount"
                [count]="store.figures(person.personId).count"
                [claims]="store.claims()[person.personId] ?? []"
                [selectedId]="selectedId()"
                (openClaim)="openExisting($event)"
              ></section>
            }
          </div>
        }
      }
      @default {
        <div class="app-center__box" style="margin: var(--space-12) 0">
          <mcg-progress [label]="'dashboard.loading' | transloco" [percent]="null" />
        </div>
      }
    }
  `,
})
export class DashboardPage {
  protected readonly store = inject(DashboardStore);
  private readonly dialog = inject(ClaimDialogService);
  protected readonly selectedId = signal<string | null>(null);

  constructor() {
    void this.store.load();
  }

  protected async openNew(): Promise<void> {
    await this.run({});
  }

  protected async openExisting(claimId: string): Promise<void> {
    this.selectedId.set(claimId);
    await this.run({ claimId });
    this.selectedId.set(null);
  }

  private async run(data: { claimId?: string }): Promise<void> {
    const result = await this.dialog.open(data);
    if (result === 'saved' || result === 'deleted') await this.store.load();
  }
}
