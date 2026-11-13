import { expect, test } from '@playwright/test';
import { mockBackend, signedIn, type MockApi } from './support';

test.use({ locale: 'de-DE' });

let api: MockApi;

test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
    api = await mockBackend(page, [
      {
        personId: '00000000-0000-4000-8000-000000000001',
        amount: 30000,
        invoiceDate: '2026-03-12',
        year: 2026,
      },
    ]);
  });

  test('the top bar links to the settings and back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Einstellungen' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Einstellungen', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Zurück zu den Rechnungen' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('names and Selbstbehalt are validated, saved, and shown on the dashboard', async ({
    page,
  }) => {
    await page.goto('/settings');
    const save = page.getByRole('button', { name: 'Speichern' });
    await expect(save).toBeDisabled(); // nothing changed yet

    const names = page.getByLabel('Name');
    const deductibles = page.getByLabel('Selbstbehalt pro Jahr');
    await expect(names).toHaveCount(3);
    await expect(names.first()).toHaveValue('Anna');

    await names.first().fill('  ');
    await deductibles.first().fill('abc');
    await save.click();
    await expect(page.getByText('Bitte fülle dieses Feld aus.')).toBeVisible();
    await expect(page.getByText('Bitte gib einen Betrag von 0 bis 100.000 ein.')).toBeVisible();
    expect(api.requests.some((r) => r.startsWith('PUT /persons'))).toBe(false);

    await names.first().fill('Anna Huber');
    await deductibles.first().fill('1.000');
    await save.click();
    await expect(page.getByText('Die Einstellungen wurden gespeichert.')).toBeVisible();
    expect(api.persons[0]).toMatchObject({ name: 'Anna Huber', deductible: 100000 });
    // only the changed person was sent
    expect(api.requests.filter((r) => r.startsWith('PUT /persons'))).toHaveLength(1);
    await expect(deductibles.first()).toHaveValue('1.000,00');

    await page.getByRole('button', { name: 'Zurück zu den Rechnungen' }).click();
    const card = page.locator('section.mcg-person', { hasText: 'Anna Huber' });
    await expect(card.getByRole('progressbar')).toBeVisible();
    await expect(card).toContainText('Selbstbehalt: noch 700,00');
    await expect(card).toContainText('1.000,00');
    // a person without Selbstbehalt shows no bar
    await expect(
      page.locator('section.mcg-person', { hasText: 'Jonas' }).getByRole('progressbar'),
    ).toHaveCount(0);
  });

  test('the date format applies at once, to the table and the date field, and is remembered', async ({
    page,
  }) => {
    await page.goto('/settings');
    await page.getByLabel('Datumsformat').selectOption('yyyy-MM-dd');
    await page.getByLabel('Zeitformat').selectOption('12h');
    await expect(page.getByText('2026-03-12, 2:30 pm')).toBeVisible();

    await page.getByRole('button', { name: 'Zurück zu den Rechnungen' }).click();
    await expect(page.getByRole('cell', { name: '2026-03-12' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('cell', { name: '2026-03-12' })).toBeVisible();

    await page.getByRole('button', { name: 'Neue Rechnung' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Neue Rechnung' });
    await dialog.locator('label', { hasText: 'Manuell erfassen' }).click();
    await dialog.getByLabel('Person').selectOption({ label: 'Jonas' });
    await dialog.getByRole('button', { name: 'Weiter' }).click();
    await expect(dialog.getByLabel('Datum', { exact: true })).toHaveAttribute(
      'placeholder',
      'JJJJ-MM-TT',
    );
    await dialog.getByLabel('Datum', { exact: true }).fill('2026-04-01');
    await dialog.getByLabel('Arzt oder Klinik').fill('Praxis');
    await dialog.getByLabel('Betrag').fill('10');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    expect(api.claims.some((c) => c.invoiceDate === '2026-04-01')).toBe(true);
  });
});
