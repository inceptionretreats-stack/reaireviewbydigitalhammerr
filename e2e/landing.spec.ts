import { expect, test } from '@playwright/test';

/**
 * `/` — the front door a business owner arrives at.
 *
 * It earns an E2E file for two reasons. It is the one page that has to *explain* the product
 * rather than perform it, so "does a stranger learn what this is" is a real assertion. And it is
 * public HTML, which means the compliance sweep applies here exactly as it does to the review
 * page: a marketing page is the easiest place for a star rating to reappear as decoration.
 */

test.describe('landing page', () => {
  test('tells a first-time visitor what the product does', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/review/i);

    // The three things a stranger needs: the customer's path, the limits, and the price.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).toContain('scan');
    expect(body).toContain('google');
    expect(body).toContain('₹999');
  });

  test('offers both ways in', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: /create your account/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^sign in$/i }).first()).toBeVisible();
  });

  /**
   * AC-006 / D-009 again, on the marketing surface. The review page is swept in
   * customer-review-flow.spec.ts; this covers the page most likely to grow a decorative row of
   * stars the first time someone is asked to make it look friendlier.
   */
  test('never shows a rating control, not even decoratively', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('[type="radio"]')).toHaveCount(0);
    await expect(page.getByRole('radiogroup')).toHaveCount(0);

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/★|⭐|\b[1-5] stars?\b/i);
  });

  /**
   * The QR on the page is the product's central claim made visible, so it has to be a real code
   * that resolves rather than an illustration. A mock one would send the first person who scanned
   * the screen to a 404.
   */
  test('shows a QR whose code actually resolves to the review page', async ({ page }) => {
    await page.goto('/');

    const qr = page.getByRole('img', { name: /qr code/i });
    await expect(qr).toBeVisible();

    // Rendered server-side as a data URI, so it is in the HTML rather than fetched.
    await expect(qr).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);

    // Whichever code the page is showing, following it has to arrive somewhere real. Asserting one
    // *particular* code would only restate the page's own ordering — and the seed writes two codes
    // in a single transaction sharing a created_at, so a query without a tiebreak picks either.
    const link = page.getByRole('link', { name: /open it here/i });
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/r\/[A-Z0-9]{10}$/);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
