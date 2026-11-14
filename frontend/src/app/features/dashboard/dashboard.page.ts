import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { map } from 'rxjs';
import { LanguageService } from '../../core/language.service';
import { DashboardStore } from '../../core/dashboard.store';
import { ButtonComponent } from '../../ui/button.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { NoticeComponent } from '../../ui/notice.component';
import { PersonCardComponent } from '../../ui/person-card.component';
import { ProgressComponent } from '../../ui/progress.component';
import { SegmentedComponent, type SegmentOption } from '../../ui/segmented.component';
import { ClaimDialogService } from '../claim-dialog/claim-dialog.service';
import { ClaimListComponent } from './claim-list.component';

type View = 'overview' | 'list';

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
    SegmentedComponent,
    ClaimListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-page' },
  template: `
    <div class="app-page__head">
      <h1 class="mcg-type-title-1" style="margin: 0">
        {{ 'dashboard.title' | transloco: { year: store.year() } }}
      </h1>
      <div class="mcg-row">
        <mcg-segmented
          [label]="'dashboard.views.label' | transloco"
          [options]="viewOptions()"
          [value]="view()"
          (valueChange)="setView($event)"
        />
        <button mcg-button variant="primary" (click)="openNew()">
          <mcg-icon name="plus" />{{ 'dashboard.newClaim' | transloco }}
        </button>
      </div>
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
        } @else if (view() === 'list') {
          <mcg-claim-list
            [rows]="store.allClaims()"
            [persons]="store.persons()"
            [year]="store.year()"
            [selectedId]="selectedId()"
            (open)="openExisting($event)"
          />
        } @else {
          <div class="app-grid">
            @for (person of store.persons(); track person.personId) {
              <section
                mcg-person-card
                [person]="person"
                [year]="store.year()"
                [figures]="store.figures(person.personId)"
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly i18n = inject(TranslocoService);
  private readonly language = inject(LanguageService);
  protected readonly selectedId = signal<string | null>(null);

  /** Overview (person cards) or list (all claims with the status columns and filters), in the URL. */
  protected readonly view = toSignal(
    this.route.queryParamMap.pipe(
      map((params): View => (params.get('view') === 'list' ? 'list' : 'overview')),
    ),
    { initialValue: 'overview' as View },
  );
  protected readonly viewOptions = computed((): SegmentOption<View>[] => {
    this.language.lang();
    return [
      { value: 'overview', label: this.i18n.translate('dashboard.views.overview') },
      { value: 'list', label: this.i18n.translate('dashboard.views.list') },
    ];
  });

  protected setView(view: View): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: view === 'list' ? 'list' : null },
      queryParamsHandling: 'merge',
    });
  }

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
