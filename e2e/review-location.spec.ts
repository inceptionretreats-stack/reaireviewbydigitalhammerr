import { expect, test, type Page } from '@playwright/test';
import {
  closeDb,
  demoReviewDestinationSnapshot,
  restoreDemoReviewDestination,
  setDemoReviewDestinationEnabled,
} from './support/db';

const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? 'demo-owner@example.com',
  password: process.env.E2E_OWNER_PASSWORD ?? 'demo-owner-Password1!',
};

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(OWNER.email);
  await page.getByLabel(/^password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
}

test.afterAll(async () => {
  await closeDb();
});

test('an owner changes the Google review location without replacing any QR code', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const original = await demoReviewDestinationSnapshot();

  try {
    await signIn(page);

    const beforeQrResponse = await page.request.get('/api/v1/qr');
    expect(beforeQrResponse.status()).toBe(200);
    const beforeQr = (await beforeQrResponse.json()) as {
      sources: Array<{ id: string; code: string; resolve_url: string }>;
    };

    await page.goto('/app/profile#review-location');
    const card = page.locator('#review-location');
    await expect(card.getByRole('heading', { name: 'Google review location' })).toBeVisible();
    await expect(card.getByText(/printed QR stays the same/i)).toBeVisible();

    const input = card.getByLabel('Google review or Maps link');
    await expect(input).toHaveValue(original.url);

    // A raw or legacy value never becomes an Open href. The seeded URL is intentionally outside
    // Google's hosts so automated tests can never send traffic to a real business.
    await expect(card.getByRole('link', { name: /open saved location/i })).toHaveCount(0);

    await input.fill('https://facebook.com/not-a-google-location');
    await card.getByRole('button', { name: 'Save location' }).click();
    await expect(card.getByRole('alert')).toContainText(/not a Google link/i);

    const rejectedDestination = await page.request.get('/api/v1/business/review-destination');
    expect(rejectedDestination.status()).toBe(200);
    await expect(rejectedDestination).toBeOK();
    expect(((await rejectedDestination.json()) as { url: string }).url).toBe(original.url);

    const movedKey = `E2EMovedShop${Date.now().toString(36)}`;
    const pasted = `https://g.page/r/${movedKey}/review?utm_source=e2e#location`;
    const normalized = `https://g.page/r/${movedKey}/review`;

    await input.fill(pasted);
    await card.getByRole('button', { name: 'Save location' }).click();

    await expect(card.getByRole('status')).toContainText(
      'Saved. Every existing QR now uses this location.',
    );
    await expect(input).toHaveValue(normalized);
    await expect(card.getByText('Direct review link')).toBeVisible();
    await expect(card.getByRole('link', { name: /open saved location/i })).toHaveAttribute(
      'href',
      normalized,
    );

    const savedDestination = await page.request.get('/api/v1/business/review-destination');
    expect(savedDestination.status()).toBe(200);
    expect(((await savedDestination.json()) as { url: string }).url).toBe(normalized);

    // An older admin/import path may have disabled the row. The profile card deliberately enables
    // Save even when the text is unchanged, and the same PUT repairs that state.
    await setDemoReviewDestinationEnabled(false);
    // The URL already has this hash, so `goto` would be a same-document navigation and preserve the
    // mounted client state. Reload to exercise the server read of the disabled database row.
    await page.reload();
    const disconnectedCard = page.locator('#review-location');
    await expect(disconnectedCard.getByText('Disconnected').first()).toBeVisible();
    await expect(disconnectedCard.getByLabel('Google review or Maps link')).toHaveValue(normalized);
    await expect(disconnectedCard.getByRole('button', { name: 'Save location' })).toBeEnabled();
    await disconnectedCard.getByRole('button', { name: 'Save location' }).click();
    await expect(disconnectedCard.getByRole('status')).toContainText(
      'Saved. Every existing QR now uses this location.',
    );
    expect((await demoReviewDestinationSnapshot()).isEnabled).toBe(true);

    // The public Review Us action changes immediately.
    await page.goto('/demo-south-cafe');
    await expect(page.getByRole('link', { name: 'Review us on Google' })).toHaveAttribute(
      'href',
      normalized,
    );

    // The QR remains an opaque platform URL, while its server-rendered journey receives the new
    // destination. A shop move must never force a standee reprint.
    const afterQrResponse = await page.request.get('/api/v1/qr');
    expect(afterQrResponse.status()).toBe(200);
    const afterQr = (await afterQrResponse.json()) as typeof beforeQr;
    expect(afterQr.sources).toEqual(beforeQr.sources);

    const firstQr = afterQr.sources[0];
    expect(firstQr).toBeDefined();
    const scan = await page.request.get(`/r/${firstQr!.code}`);
    expect(scan.status()).toBe(200);
    expect(await scan.text()).toContain(movedKey);

    // The same editor remains usable at the phone width from the dashboard acceptance suite.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/profile#review-location');
    await expect(page.locator('#review-location')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await restoreDemoReviewDestination(original);
  }
});
