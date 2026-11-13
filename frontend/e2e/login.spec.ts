import { expect, test } from '@playwright/test';
import { mockBackend } from './support';

test.describe('sign-in', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('a signed-out request lands on /login, which has a sign-in button and no password field', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /Anmelden|Sign in/ })).toBeEnabled();
    await expect(page.locator('input')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(
      page.getByText(/Zugang nur auf Einladung|Access by invitation only/),
    ).toBeVisible();
    await expect(page.getByText(/Registrieren|Konto erstellen|Sign up|Create account/)).toHaveCount(
      0,
    );
  });

  test('signing in goes through /auth/callback and returns to the remembered route', async ({
    page,
  }) => {
    await page.goto('/?year=2025');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('button', { name: /Anmelden|Sign in/ }).click();
    await expect(page).toHaveURL(/\/\?year=2025$/);
    await expect(page.getByRole('banner')).toBeVisible(); // the top bar of the signed-in app
  });

  test('the button disables itself after the click, so a second click does not start another flow', async ({
    page,
  }) => {
    await page.addInitScript(() => sessionStorage.setItem('fake.mode', 'hang'));
    await page.goto('/login');
    await page.getByRole('button', { name: /Anmelden|Sign in/ }).click();
    const redirecting = page.getByRole('button', { name: /Weiterleitung|Redirecting/ });
    await expect(redirecting).toBeDisabled();
    await redirecting.click({ force: true }); // a user hammering the button
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => sessionStorage.getItem('fake.loginCalls'))).toBe('1');
  });

  test('a failed callback shows the friendly error notice without technical codes', async ({
    page,
  }) => {
    await page.addInitScript(() => sessionStorage.setItem('fake.mode', 'error'));
    await page.goto('/login');
    await page.getByRole('button', { name: /Anmelden|Sign in/ }).click();
    await expect(page).toHaveURL(/\/login$/);
    const notice = page.getByRole('alert');
    await expect(notice).toContainText(/Die Anmeldung hat nicht geklappt|Sign-in did not work/);
    await expect(notice).not.toContainText(/access_denied|error=/);
  });

  test('signing out shows the signed-out notice once', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fake.seeded')) {
        sessionStorage.setItem('fake.seeded', '1');
        sessionStorage.setItem('fake.auth', '1');
      }
    });
    await page.goto('/');
    await page.getByRole('button', { name: /Abmelden|Sign out/ }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status')).toContainText(
      /Du wurdest abgemeldet|You have been signed out/,
    );
    await page.reload();
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('language and theme can be chosen before signing in and carry over', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.getByRole('button', { name: /^Dark$|Dunkel/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
