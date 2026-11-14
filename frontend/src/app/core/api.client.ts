import { HttpClient, HttpEventType, type HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  Claim,
  ClaimDetail,
  ClaimsResponse,
  CreateDocumentUploadRequest,
  CreateDocumentUploadResponse,
  CreateEntryRequestInput,
  CreateManualClaimRequest,
  CreateUploadResponse,
  DashboardResponse,
  DocumentUrlResponse,
  Person,
  PersonsResponse,
  RenamePersonRequest,
  SaveClaimRequest,
} from '@myclaimgrid/shared';
import { filter, map, switchMap, type Observable } from 'rxjs';
import { ConfigService } from './config.service';

export type UploadEvent = { kind: 'progress'; percent: number } | { kind: 'done' };

/** Typed access to the myClaimGrid API. The bearer token is added by the auth interceptor. */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private url(path: string): Observable<string> {
    return this.config.config$.pipe(map((config) => `${config.apiUrl}${path}`));
  }

  persons(): Observable<PersonsResponse> {
    return this.url('/persons').pipe(switchMap((url) => this.http.get<PersonsResponse>(url)));
  }

  renamePerson(personId: string, body: RenamePersonRequest): Observable<Person> {
    return this.url(`/persons/${personId}`).pipe(
      switchMap((url) => this.http.put<Person>(url, body)),
    );
  }

  dashboard(year: number): Observable<DashboardResponse> {
    return this.url(`/dashboard?year=${year}`).pipe(
      switchMap((url) => this.http.get<DashboardResponse>(url)),
    );
  }

  personClaims(personId: string, year: number): Observable<ClaimsResponse> {
    return this.url(`/persons/${personId}/claims?year=${year}`).pipe(
      switchMap((url) => this.http.get<ClaimsResponse>(url)),
    );
  }

  claim(claimId: string): Observable<ClaimDetail> {
    return this.url(`/claims/${claimId}`).pipe(switchMap((url) => this.http.get<ClaimDetail>(url)));
  }

  createUpload(personId: string): Observable<CreateUploadResponse> {
    return this.url('/uploads').pipe(
      switchMap((url) => this.http.post<CreateUploadResponse>(url, { personId })),
    );
  }

  createClaim(body: CreateManualClaimRequest): Observable<Claim> {
    return this.url('/claims').pipe(switchMap((url) => this.http.post<Claim>(url, body)));
  }

  saveClaim(claimId: string, body: SaveClaimRequest): Observable<Claim> {
    return this.url(`/claims/${claimId}`).pipe(switchMap((url) => this.http.put<Claim>(url, body)));
  }

  deleteClaim(claimId: string): Observable<void> {
    return this.url(`/claims/${claimId}`).pipe(switchMap((url) => this.http.delete<void>(url)));
  }

  // ------------------------------------------------------------ reimbursement

  /** Presigned POST for one insurer document, uploaded with `uploadToS3` before the entry is saved. */
  createDocumentUpload(
    claimId: string,
    body: CreateDocumentUploadRequest,
  ): Observable<CreateDocumentUploadResponse> {
    return this.url(`/claims/${claimId}/documents`).pipe(
      switchMap((url) => this.http.post<CreateDocumentUploadResponse>(url, body)),
    );
  }

  addEntry(claimId: string, body: CreateEntryRequestInput): Observable<Claim> {
    return this.url(`/claims/${claimId}/entries`).pipe(
      switchMap((url) => this.http.post<Claim>(url, body)),
    );
  }

  deleteEntry(claimId: string, entryId: string): Observable<Claim> {
    return this.url(`/claims/${claimId}/entries/${entryId}`).pipe(
      switchMap((url) => this.http.delete<Claim>(url)),
    );
  }

  deleteDocument(claimId: string, documentId: string): Observable<Claim> {
    return this.url(`/claims/${claimId}/documents/${documentId}`).pipe(
      switchMap((url) => this.http.delete<Claim>(url)),
    );
  }

  /** A fresh link that expires after a minute. Fetched on each click, never stored. */
  documentUrl(claimId: string, documentId: string): Observable<DocumentUrlResponse> {
    return this.url(`/claims/${claimId}/documents/${documentId}/url`).pipe(
      switchMap((url) => this.http.get<DocumentUrlResponse>(url)),
    );
  }

  /**
   * Sends the PDF straight to S3 with the presigned POST. The file must be the last form field.
   * The auth interceptor only adds the token to the API, so no Authorization header reaches S3.
   */
  uploadToS3(
    upload: { url: string; fields: Record<string, string> },
    file: File,
  ): Observable<UploadEvent> {
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
    form.append('file', file);
    return this.http.post(upload.url, form, { reportProgress: true, observe: 'events' }).pipe(
      map((event: HttpEvent<unknown>): UploadEvent | null => {
        if (event.type === HttpEventType.UploadProgress) {
          return {
            kind: 'progress',
            percent: event.total ? Math.round((event.loaded / event.total) * 100) : 0,
          };
        }
        return event.type === HttpEventType.Response ? { kind: 'done' } : null;
      }),
      filter((event): event is UploadEvent => event !== null),
    );
  }
}
