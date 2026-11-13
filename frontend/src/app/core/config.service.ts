import { Injectable } from '@angular/core';
import { from, shareReplay, type Observable } from 'rxjs';

/** Written by the CDK app at deploy time (FrontendDeployStack), read at runtime. */
export interface AppConfig {
  region: string;
  apiUrl: string;
  userPoolId: string;
  clientId: string;
  authority: string;
  hostedUiUrl: string;
}

/**
 * Loads /config.json once. It uses fetch on purpose, not HttpClient: the auth interceptor needs
 * this configuration, so going through HttpClient would be circular.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly config$: Observable<AppConfig> = from(
    fetch('/config.json', { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`config.json: ${response.status}`);
      return response.json() as Promise<AppConfig>;
    }),
  ).pipe(shareReplay({ bufferSize: 1, refCount: false }));
}
