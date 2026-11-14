import { Injectable, computed, inject, signal } from '@angular/core';
import type { Claim, DashboardResponse, Person } from '@myclaimgrid/shared';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiClient } from './api.client';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PersonFigures {
  count: number;
  totalAmount: number;
  reimbursedAmount: number;
  outstandingAmount: number;
  selfBorneAmount: number;
}

/** Data of the dashboard for the selected year: persons, totals and the claims per person. */
@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly api = inject(ApiClient);
  private requestId = 0;

  readonly year = signal(new Date().getFullYear());
  readonly status = signal<LoadStatus>('idle');
  readonly persons = signal<Person[]>([]);
  readonly dashboard = signal<DashboardResponse | null>(null);
  readonly claims = signal<Record<string, Claim[]>>({});

  /** Years with data plus the current year, newest first. */
  readonly years = computed(() => {
    const years = new Set(this.dashboard()?.years ?? []);
    years.add(new Date().getFullYear());
    years.add(this.year());
    return [...years].sort((a, b) => b - a);
  });
  /** False only when the whole account has no claim in any year. */
  readonly hasAnyClaims = computed(() => (this.dashboard()?.years.length ?? 0) > 0);

  figures(personId: string): PersonFigures {
    const entry = this.dashboard()?.persons.find((p) => p.personId === personId);
    return {
      count: entry?.count ?? 0,
      totalAmount: entry?.totalAmount ?? 0,
      reimbursedAmount: entry?.reimbursedAmount ?? 0,
      outstandingAmount: entry?.outstandingAmount ?? 0,
      selfBorneAmount: entry?.selfBorneAmount ?? 0,
    };
  }

  /** Every claim of the year with its person, newest invoice first (the list view). */
  readonly allClaims = computed(() => {
    const persons = this.persons();
    const claims = this.claims();
    return persons
      .flatMap((person) => (claims[person.personId] ?? []).map((claim) => ({ claim, person })))
      .sort((a, b) => (b.claim.invoiceDate ?? '').localeCompare(a.claim.invoiceDate ?? ''));
  });

  setYear(year: number): Promise<void> {
    this.year.set(year);
    return this.load();
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    const year = this.year();
    this.status.set('loading');
    try {
      const { persons } = await firstValueFrom(this.api.persons()); // seeds the three persons on first use
      const [dashboard, claimLists] = await firstValueFrom(
        forkJoin([
          this.api.dashboard(year),
          forkJoin(persons.map((p) => this.api.personClaims(p.personId, year))),
        ]),
      );
      if (id !== this.requestId) return; // a newer load has started
      this.persons.set(persons);
      this.dashboard.set(dashboard);
      this.claims.set(
        Object.fromEntries(persons.map((p, i) => [p.personId, claimLists[i]?.claims ?? []])),
      );
      this.status.set('ready');
    } catch {
      if (id === this.requestId) this.status.set('error');
    }
  }

  /** Name and Selbstbehalt of one person. The color is not editable. */
  async savePerson(
    personId: string,
    changes: { name: string; deductible?: number },
  ): Promise<void> {
    const person = await firstValueFrom(this.api.renamePerson(personId, changes));
    this.persons.update((list) => list.map((p) => (p.personId === personId ? person : p)));
    this.dashboard.update((d) =>
      d
        ? {
            ...d,
            persons: d.persons.map((p) =>
              p.personId === personId ? { ...p, name: person.name } : p,
            ),
          }
        : d,
    );
  }

  rename(personId: string, name: string): Promise<void> {
    return this.savePerson(personId, { name });
  }

  /** Persons for the settings: the loaded ones, or a fresh read (this also seeds the three persons). */
  async ensurePersons(): Promise<void> {
    if (this.persons().length > 0) return;
    const { persons } = await firstValueFrom(this.api.persons());
    this.persons.set(persons);
  }
}
