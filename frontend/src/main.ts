import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // Boot failures (for example a missing config.json) must not leave a blank page.
  document.body.textContent = 'myClaimGrid could not start.';
  throw error;
});
