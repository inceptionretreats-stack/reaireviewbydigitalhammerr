import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import sharp from 'sharp';
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
  { path: '/app', id: 'DASH-01', heading: /digital hammerr/i },
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
      await expect(page.locator('.app-shell')).toBeVisible();
      await expect(page.locator('.app-main')).toBeVisible();
      await expect(
        page
          .getByRole('navigation', { name: 'Dashboard sections' })
          .locator('a[aria-current="page"]'),
      ).toHaveCount(1);
    }
  });

  test('the signed-in shell stays usable on desktop and phone widths', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);

      for (const path of ['/app', '/app/qr', '/app/settings']) {
        await page.goto(path);
        await expect(page.locator('.app-sidebar')).toBeVisible();
        await expect(page.locator('.app-topbar')).toBeVisible();
        await expect(page.locator('.app-main')).toBeVisible();

        const geometry = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          mainTop: document.querySelector<HTMLElement>('.app-main')?.getBoundingClientRect().top,
          navHeight: document.querySelector<HTMLElement>('.dashboard-nav')?.getBoundingClientRect()
            .height,
        }));

        expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
        expect(geometry.mainTop).toBeDefined();
        expect(geometry.navHeight).toBeDefined();
        if (viewport.width === 390) {
          expect(geometry.mainTop!).toBeLessThan(260);
          expect(geometry.navHeight!).toBeLessThan(70);

          if (path === '/app') {
            const menu = page.getByRole('button', { name: 'Menu' });
            await expect(menu).toHaveAttribute('aria-expanded', 'false');
            await menu.click();
            await expect(menu).toHaveAttribute('aria-expanded', 'true');
            await expect(page.getByRole('link', { name: 'QR Codes' })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(menu).toHaveAttribute('aria-expanded', 'false');
            await expect(menu).toBeFocused();
          }
        }
      }
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

  test('QR-01 offers minimal print SVG and PNG downloads for the opaque code', async ({ page }) => {
    await signIn(page);
    await page.goto('/app/qr');

    const brandedPreview = page.locator('figure[aria-label^="QR card"]').first();
    await expect(brandedPreview.locator('[data-qr-card-part="name"]')).toHaveText(
      'Digital Hammerr',
    );
    await expect(brandedPreview.locator('[data-qr-card-part="credit"]')).toContainText(
      'Digital Hammerr',
    );
    await expect(brandedPreview.getByRole('img', { name: /qr code/i })).toBeVisible();
    await expect(brandedPreview.locator('[data-qr-card-part]')).toHaveCount(3);
    expect(
      await brandedPreview.evaluate((element) =>
        (element as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      ),
    ).toBe('Digital Hammerr Ai Review by Digital Hammerr');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    const list = await page.request.get('/api/v1/qr');
    const body = (await list.json()) as {
      sources: Array<{ id: string; code: string; resolve_url: string }>;
    };
    const source = body.sources[0];
    expect(source).toBeDefined();

    const svg = await page.request.get(`/api/v1/qr/${source!.id}/download?format=svg`);
    expect(svg.status()).toBe(200);
    expect(svg.headers()['content-type']).toContain('svg');

    // ADR-002: the printed payload is the platform's opaque route, never the Google URL.
    const markup = await svg.text();
    expect(markup).toContain('<svg');
    expect(markup).toContain('viewBox="0 0 900 1350"');
    expect(markup).toContain('Digital Hammerr');
    expect(markup).not.toContain('Demo South Cafe');
    expect(markup).toContain('Ai Review by Digital Hammerr');
    // Outlined glyphs, never text: the PNG twin is rasterised on a host with no fonts.
    expect(markup).not.toMatch(/<text\b/);
    expect(markup).toContain('data-brand-part="name"');
    expect(markup.match(/<image\b/g)).toHaveLength(1);
    expect(markup).not.toMatch(/YOUR EXPERIENCE MATTERS|Scan for your review draft|SCAN TO BEGIN/);
    expect(markup).not.toMatch(/data-role="business-(?:logo|initials)"/);
    for (const brandColor of ['#4285f4', '#ea4335', '#fbbc05', '#34a853']) {
      expect(markup).toContain(brandColor);
    }
    expect(markup).not.toContain('#c7472b');
    expect(markup).not.toMatch(/#(?:6d35d6|45239a|7b47df|9b76ec)/i);
    expect(markup).not.toContain('google.com');

    const png = await page.request.get(`/api/v1/qr/${source!.id}/download?format=png`);
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toContain('image/png');
    const pngBytes = await png.body();
    expect(pngBytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(pngBytes.readUInt32BE(16)).toBe(900);
    expect(pngBytes.readUInt32BE(20)).toBe(1350);

    const pixels = await sharp(pngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(
      new Uint8ClampedArray(pixels.data),
      pixels.info.width,
      pixels.info.height,
      { inversionAttempts: 'dontInvert' },
    );
    expect(decoded?.data).toBe(source!.resolve_url);

    const configuredBase = process.env.APP_BASE_URL;
    expect(configuredBase, 'APP_BASE_URL must be loaded for QR payload verification').toBeTruthy();
    expect(decoded?.data).toBe(new URL(`/r/${source!.code}`, configuredBase).href);
    if (!decoded) throw new Error('Downloaded PNG did not contain a decodable QR code.');

    const scan = await page.request.get(decoded.data);
    expect(scan.status()).toBe(200);
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
