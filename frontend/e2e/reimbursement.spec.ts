import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockBackend, signedIn, type MockApi } from './support';

test.use({ locale: 'de-DE' });

const LETTER = {
  name: 'Leistungsabrechnung.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF'),
};

let api: MockApi;

/** Today in the local time zone of the browser, as the German date field shows it. */
function todayDe(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
}

const row = (page: Page) =>
  page.getByTestId('claim-list').getByRole('row', { name: /Praxis Dr\. Huber/ });

async function openClaim(page: Page): Promise<Locator> {
  await row(page).getByRole('button', { name: 'Details öffnen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rechnung bearbeiten' });
  await expect(dialog.getByLabel('Arzt oder Klinik')).toHaveValue('Praxis Dr. Huber');
  return dialog;
}

const puts = () => api.requests.filter((r) => r.startsWith('PUT /claims/'));

test.describe('claim dialog: reimbursement, payment and documents', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
    api = await mockBackend(page, [
      { provider: 'Praxis Dr. Huber', amount: 10000, invoiceDate: '2026-03-12' },
    ]);
  });

  test('one dialog, one save: submission, payment, partial and full reimbursement', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Liste' }).click();
    await expect(page).toHaveURL(/view=list/);

    // The row shows both status fields, separately: the reimbursement and the payment.
    const claimRow = row(page);
    await expect(claimRow.getByTestId('reimbursement-badge')).toHaveText('Offen');
    await expect(claimRow.getByTestId('payment-check')).not.toBeChecked();
    await expect(claimRow).toContainText('Nicht bezahlt');
    await expect(claimRow).toContainText('100,00 €');
    await expect(page.getByTestId('list-totals')).toHaveText(
      'Summe 100,00 €, erstattet 0,00 €, ausstehend 100,00 €',
    );

    // 1. Submission and payment in the same dialog, saved once.
    let dialog = await openClaim(page);
    await dialog.getByLabel('Bei der Versicherung eingereicht am').fill('14.03.2026');
    const toggle = dialog.getByRole('switch', { name: 'Rechnung bezahlt' });
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByLabel('Zahlungsdatum')).toHaveCount(0);
    await toggle.check();
    // Switching on fills today, date only, and the field stays editable and required.
    const paidAt = dialog.getByLabel('Zahlungsdatum');
    await expect(paidAt).toHaveValue(todayDe());
    await paidAt.fill('');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.getByText('Bitte fülle dieses Feld aus.')).toBeVisible();
    expect(puts()).toHaveLength(0);
    await paidAt.fill('20.03.2026');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);

    expect(puts()).toHaveLength(1);
    expect(api.claims[0]).toMatchObject({ submittedAt: '2026-03-14', paidAt: '2026-03-20' });
    expect(api.claims[0]!.entries).toHaveLength(0); // no reimbursement change, no history entry
    await expect(claimRow.getByTestId('payment-check')).toBeChecked();
    await expect(claimRow).toContainText('20.03.2026');
    await expect(claimRow.getByTestId('reimbursement-badge')).toHaveText('Offen');

    // The combination people look for: paid, but not reimbursed yet.
    await page.getByRole('button', { name: 'Bezahlt, aber noch nicht erstattet' }).click();
    await expect(page.getByRole('status')).toContainText('1 von 1 Rechnungen');
    await expect(page.getByTestId('list-totals')).toHaveText(
      'Summe 100,00 €, erstattet 0,00 €, ausstehend 100,00 €',
    );
    await expect(claimRow).toBeVisible();

    // 2. Partial reimbursement with the benefit statement, in the same dialog.
    dialog = await openClaim(page);
    // The saved payment date is shown as it is, opening never overwrites it.
    await expect(dialog.getByRole('switch', { name: 'Rechnung bezahlt' })).toBeChecked();
    await expect(dialog.getByLabel('Zahlungsdatum')).toHaveValue('20.03.2026');
    await expect(dialog.getByText(/Noch keine Änderungen/)).toBeVisible();
    await expect(dialog.getByLabel('Erstatteter Betrag')).toHaveCount(0);

    await dialog
      .getByLabel('Status', { exact: true })
      .selectOption({ label: 'Teilweise erstattet' });
    await expect(dialog.getByLabel('Datum des Status')).toHaveValue(todayDe());
    // More than the invoice is refused before anything is sent.
    await dialog.getByLabel('Erstatteter Betrag').fill('120');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(
      dialog.getByText(
        'Erstattet und abgelehnt dürfen zusammen nicht über dem Rechnungsbetrag liegen.',
      ),
    ).toBeVisible();
    expect(puts()).toHaveLength(1);

    await dialog.getByLabel('Datum des Status').fill('02.04.2026');
    await dialog.getByLabel('Erstatteter Betrag').fill('60,00');
    await dialog.getByLabel('Abgelehnt oder Selbstbehalt').fill('5');
    // For a partial reimbursement the difference to the invoice amount is shown.
    await expect(dialog.getByTestId('reimbursement-preview')).toHaveText(
      'Erstattet: 60,00 € von 100,00 €. Differenz: 40,00 €',
    );
    await dialog.getByLabel('Notiz zu dieser Änderung').fill('Erste Abrechnung');
    await dialog.getByTestId('document-input').setInputFiles(LETTER);
    await expect(dialog.getByText(LETTER.name)).toBeVisible();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);
    expect(puts()).toHaveLength(2);
    expect(api.uploadedFiles).toBe(1);
    expect(api.claims[0]!.entries).toHaveLength(1);
    expect(api.claims[0]!.documents).toHaveLength(1);

    // Paid and reimbursed in part: the combination stays possible, so the row is still listed.
    await expect(claimRow.getByTestId('reimbursement-badge')).toHaveText('Teilweise erstattet');
    await expect(claimRow.getByTestId('payment-check')).toBeChecked();
    await expect(claimRow).toContainText('20.03.2026');
    await expect(page.getByTestId('list-totals')).toHaveText(
      'Summe 100,00 €, erstattet 60,00 €, ausstehend 35,00 €',
    );

    // 3. Reopen: the dialog shows the current state, the history and the document.
    dialog = await openClaim(page);
    await expect(dialog.getByLabel('Status', { exact: true })).toHaveValue('PARTLY_PAID');
    await expect(dialog.getByLabel('Erstatteter Betrag')).toHaveValue('60,00');
    await expect(dialog.getByLabel('Abgelehnt oder Selbstbehalt')).toHaveValue('5,00');
    await expect(dialog.getByTestId('history')).toContainText('Erste Abrechnung');

    // The document opens in a new tab through a short-lived link.
    // (Headless Chromium downloads a PDF instead of showing it, so the request is what we check.)
    const popup = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: `${LETTER.name} öffnen` }).click();
    const tab = await popup;
    await expect.poll(() => api.openedDocuments).toEqual([api.claims[0]!.documents[0]!.documentId]);
    await tab.close();

    // The final reimbursement: switching to Reimbursed prefills what the invoice has left.
    await dialog.getByLabel('Status', { exact: true }).selectOption({ label: 'Erstattet' });
    await expect(dialog.getByLabel('Erstatteter Betrag')).toHaveValue('95,00');
    await dialog.getByLabel('Datum des Status').fill('20.04.2026');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);
    expect(puts()).toHaveLength(3);

    // The history keeps what each save changed, the amounts add up.
    expect(api.claims[0]!.entries.map((e) => [e.status, e.reimbursedAmount])).toEqual([
      ['PARTLY_PAID', 6000],
      ['PAID', 3500],
    ]);
    // Closing without changes still shows the list, now filtered: paid and fully reimbursed.
    await expect(page.getByText('Keine Rechnung passt zu den Filtern.')).toBeVisible();
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    await expect(claimRow.getByTestId('reimbursement-badge')).toHaveText('Erstattet');
    await expect(page.getByTestId('list-totals')).toHaveText(
      'Summe 100,00 €, erstattet 95,00 €, ausstehend 0,00 €',
    );

    // History in the dialog, newest first.
    dialog = await openClaim(page);
    await expect(dialog.getByTestId('history').getByTestId('reimbursement-badge')).toHaveText([
      'Erstattet',
      'Teilweise erstattet',
    ]);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);
    expect(puts()).toHaveLength(3); // opening and closing saves nothing

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

  test('the payment toggle fills today when switched on, clears the date when switched off', async ({
    page,
  }) => {
    api.claims[0]!.paidAt = '2026-03-20';
    await page.goto('/?view=list');
    const dialog = await openClaim(page);
    const toggle = dialog.getByRole('switch', { name: 'Rechnung bezahlt' });
    await expect(toggle).toBeChecked();
    await expect(dialog.getByLabel('Zahlungsdatum')).toHaveValue('20.03.2026');

    await toggle.uncheck();
    await expect(dialog.getByLabel('Zahlungsdatum')).toHaveCount(0);
    await toggle.check();
    await expect(dialog.getByLabel('Zahlungsdatum')).toHaveValue(todayDe());

    await toggle.uncheck();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.claims[0]!.paidAt).toBeNull();
    await expect(row(page).getByTestId('payment-check')).not.toBeChecked();
    await expect(row(page)).toContainText('Nicht bezahlt');
  });

  test('reimbursed without being paid by me: the two statuses are independent', async ({
    page,
  }) => {
    await page.goto('/?view=list');
    const dialog = await openClaim(page);
    await dialog.getByLabel('Status', { exact: true }).selectOption({ label: 'Erstattet' });
    await expect(dialog.getByLabel('Erstatteter Betrag')).toHaveValue('100,00');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);

    const claimRow = row(page);
    await expect(claimRow.getByTestId('reimbursement-badge')).toHaveText('Erstattet');
    await expect(claimRow.getByTestId('payment-check')).not.toBeChecked();
    // The filter for the reverse case finds it.
    await page.getByLabel('Selbst bezahlt').selectOption({ label: 'Nicht bezahlt' });
    await page.getByLabel('Erstattung', { exact: true }).selectOption({ label: 'Erstattet' });
    await expect(claimRow).toBeVisible();
  });

  test('documents are removed inside the dialog and deleted with the one save', async ({
    page,
  }) => {
    const documentId = '30000000-0000-4000-8000-000000000001';
    api.claims[0]!.documents = [
      {
        documentId,
        fileName: LETTER.name,
        contentType: 'application/pdf',
        size: 1000,
        uploadedAt: '2026-04-01T10:00:00.000Z',
      },
    ];
    await page.goto('/?view=list');

    // Removing and then cancelling changes nothing.
    let dialog = await openClaim(page);
    await dialog.getByRole('button', { name: `${LETTER.name} entfernen` }).click();
    await expect(dialog.getByTestId('stored-document')).toHaveCount(0);
    expect(api.claims[0]!.documents).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog.getByText('Deine Eingaben gehen verloren. Verwerfen?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.claims[0]!.documents).toHaveLength(1);

    // Removing and saving deletes it.
    dialog = await openClaim(page);
    await dialog.getByRole('button', { name: `${LETTER.name} entfernen` }).click();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.claims[0]!.documents).toHaveLength(0);
  });

  test('a claim that was changed elsewhere is not overwritten', async ({ page }) => {
    await page.goto('/?view=list');
    const dialog = await openClaim(page);
    api.claims[0]!.updatedAt = '2026-05-01T10:00:00.000Z'; // another tab saved in the meantime
    await dialog.getByLabel('Arzt oder Klinik').fill('Geändert');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(
      dialog.getByText(
        'Die Rechnung wurde inzwischen geändert. Bitte schließe sie und öffne sie erneut.',
      ),
    ).toBeVisible();
    expect(api.claims[0]!.provider).toBe('Praxis Dr. Huber');
  });

  test('Escape closes the dialog, and the table speaks English after a switch', async ({
    page,
  }) => {
    await page.goto('/?view=list');
    const dialog = await openClaim(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(row(page).getByTestId('reimbursement-badge')).toHaveText('Open');
    await expect(row(page)).toContainText('Not paid');
    await expect(page.getByRole('columnheader', { name: 'Doctor or hospital' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paid, but not reimbursed yet' })).toBeVisible();
  });
});
