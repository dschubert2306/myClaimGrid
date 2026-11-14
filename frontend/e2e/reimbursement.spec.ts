import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockBackend, signedIn, type MockApi } from './support';

test.use({ locale: 'de-DE' });

const LETTER = {
  name: 'Leistungsabrechnung.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF'),
};

let api: MockApi;

const listRow = (page: Page) =>
  page.getByTestId('claim-list').getByRole('row', { name: /Praxis Dr\. Huber/ });

async function openClaim(page: Page): Promise<Locator> {
  await listRow(page).click();
  const dialog = page.getByRole('dialog', { name: 'Rechnung bearbeiten' });
  await expect(dialog.getByLabel('Arzt oder Klinik')).toHaveValue('Praxis Dr. Huber');
  return dialog;
}

test.describe('reimbursement tracking', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
    api = await mockBackend(page, [
      { provider: 'Praxis Dr. Huber', amount: 10000, invoiceDate: '2026-03-12' },
    ]);
  });

  test('submission, partial reimbursement with a document, full reimbursement', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Liste' }).click();
    await expect(page).toHaveURL(/view=list/);

    // Before: open, not submitted, not paid, everything outstanding. Two separate indicators.
    const row = listRow(page);
    await expect(row.getByTestId('reimbursement-badge')).toHaveText('Offen');
    await expect(row).toContainText('nicht eingereicht');
    await expect(row.getByTestId('payment-badge')).toHaveText('Nicht bezahlt');
    await expect(row.getByRole('cell').nth(7)).toHaveText('0,00 €');
    await expect(row.getByRole('cell').nth(8)).toHaveText('100,00 €');

    // 1. Submit to the insurer and pay the invoice: two dates, saved with the claim.
    let dialog = await openClaim(page);
    await dialog.getByLabel('Eingereicht am').fill('14.03.2026');
    await dialog.getByLabel('Rechnung bezahlt am').fill('20.03.2026');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.claims[0]).toMatchObject({ submittedAt: '2026-03-14', paidAt: '2026-03-20' });
    await expect(row).not.toContainText('nicht eingereicht');
    await expect(row.getByTestId('payment-badge')).toHaveText('Bezahlt');

    // The combination people look for: paid, but not reimbursed yet.
    await page.getByRole('button', { name: 'Bezahlt, aber noch nicht erstattet' }).click();
    await expect(page.getByText('1 von 1 Rechnungen')).toBeVisible();
    await expect(row).toBeVisible();

    // 2. Partial reimbursement with the benefit statement.
    dialog = await openClaim(page);
    const section = dialog.getByRole('region', { name: 'Erstattung' });
    await expect(section.getByText(/Noch keine Einträge/)).toBeVisible();
    await section.getByRole('button', { name: 'Eintrag hinzufügen' }).click();

    let entry = page.getByRole('dialog', { name: 'Eintrag hinzufügen' });
    await expect(entry.getByLabel('Status')).toBeFocused();
    await entry.getByLabel('Status').selectOption({ label: 'Teilweise erstattet' });
    await entry.getByLabel('Datum des Eintrags').fill('02.04.2026');
    // More than the invoice is refused before anything is sent.
    await entry.getByLabel('Erstatteter Betrag').fill('120');
    await entry.getByRole('button', { name: 'Eintrag speichern' }).click();
    await expect(
      entry.getByText(
        'Erstattet und abgelehnt dürfen zusammen nicht über dem Rechnungsbetrag liegen.',
      ),
    ).toBeVisible();
    expect(api.requests.filter((r) => r.includes('/entries'))).toHaveLength(0);

    await entry.getByLabel('Erstatteter Betrag').fill('60,00');
    await entry.getByLabel('Abgelehnt oder Selbstbehalt').fill('5');
    await expect(entry.getByTestId('entry-preview')).toHaveText(
      'Danach erstattet: 60,00 € von 100,00 €. Differenz: 40,00 €',
    );
    await entry.getByLabel('Notiz').fill('Erste Abrechnung');
    await entry.getByTestId('document-input').setInputFiles(LETTER);
    await expect(entry.getByText(LETTER.name)).toBeVisible();
    await entry.getByRole('button', { name: 'Eintrag speichern' }).click();
    await expect(entry).toHaveCount(0);
    expect(api.uploadedFiles).toBe(1);

    await expect(section.getByTestId('reimbursement-badge').first()).toHaveText(
      'Teilweise erstattet',
    );
    await expect(section.getByTestId('detail-reimbursed')).toHaveText('60,00 €');
    await expect(section.getByTestId('detail-difference')).toHaveText('40,00 €');
    await expect(section.getByTestId('detail-outstanding')).toHaveText('35,00 €');
    await expect(section.getByText('Erste Abrechnung')).toBeVisible();

    // The document opens in a new tab through a short-lived link.
    // (Headless Chromium downloads a PDF instead of showing it, so the request is what we check.)
    const popup = page.waitForEvent('popup');
    await section.getByRole('button', { name: `${LETTER.name} öffnen` }).click();
    const tab = await popup;
    await expect
      .poll(() => api.openedDocuments)
      .toEqual([api.claims[0]!.entries[0]!.documents[0]!.documentId]);
    await tab.close();

    // 3. Final reimbursement: the rest is prefilled.
    await section.getByRole('button', { name: 'Eintrag hinzufügen' }).click();
    entry = page.getByRole('dialog', { name: 'Eintrag hinzufügen' });
    await entry.getByLabel('Status').selectOption({ label: 'Erstattet' });
    await expect(entry.getByLabel('Erstatteter Betrag')).toHaveValue('35,00');
    await entry.getByLabel('Datum des Eintrags').fill('20.04.2026');
    await entry.getByRole('button', { name: 'Eintrag speichern' }).click();
    await expect(entry).toHaveCount(0);

    await expect(section.getByTestId('detail-reimbursed')).toHaveText('95,00 €');
    await expect(section.getByTestId('detail-outstanding')).toHaveText('0,00 €');
    await expect(section.getByTestId('detail-self-borne')).toHaveText('5,00 €');
    // Newest first.
    await expect(section.getByTestId('history').getByTestId('reimbursement-badge')).toHaveText([
      'Erstattet',
      'Teilweise erstattet',
    ]);

    // Closing without form changes still refreshes the list, the filters stay.
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Keine Rechnung passt zu den Filtern.')).toBeVisible();
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    await expect(row.getByTestId('reimbursement-badge')).toHaveText('Erstattet');
    await expect(row.getByTestId('payment-badge')).toHaveText('Bezahlt');
    await expect(row.getByRole('cell').nth(7)).toHaveText('95,00 €');
    await expect(row.getByRole('cell').nth(8)).toHaveText('0,00 €');

    // The overview per person and year.
    await page.getByRole('button', { name: 'Übersicht' }).click();
    const anna = page.locator('section.mcg-person', { hasText: 'Anna' });
    await expect(anna.getByTestId('figure-outstanding')).toHaveText('0,00 €');
    await expect(anna.getByTestId('figure-reimbursed')).toHaveText('95,00 €');
    await expect(anna.getByTestId('figure-self-borne')).toHaveText('5,00 €');
    await expect(
      page.locator('section.mcg-person', { hasText: 'Jonas' }).getByTestId('figure-reimbursed'),
    ).toHaveText('0,00 €');
  });

  test('a document and an entry can be deleted after confirming', async ({ page }) => {
    await page.goto('/?view=list');
    const dialog = await openClaim(page);
    const section = dialog.getByRole('region', { name: 'Erstattung' });
    await section.getByRole('button', { name: 'Eintrag hinzufügen' }).click();
    const entry = page.getByRole('dialog', { name: 'Eintrag hinzufügen' });
    await entry.getByLabel('Status').selectOption({ label: 'In Bearbeitung' });
    await expect(entry.getByLabel('Erstatteter Betrag')).toHaveCount(0);
    await entry.getByTestId('document-input').setInputFiles(LETTER);
    await entry.getByRole('button', { name: 'Eintrag speichern' }).click();
    await expect(entry).toHaveCount(0);

    await section.getByRole('button', { name: `${LETTER.name} löschen` }).click();
    await expect(section.getByText(/wird gelöscht/)).toBeVisible();
    await section.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(section.getByRole('button', { name: `${LETTER.name} öffnen` })).toHaveCount(0);
    expect(api.claims[0]!.entries[0]!.documents).toHaveLength(0);

    await section.getByRole('button', { name: 'Eintrag löschen' }).click();
    await section.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(section.getByText(/Noch keine Einträge/)).toBeVisible();
    expect(api.claims[0]!.entries).toHaveLength(0);
  });

  test('Escape closes only the entry dialog, and the list speaks English after a switch', async ({
    page,
  }) => {
    await page.goto('/?view=list');
    const dialog = await openClaim(page);
    await dialog.getByRole('button', { name: 'Eintrag hinzufügen' }).click();
    await expect(page.getByRole('dialog', { name: 'Eintrag hinzufügen' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Eintrag hinzufügen' })).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(listRow(page).getByTestId('reimbursement-badge')).toHaveText('Open');
    await expect(listRow(page).getByTestId('payment-badge')).toHaveText('Not paid');
    await expect(page.getByRole('button', { name: 'Paid, but not reimbursed yet' })).toBeVisible();
  });
});
