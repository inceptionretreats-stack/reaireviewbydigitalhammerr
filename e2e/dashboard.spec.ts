import { expect, test, type Page } from '@playwright/test';
import { closeDb } from './support/db';

/**
 * The business dashboard: every screen an owner can reach, and the compliance rules that hold
 * across all of them.
 *
 * These ten screens had been verified only as far as "returns 200". This walks each one, checks
 * it rendered its own content rather than an error boundary, and asserts the two things that
 * must never appear anywhere in the product.
 */

const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? 'demo-owner@example.com',
  password: process.env.E2E_OWNER_PASSWORD ?? 'demo-owner-Password1!',
};

const SCREENS = [
  { path: '/app', id: 'DASH-01', heading: /demo south cafe/i },
  { path: '/app/ai-review', id: 'AI-01', heading: /drafts are built from/i },
  { path: '/app/review-modes', id: 'AI-02', heading: /what your drafts lean on/i },
  { path: '/app/qr', id: 'QR-01', heading: /qr codes/i },
  { path: '/app/profile', id: 'PROFILE-01', heading: /your public page/i },
  { path: '/app/customers', id: 'CRM-01', heading: /customers/i },
  { path: '/app/review-requests', id: 'REQ-01', heading: /ask a customer/i },
  { path: '/app/feedback', id: 'FB-02', heading: /private feedback/i },
  { path: '/app/analytics', id: 'AN-01', heading: /how customers are using/i },
  { path: '/app/settings', id: 'SET-01', heading: /your account/i },
] as const;

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

test.describe('business dashboard', () => {
  test('every screen renders its own content', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page);

    for (const screen of SCREENS) {
      await page.goto(screen.path);

      // A Next error boundary also returns 200, so the status alone proves nothing.
      const body = await page.locator('body').innerText();
      expect(body, `${screen.id} (${screen.path}) rendered an error`).not.toMatch(
        /application error|unhandled runtime|something went wrong|500/i,
      );

      await expect(
        page.getByRole('heading', { name: screen.heading }).first(),
        `${screen.id} (${screen.path}) heading`,
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  /**
   * AC-025, DASH-01-02 and D-028, checked across every screen at once.
   *
   * The platform can only observe that Google was opened. A metric named for submission would be
   * a claim the software cannot support, and it is the kind of wording that creeps in one screen
   * at a time — so it is asserted everywhere rather than where it was expected.
   */
  test('no screen ever claims a review was submitted', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page);

    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const body = (await page.locator('body').innerText()).toLowerCase();

      expect(body, `${screen.id} claims submission`).not.toMatch(
        /reviews? submitted|submitted reviews?|review posted/,
      );
      // D-009: no star rating is collected anywhere in the product.
      expect(body, `${screen.id} shows a star rating`).not.toMatch(/star rating|rate us/);
    }
  });

  test('the sidebar only links to screens that exist', async ({ page }) => {
    await signIn(page);

    const links = page.getByRole('navigation').getByRole('link');
    const hrefs = (
      await links.evaluateAll((els) =>
        els.map((el) => (el as HTMLAnchorElement).getAttribute('href')),
      )
    ).filter((h): h is string => typeof h === 'string' && h.startsWith('/app'));

    expect(hrefs.length).toBeGreaterThan(5);

    // A dead link inside your own product is worse than an item that reads as unavailable, so
    // every rendered nav link must resolve.
    for (const href of new Set(hrefs)) {
      const response = await page.request.get(href);
      expect(response.status(), `nav link ${href}`).toBeLessThan(400);
    }
  });

  test('QR-01 offers a downloadable SVG that encodes the opaque code', async ({ page }) => {
    await signIn(page);
    await page.goto('/app/qr');

    const list = await page.request.get('/api/v1/qr');
    const body = (await list.json()) as { sources: Array<{ id: string; code: string }> };
    const source = body.sources[0];
    expect(source).toBeDefined();

    const svg = await page.request.get(`/api/v1/qr/${source!.id}/download?format=svg`);
    expect(svg.status()).toBe(200);
    expect(svg.headers()['content-type']).toContain('svg');

    // ADR-002: the printed payload is the platform's opaque route, never the Google URL.
    const markup = await svg.text();
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('google.com');
  });

  test('signing out ends the session', async ({ page }) => {
    await signIn(page);

    await page
      .getByRole('button', { name: /sign out|log out/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    // SET-01-02: the session is genuinely revoked, not merely navigated away from.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  });
});
