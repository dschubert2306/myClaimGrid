import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockBackend, signedIn, type MockApi } from './support';

test.use({ locale: 'de-DE' });

const JONAS = '00000000-0000-4000-8000-000000000002';

let api: MockApi;

/** Today in the local time zone of the browser, as the German date field shows it. */
function todayDe(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
}

const table = (page: Page) => page.getByTestId('claim-list');
/**
 * A row by its person mark (Anna has the Huber claim, Jonas the Klinik Nord one). Not by provider:
 * while that cell is edited it holds an input, and an input's value is not text of the row.
 */
const row = (page: Page, person: 'Anna' | 'Jonas') =>
  table(page).getByRole('row').filter({ hasText: person });
const puts = () => api.requests.filter((r) => r.startsWith('PUT /claims/'));

/** The button that opens a cell for editing, found the way a screen reader announces it. */
const cell = (row: Locator, column: string) =>
  row.getByRole('button', { name: new RegExp(`^${column} von .* ändern`) });

test.describe('list view: table with inline editing', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
    api = await mockBackend(page, [
      {
        provider: 'Praxis Dr. Huber',
        invoiceNumber: 'RE-1',
        amount: 10000,
        invoiceDate: '2026-03-12',
        hasPdf: true,
      },
      {
        personId: JONAS,
        provider: 'Klinik Nord',
        invoiceNumber: '',
        amount: 25050,
        invoiceDate: '2026-02-01',
        hasPdf: false,
      },
    ]);
    await page.goto('/?view=list');
    await expect(table(page)).toBeVisible();
  });

  test('is a table with the six columns, an icon for an attached invoice and a person mark', async ({
    page,
  }) => {
    for (const name of [
      'Arzt oder Klinik',
      'Rechnungsnummer',
      'Datum',
      'Betrag',
      'Status',
      'Zahlung',
    ]) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
    }
    await expect(table(page).getByRole('row')).toHaveCount(3); // header and two claims

    const huber = row(page, 'Anna');
    await expect(huber).toContainText('RE-1');
    await expect(huber).toContainText('12.03.2026');
    await expect(huber).toContainText('100,00 €');
    await expect(huber).toContainText('Anna');
    await expect(huber.getByTestId('reimbursement-badge')).toHaveText('Offen');
    await expect(huber.getByTestId('payment-check')).not.toBeChecked();
    await expect(huber.getByTestId('invoice-icon')).toBeVisible();
    await expect(huber.getByRole('img', { name: 'Rechnung als PDF angehängt' })).toBeVisible();

    const klinik = row(page, 'Jonas');
    await expect(klinik).toContainText('Jonas');
    await expect(klinik).toContainText('250,50 €');
    await expect(klinik.getByTestId('invoice-icon')).toHaveCount(0);
    // An empty invoice number is still a cell you can click.
    await expect(cell(klinik, 'Rechnungsnummer')).toHaveText('–');
  });

  test('Enter saves a text cell, the whole claim with that one change', async ({ page }) => {
    const huber = row(page, 'Anna');
    await cell(huber, 'Arzt oder Klinik').click();
    const input = huber.getByRole('textbox', { name: /Arzt oder Klinik/ });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Praxis Dr. Huber');
    await input.fill('Praxis Huber und Partner');
    await input.press('Enter');

    const renamed = row(page, 'Anna');
    await expect(cell(renamed, 'Arzt oder Klinik')).toBeFocused();
    // The Enter that saved must not open the cell again (it would click the focused button).
    await expect(renamed.getByRole('textbox')).toHaveCount(0);
    expect(puts()).toHaveLength(1);
    expect(api.claims[0]).toMatchObject({
      provider: 'Praxis Huber und Partner',
      invoiceNumber: 'RE-1',
      invoiceDate: '2026-03-12',
      amount: 10000,
    });
    expect(api.claims[0]!.entries).toHaveLength(0);
  });

  test('leaving the field saves, Escape and an unchanged value do not', async ({ page }) => {
    const huber = row(page, 'Anna');

    // Escape discards.
    await cell(huber, 'Rechnungsnummer').click();
    await huber.getByRole('textbox').fill('RE-99');
    await page.keyboard.press('Escape');
    await expect(cell(huber, 'Rechnungsnummer')).toHaveText('RE-1');
    expect(puts()).toHaveLength(0);

    // Unchanged: no request.
    await cell(huber, 'Rechnungsnummer').click();
    await expect(huber.getByRole('textbox')).toBeFocused(); // selected, ready to type
    await page.keyboard.press('Enter');
    await expect(cell(huber, 'Rechnungsnummer')).toBeVisible();
    expect(puts()).toHaveLength(0);

    // Clicking elsewhere saves.
    await cell(huber, 'Rechnungsnummer').click();
    await huber.getByRole('textbox').fill('RE-2');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(cell(huber, 'Rechnungsnummer')).toHaveText('RE-2');
    expect(puts()).toHaveLength(1);
    expect(api.claims[0]!.invoiceNumber).toBe('RE-2');
  });

  test('date and amount are typed in the format of the language', async ({ page }) => {
    const huber = row(page, 'Anna');
    await cell(huber, 'Betrag').click();
    await huber.getByRole('textbox').fill('1.234,5');
    await page.keyboard.press('Enter');
    await expect(cell(huber, 'Betrag')).toHaveText('1.234,50 €');
    expect(api.claims[0]!.amount).toBe(123450);

    await cell(huber, 'Datum').click();
    await expect(huber.getByRole('textbox')).toHaveValue('12.03.2026');
    await expect(huber.getByRole('textbox')).toHaveAttribute('placeholder', 'TT.MM.JJJJ');
    await huber.getByRole('textbox').fill('15.03.2026');
    await page.keyboard.press('Enter');
    await expect(cell(huber, 'Datum')).toHaveText('15.03.2026');
    expect(api.claims[0]!.invoiceDate).toBe('2026-03-15');

    // The totals above the table follow the edit.
    await expect(page.getByTestId('list-totals')).toContainText('1.485,00 €');
  });

  test('a value the dialog would refuse is not sent, the error stays at the cell', async ({
    page,
  }) => {
    const huber = row(page, 'Anna');
    await cell(huber, 'Arzt oder Klinik').click();
    const input = huber.getByRole('textbox');
    await input.fill('');
    await input.press('Enter');
    await expect(huber.getByRole('alert')).toHaveText('Bitte fülle dieses Feld aus.');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(puts()).toHaveLength(0);

    // Escape gives the saved value back.
    await input.press('Escape');
    await expect(cell(huber, 'Arzt oder Klinik')).toHaveText('Praxis Dr. Huber');

    // Leaving the field with an invalid date cannot keep it open: it says so above the table.
    await cell(huber, 'Datum').click();
    await huber.getByRole('textbox').fill('31.02.2026');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(page.getByRole('alert')).toHaveText('Bitte gib ein gültiges Datum ein.');
    await expect(cell(huber, 'Datum')).toHaveText('12.03.2026');
    expect(puts()).toHaveLength(0);
  });

  test('the status is chosen from a list and saves at once, a partial payment stays in the dialog', async ({
    page,
  }) => {
    const huber = row(page, 'Anna');
    await cell(huber, 'Status').click();
    const select = huber.getByRole('combobox', { name: /Status/ });
    await expect(select).toBeFocused();
    await expect(select.getByRole('option', { name: 'Teilweise erstattet' })).toBeDisabled();
    await select.selectOption({ label: 'Erstattet' });

    await expect(huber.getByTestId('reimbursement-badge')).toHaveText('Erstattet');
    expect(puts()).toHaveLength(1);
    // Same as in the dialog: dated today, and what the invoice has left is reimbursed.
    expect(
      api.claims[0]!.entries.map((e) => [e.status, e.reimbursedAmount, e.date.length]),
    ).toEqual([['PAID', 10000, 10]]);
    await expect(page.getByTestId('list-totals')).toContainText('erstattet 100,00 €');
    await expect(cell(huber, 'Status')).toBeFocused();

    // Without a payment the status is just a status.
    await cell(huber, 'Status').click();
    await huber.getByRole('combobox').selectOption({ label: 'In Bearbeitung' });
    await expect(huber.getByTestId('reimbursement-badge')).toHaveText('In Bearbeitung');
    expect(api.claims[0]!.entries.map((e) => e.status)).toEqual(['PAID', 'IN_PROGRESS']);
  });

  test('the payment is a checkbox, switching on fills today and the date can be edited', async ({
    page,
  }) => {
    const huber = row(page, 'Anna');
    const check = huber.getByRole('checkbox', { name: /Rechnung bezahlt/ });
    await check.check();
    await expect(huber).toContainText(todayDe());
    await expect(check).toBeChecked();
    expect(puts()).toHaveLength(1);
    expect(api.claims[0]!.paidAt).not.toBeNull();
    // The keyboard focus stays on the box.
    await expect(check).toBeFocused();

    await cell(huber, 'Zahlungsdatum').click();
    await huber.getByRole('textbox').fill('20.03.2026');
    await page.keyboard.press('Enter');
    await expect(huber).toContainText('20.03.2026');
    expect(api.claims[0]!.paidAt).toBe('2026-03-20');

    await check.uncheck();
    await expect(huber).toContainText('Nicht bezahlt');
    expect(api.claims[0]!.paidAt).toBeNull();
    expect(api.claims[0]!.entries).toHaveLength(0); // payment is independent of the reimbursement
  });

  test('a claim that was changed elsewhere is not overwritten, and the list shows the new state', async ({
    page,
  }) => {
    const huber = row(page, 'Anna');
    api.claims[0]!.updatedAt = '2026-05-01T10:00:00.000Z'; // another tab saved in the meantime
    api.claims[0]!.invoiceNumber = 'RE-ANDERS';
    await cell(huber, 'Arzt oder Klinik').click();
    await huber.getByRole('textbox').fill('Geändert');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('inzwischen geändert');
    expect(api.claims[0]!.provider).toBe('Praxis Dr. Huber');
    await expect(cell(huber, 'Rechnungsnummer')).toHaveText('RE-ANDERS');

    // Retrying works on the fresh version.
    await cell(huber, 'Arzt oder Klinik').click();
    await huber.getByRole('textbox').fill('Geändert');
    await page.keyboard.press('Enter');
    await expect(cell(row(page, 'Anna'), 'Arzt oder Klinik')).toBeVisible();
    expect(api.claims[0]!.provider).toBe('Geändert');
  });

  test('the last column opens the dialog, and the table speaks English after a switch', async ({
    page,
  }) => {
    await row(page, 'Jonas').getByRole('button', { name: 'Details öffnen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rechnung bearbeiten' });
    await expect(dialog.getByLabel('Arzt oder Klinik')).toHaveValue('Klinik Nord');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'EN', exact: true }).click();
    for (const name of [
      'Doctor or hospital',
      'Invoice number',
      'Date',
      'Amount',
      'Status',
      'Payment',
    ]) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
    }
    await expect(row(page, 'Jonas')).toContainText('Not paid');
    await expect(
      row(page, 'Jonas').getByRole('button', { name: /^Edit Amount of Klinik Nord/ }),
    ).toBeVisible();
  });
});
