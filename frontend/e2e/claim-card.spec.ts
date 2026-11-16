import { expect, test } from '@playwright/test';
import { mockBackend, signedIn } from './support';

test.use({ locale: 'de-DE' });

test.describe('overview: compact claim cards', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
    await mockBackend(page, [
      {
        provider: 'Praxis Dr. Huber',
        invoiceNumber: 'RE-1',
        amount: 18000,
        invoiceDate: '2026-03-12',
        documents: [
          {
            documentId: '20000000-0000-4000-8000-000000000001',
            fileName: 'Abrechnung.pdf',
            contentType: 'application/pdf',
            size: 1200,
            uploadedAt: '2026-03-14T10:00:00.000Z',
          },
        ],
      },
      { provider: 'Physio Meier', invoiceNumber: 'RE-2', amount: 5000, invoiceDate: '2026-03-13' },
    ]);
  });

  test('a card shows provider, both statuses and the amount, nothing else', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('article.app-claim-card', { hasText: 'Praxis Dr. Huber' });

    await expect(card.getByRole('heading', { name: 'Praxis Dr. Huber' })).toBeVisible();
    await expect(card).toContainText('RE-1');
    await expect(card.getByTestId('reimbursement-badge')).toHaveText('Offen');
    await expect(card.getByTestId('payment-badge')).toHaveText('Nicht bezahlt');
    await expect(card.getByTestId('card-amount')).toHaveText('180,00 €');

    for (const gone of ['Erstattet', 'Ausstehend', 'Eingereicht', 'Differenz']) {
      await expect(card).not.toContainText(gone);
    }
  });

  test('the file icon only appears when insurer documents are attached', async ({ page }) => {
    await page.goto('/');
    const withDocs = page.locator('article.app-claim-card', { hasText: 'Praxis Dr. Huber' });
    const without = page.locator('article.app-claim-card', { hasText: 'Physio Meier' });

    await expect(withDocs.getByTestId('card-documents')).toHaveAccessibleName('Dokumente: 1');
    await expect(without.getByTestId('card-documents')).toHaveCount(0);
  });
});
