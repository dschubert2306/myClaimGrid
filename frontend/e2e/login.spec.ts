import { expect, test, type Page } from '@playwright/test';
import { mockBackend } from './support';

// Same values as FAKE_* in src/testing/fake-auth.service.ts
const PASSWORD = 'correct-horse-battery';

test.use({ locale: 'de-DE' });

const signInButton = (page: Page) => page.getByRole('button', { name: 'Anmelden', exact: true });

async function fillCredentials(page: Page, email: string, password: string) {
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
}

test.describe('sign-in', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('a signed-out request lands on /login with the email and password form', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('E-Mail')).toBeVisible();
    await expect(page.getByLabel('Passwort', { exact: true })).toHaveAttribute('type', 'password');
    await expect(signInButton(page)).toBeEnabled();
    await expect(page.getByText('Zugang nur auf Einladung')).toBeVisible();
    await expect(page.getByText(/Registrieren|Konto erstellen|Sign up|Create account/)).toHaveCount(
      0,
    );
  });

  test('signing in returns to the remembered route', async ({ page }) => {
    await page.goto('/?year=2025');
    await expect(page).toHaveURL(/\/login$/);
    await fillCredentials(page, 'me@example.test', PASSWORD);
    await signInButton(page).click();
    await expect(page).toHaveURL(/\/\?year=2025$/);
    await expect(page.getByRole('banner')).toBeVisible(); // the top bar of the signed-in app
  });

  test('empty or invalid input is explained under the field and nothing is sent', async ({
    page,
  }) => {
    await page.goto('/login');
    await signInButton(page).click();
    await expect(page.getByText('Bitte fülle dieses Feld aus.')).toHaveCount(2);
    await expect(page.getByLabel('E-Mail')).toBeFocused();
    await page.getByLabel('E-Mail').fill('not-an-address');
    await expect(page.getByText('Bitte gib eine gültige E-Mail-Adresse ein.')).toBeVisible();
  });

  test('a wrong password shows a friendly error and clears the password', async ({ page }) => {
    await page.goto('/login');
    await fillCredentials(page, 'me@example.test', 'wrong-password');
    await signInButton(page).click();
    await expect(page.getByRole('alert')).toContainText('E-Mail oder Passwort stimmt nicht.');
    await expect(page.getByRole('alert')).not.toContainText(/NotAuthorized|Exception/);
    await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('');
    await expect(page).toHaveURL(/\/login$/);
  });

  test.describe('other failures', () => {
    for (const [email, text] of [
      ['throttled@example.test', 'Zu viele Versuche'],
      ['offline@example.test', 'Keine Verbindung zum Server'],
    ] as const) {
      test(`${email} shows its message`, async ({ page }) => {
        await page.goto('/login');
        await fillCredentials(page, email, PASSWORD);
        await signInButton(page).click();
        await expect(page.getByRole('alert')).toContainText(text);
      });
    }
  });

  test('the button disables itself while signing in, so a second click does not send again', async ({
    page,
  }) => {
    await page.addInitScript(() => sessionStorage.setItem('fake.mode', 'hang'));
    await page.goto('/login');
    await fillCredentials(page, 'me@example.test', PASSWORD);
    await signInButton(page).click();
    const busy = page.getByRole('button', { name: /Anmeldung läuft/ });
    await expect(busy).toBeDisabled();
    await busy.click({ force: true }); // a user hammering the button
    await page.getByLabel('Passwort', { exact: true }).press('Enter');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => sessionStorage.getItem('fake.signInCalls'))).toBe('1');
  });

  test('a user created by the administrator chooses a new password on first sign-in', async ({
    page,
  }) => {
    await page.goto('/login');
    await fillCredentials(page, 'invited@example.test', PASSWORD);
    await signInButton(page).click();
    await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeVisible();
    await expect(page.getByLabel('Neues Passwort', { exact: true })).toBeFocused();

    await page.getByLabel('Neues Passwort', { exact: true }).fill('A-much-longer-Password1');
    await page.getByLabel('Neues Passwort wiederholen').fill('something-else');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByText('Die Passwörter stimmen nicht überein.')).toBeVisible();

    await page.getByLabel('Neues Passwort', { exact: true }).fill('short');
    await page.getByLabel('Neues Passwort wiederholen').fill('short');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByRole('alert')).toContainText('Dieses Passwort wird nicht akzeptiert');

    await page.getByLabel('Neues Passwort', { exact: true }).fill('A-much-longer-Password1');
    await page.getByLabel('Neues Passwort wiederholen').fill('A-much-longer-Password1');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('a user with an authenticator app enters the code', async ({ page }) => {
    await page.goto('/login');
    await fillCredentials(page, 'mfa@example.test', PASSWORD);
    await signInButton(page).click();
    await expect(page.getByRole('heading', { name: 'Code eingeben' })).toBeVisible();
    await page.getByLabel('Code').fill('000000');
    await page.getByRole('button', { name: 'Bestätigen' }).click();
    await expect(page.getByRole('alert')).toContainText('Der Code stimmt nicht');
    await page.getByLabel('Code').fill('123456');
    await page.getByRole('button', { name: 'Bestätigen' }).click();
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('forgot password: request a code, set a new password, sign in again', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Passwort vergessen?' }).click();
    await expect(page.getByRole('heading', { name: 'Passwort zurücksetzen' })).toBeVisible();
    await page.getByLabel('E-Mail').fill('me@example.test');
    await page.getByRole('button', { name: 'Code senden' }).click();

    await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeVisible();
    await expect(page.getByText('Falls es ein Konto für me@example.test gibt')).toBeVisible();
    await page.getByLabel('Code').fill('123456');
    await page.getByLabel('Neues Passwort', { exact: true }).fill('A-much-longer-Password1');
    await page.getByLabel('Neues Passwort wiederholen').fill('A-much-longer-Password1');
    await page.getByRole('button', { name: 'Passwort festlegen' }).click();

    await expect(page.getByRole('status')).toContainText('Dein Passwort wurde geändert');
    await expect(page.getByLabel('E-Mail')).toHaveValue('me@example.test');
    await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('');
  });

  test('signing out shows the signed-out notice once', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fake.seeded')) {
        sessionStorage.setItem('fake.seeded', '1');
        sessionStorage.setItem('fake.auth', '1');
      }
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status')).toContainText('Du wurdest abgemeldet');
    await page.reload();
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('language and theme can be chosen before signing in and carry over', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.getByRole('button', { name: /^Dark$|Dunkel/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('Email').fill('me@example.test');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
