import { defineConfig, devices } from '@playwright/test';

// End to end tests run against the "e2e" build: a fake auth service replaces Cognito and
// every API and S3 call is answered by the test (see e2e/support.ts).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4300', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start:e2e',
    url: 'http://localhost:4300',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
