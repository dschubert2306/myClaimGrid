import { expect, test } from '@playwright/test';
import { PDF, mockBackend, signedIn, type MockApi } from './support';

// Fixed language so the assertions read the same everywhere.
test.use({ locale: 'de-DE' });

let api: MockApi;

test.describe('dashboard and claims', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  test('shows the empty state when there are no claims at all', async ({ page }) => {
    api = await mockBackend(page);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Noch keine Rechnungen für \d{4}/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neue Rechnung' }).first()).toBeVisible();
  });

  test('happy path: enter a claim manually and see it under the right person and year', async ({
    page,
  }) => {
    api = await mockBackend(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Neue Rechnung' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Neue Rechnung' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /PDF hochladen/ })).toBeFocused();

    // Step 1: the person is required.
    // The radio input is visually hidden by the design system, people click its label.
    await dialog.locator('label', { hasText: 'Manuell erfassen' }).click();
    await dialog.getByRole('button', { name: 'Weiter' }).click();
    await expect(dialog.getByText('Bitte wähle eine Person aus.')).toBeVisible();
    await dialog.getByLabel('Person').selectOption({ label: 'Jonas' });
    await dialog.getByRole('button', { name: 'Weiter' }).click();

    // Step 2: validation names what to enter, nothing is sent while invalid.
    await expect(dialog.getByRole('button', { name: 'Zurück' })).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'PDF-Vorschau' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    // Provider, date and amount are required: one sentence under each.
    await expect(dialog.getByText('Bitte fülle dieses Feld aus.')).toHaveCount(3);
    await dialog.getByLabel('Datum').fill('31.02.2026');
    await dialog.getByLabel('Betrag').fill('0');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.getByText('Bitte gib ein gültiges Datum ein.')).toBeVisible();
    await expect(dialog.getByText('Bitte gib einen Betrag größer als 0 ein.')).toBeVisible();
    expect(api.requests.some((r) => r.startsWith('POST /claims'))).toBe(false);

    await dialog.getByLabel('Arzt oder Klinik').fill('Kinderarztpraxis Sonnenstraße');
    await dialog.getByLabel('Rechnungsnummer').fill('RE-2026-00417');
    await dialog.getByLabel('Datum').fill('20.01.2026');
    await dialog.getByLabel('Betrag').fill('1.234,56');
    await dialog.getByRole('button', { name: 'Speichern' }).click();

    await expect(dialog).toHaveCount(0);
    // The sent data is ISO date and integer cents, with no bank fields.
    expect(api.claims).toHaveLength(1);
    expect(api.claims[0]).toMatchObject({
      invoiceDate: '2026-01-20',
      amount: 123456,
      source: 'MANUAL',
      status: 'OPEN',
    });

    // The dashboard refreshed: the claim is in Jonas' column, formatted in German.
    const jonas = page.locator('section.mcg-person', { hasText: 'Jonas' });
    await expect(jonas.getByRole('row', { name: /Kinderarztpraxis Sonnenstraße/ })).toBeVisible();
    await expect(jonas).toContainText('1.234,56');
    await expect(jonas).toContainText('20.01.2026');
    await expect(page.locator('section.mcg-person', { hasText: 'Anna' })).toContainText(
      /noch keine Rechnungen/,
    );
  });

  test('happy path: upload a PDF, review the extracted data, correct it and save', async ({
    page,
  }) => {
    api = await mockBackend(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Neue Rechnung' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Neue Rechnung' });

    await dialog.getByLabel('Person').selectOption({ label: 'Anna' });
    await dialog.getByRole('button', { name: 'Hochladen' }).click();
    await expect(dialog.getByText('Bitte wähle eine PDF-Datei aus.')).toBeVisible();

    await dialog.getByTestId('pdf-input').setInputFiles(PDF);
    await expect(dialog.getByText(PDF.name)).toBeVisible();
    await dialog.getByRole('button', { name: 'Hochladen' }).click();

    // Reading step, then the review step with the PDF next to the form.
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    await expect(dialog.getByLabel('Arzt oder Klinik')).toHaveValue('Praxis Dr. Huber', {
      timeout: 15_000,
    });
    expect(api.uploadedFiles).toBe(1);
    await expect(dialog.getByTestId('pdf-preview')).toHaveAttribute('data', /mock\.pdf$/);
    await expect(dialog.getByLabel('Datum')).toHaveValue('12.03.2026');
    await expect(dialog.getByLabel('Betrag')).toHaveValue('89,40');

    // Extracted fields carry "Aus PDF", the empty one says "Nicht erkannt", nothing is guessed.
    await expect(dialog.locator('.mcg-tag--extracted')).toHaveCount(3);
    await expect(dialog.locator('.mcg-field--missing')).toHaveCount(1);
    await expect(dialog.locator('.mcg-field--missing').getByText('Nicht erkannt')).toBeVisible();
    await expect(dialog.getByLabel('Rechnungsnummer')).toHaveValue('');

    // Correcting a field removes its tag.
    await dialog.getByLabel('Betrag').fill('89,45');
    await expect(dialog.locator('.mcg-tag--extracted')).toHaveCount(2);
    await dialog.getByLabel('Rechnungsnummer').fill('RE-77');
    await expect(dialog.locator('.mcg-field--missing')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);

    const anna = page.locator('section.mcg-person', { hasText: 'Anna' });
    await expect(anna).toContainText('89,45');
    await expect(anna).toContainText('12.03.2026');
    expect(api.claims.find((c) => c.invoiceNumber === 'RE-77')).toMatchObject({
      amount: 8945,
      status: 'OPEN',
      source: 'EXTRACTED',
    });
  });

  test('a PDF that cannot be read opens an empty form with an explanation', async ({ page }) => {
    api = await mockBackend(page);
    api.extraction = 'FAILED';
    await page.goto('/');
    await page.getByRole('button', { name: 'Neue Rechnung' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Person').selectOption({ label: 'Lea' });
    await dialog.getByTestId('pdf-input').setInputFiles(PDF);
    await dialog.getByRole('button', { name: 'Hochladen' }).click();

    await expect(
      dialog.getByText(
        'Die Rechnung konnte nicht ausgelesen werden. Bitte trage die Daten selbst ein.',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByLabel('Arzt oder Klinik')).toHaveValue('');
    await expect(dialog.locator('.mcg-tag--extracted')).toHaveCount(0);
  });

  test('the dropzone rejects files that are not PDFs', async ({ page }) => {
    api = await mockBackend(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Neue Rechnung' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByTestId('pdf-input')
      .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('x') });
    await expect(
      dialog.getByText(/Bitte wähle eine PDF-Datei aus\. Andere Dateitypen/),
    ).toBeVisible();
    await expect(dialog.getByText('foto.png')).toHaveCount(0);
  });

  test('cancelling after the upload deletes the draft, and asks once when fields were edited', async ({
    page,
  }) => {
    api = await mockBackend(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Neue Rechnung' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Person').selectOption({ label: 'Anna' });
    await dialog.getByTestId('pdf-input').setInputFiles(PDF);
    await dialog.getByRole('button', { name: 'Hochladen' }).click();
    await expect(dialog.getByLabel('Arzt oder Klinik')).toHaveValue('Praxis Dr. Huber', {
      timeout: 15_000,
    });
    expect(api.claims).toHaveLength(1); // the draft

    await dialog.getByLabel('Rechnungsnummer').fill('x');
    await page.keyboard.press('Escape');
    await expect(dialog.getByText('Deine Eingaben gehen verloren. Verwerfen?')).toBeVisible();
    await page.keyboard.press('Escape'); // Escape on the question keeps editing
    await expect(dialog.getByText('Deine Eingaben gehen verloren. Verwerfen?')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await dialog.getByRole('button', { name: 'Verwerfen' }).click();

    await expect(dialog).toHaveCount(0);
    expect(api.claims).toHaveLength(0); // draft and its file are gone
    // Focus returns to the button that opened the dialog.
    await expect(page.getByRole('button', { name: 'Neue Rechnung' }).first()).toBeFocused();
  });

  test('an existing claim opens in the review step, can be changed and deleted after confirming', async ({
    page,
  }) => {
    api = await mockBackend(page, [
      {
        provider: 'Zahnarztpraxis Berger',
        amount: 10300,
        invoiceDate: '2026-02-03',
        invoiceNumber: 'Z-1',
      },
    ]);
    await page.goto('/');
    await page.getByRole('row', { name: /Zahnarztpraxis Berger/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Rechnung bearbeiten' });
    await expect(dialog.getByLabel('Arzt oder Klinik')).toHaveValue('Zahnarztpraxis Berger');
    await expect(dialog.getByLabel('Betrag')).toHaveValue('103,00');
    await expect(dialog.locator('.mcg-steps')).toHaveCount(0);

    // Cancelling an existing claim never deletes it.
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.claims).toHaveLength(1);

    await page.getByRole('row', { name: /Zahnarztpraxis Berger/ }).press('Enter');
    await dialog.getByLabel('Betrag').fill('110');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.locator('section.mcg-person', { hasText: 'Anna' })).toContainText('110,00');

    await page.getByRole('row', { name: /Zahnarztpraxis Berger/ }).click();
    await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(dialog.getByText(/werden gelöscht/)).toBeVisible();
    expect(api.claims).toHaveLength(1); // not yet
    await dialog.getByRole('button', { name: 'Rechnung löschen' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.claims).toHaveLength(0);
  });

  test('switching the language reformats dates and amounts without a reload', async ({ page }) => {
    api = await mockBackend(page, [
      { provider: 'Praxis Dr. Huber', amount: 123456, invoiceDate: '2026-03-12' },
    ]);
    await page.goto('/');
    const anna = page.locator('section.mcg-person', { hasText: 'Anna' });
    await expect(anna).toContainText('1.234,56');
    await expect(anna).toContainText('12.03.2026');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(anna).toContainText('€1,234.56');
    await expect(anna).toContainText('12/03/2026');
    await expect(page.getByRole('button', { name: 'New claim' })).toBeVisible();
  });

  test('a person can be renamed inline', async ({ page }) => {
    api = await mockBackend(page, [{}]);
    await page.goto('/');
    const card = page.locator('section.mcg-person').first();
    await card.getByRole('button', { name: 'Umbenennen' }).click();
    await card.getByRole('textbox').fill('Anna-Lena');
    await card.getByRole('button', { name: 'Speichern' }).click();
    await expect(card.getByRole('heading', { name: 'Anna-Lena' })).toBeVisible();
    expect(api.persons[0]!.name).toBe('Anna-Lena');
  });

  test('the year selector lists years with data and the current year, and reloads the dashboard', async ({
    page,
  }) => {
    api = await mockBackend(page, [
      { invoiceDate: '2024-05-01', year: 2024, provider: 'Altpraxis' },
    ]);
    await page.goto('/');
    const select = page.getByLabel('Jahr');
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options.map((o) => o.trim())).toEqual(
      [String(new Date().getFullYear()), '2024'].sort((a, b) => Number(b) - Number(a)),
    );
    await select.selectOption('2024');
    await expect(page.getByRole('row', { name: /Altpraxis/ })).toBeVisible();
  });
});

test.describe('calendar', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
    api = await mockBackend(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Neue Rechnung' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Neue Rechnung' });
    await dialog.locator('label', { hasText: 'Manuell erfassen' }).click();
    await dialog.getByLabel('Person').selectOption({ label: 'Anna' });
    await dialog.getByRole('button', { name: 'Weiter' }).click();
  });

  test('picks a date from the calendar and writes it in the date format', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Neue Rechnung' });
    await dialog.getByRole('button', { name: 'Kalender öffnen' }).click();
    const calendar = dialog.getByRole('dialog', { name: 'Datum auswählen' });
    await expect(calendar).toBeVisible();

    await calendar.getByLabel('Monat').selectOption({ label: 'März' });
    await calendar.getByLabel('Jahr').selectOption('2026');
    await calendar.getByRole('gridcell', { name: /12\. März 2026/ }).click();

    await expect(calendar).toBeHidden();
    await expect(dialog.getByLabel('Datum', { exact: true })).toHaveValue('12.03.2026');
    await expect(dialog.getByLabel('Datum', { exact: true })).toBeFocused();
  });

  test('opens on the typed date, selects it, and moves by keyboard', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Neue Rechnung' });
    const field = dialog.getByLabel('Datum', { exact: true });
    await field.fill('31.01.2026');
    await dialog.getByRole('button', { name: 'Kalender öffnen' }).click();
    const selected = dialog.getByRole('gridcell', { selected: true });
    await expect(selected).toHaveAccessibleName(/31\. Januar 2026/);
    await expect(selected).toBeFocused();

    await page.keyboard.press('PageDown'); // 31 Jan -> 28 Feb
    await expect(dialog.getByRole('gridcell', { name: /28\. Februar 2026/ })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('gridcell', { name: /1\. März 2026/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(field).toHaveValue('01.03.2026');
  });

  test('Escape closes only the calendar, an outside click closes it too', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Neue Rechnung' });
    await dialog.getByRole('button', { name: 'Kalender öffnen' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('dialog', { name: 'Datum auswählen' })).toBeHidden();
    await expect(dialog).toBeVisible(); // the claim dialog stays

    await dialog.getByRole('button', { name: 'Kalender öffnen' }).click();
    await dialog.getByLabel('Rechnungsnummer').click();
    await expect(dialog.getByRole('dialog', { name: 'Datum auswählen' })).toBeHidden();
  });

  test('"Heute" fills today and a typed date still works and is validated', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Neue Rechnung' });
    const field = dialog.getByLabel('Datum', { exact: true });
    await dialog.getByRole('button', { name: 'Kalender öffnen' }).click();
    await dialog.getByRole('button', { name: 'Heute' }).click();
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    await expect(field).toHaveValue(
      `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`,
    );

    await field.fill('31.02.2026');
    await field.blur();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.getByText('Bitte gib ein gültiges Datum ein.')).toBeVisible();
  });
});
