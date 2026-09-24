import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { closeDb } from './support/db';

/**
 * The business dashboard: every screen an owner can reach, and the compliance rules that hold
 * across all of them.
 *
 * These eleven screens had been verified only as far as "returns 200". This walks each one, checks
 * it rendered its own content rather than an error boundary, and asserts the two things that
 * must never appear anywhere in the product.
 */

const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? 'demo-owner@example.com',
  password: process.env.E2E_OWNER_PASSWORD ?? 'demo-owner-Password1!',
};

const SCREENS = [
  { path: '/app', id: 'DASH-01', heading: /digital hammerr/i },
  { path: '/app/ai-review', id: 'AI-01', heading: /^Ai review settings$/i },
  { path: '/app/review-modes', id: 'AI-02', heading: /what your drafts lean on/i },
  { path: '/app/qr', id: 'QR-01', heading: /qr codes/i },
  { path: '/app/profile', id: 'PROFILE-01', heading: /your public page/i },
  { path: '/app/customers', id: 'CRM-01', heading: /customers/i },
  { path: '/app/review-requests', id: 'REQ-01', heading: /ask a customer/i },
  { path: '/app/feedback', id: 'FB-02', heading: /private feedback/i },
  { path: '/app/analytics', id: 'AN-01', heading: /how customers are using/i },
  { path: '/app/subscription', id: 'SUB-01', heading: /your plan/i },
  { path: '/app/settings', id: 'SET-01', heading: /your account/i },
] as const;

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(OWNER.email);
  await page.getByLabel(/^password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
}

/** Optional local QA evidence, never a checked-in image or a hard-coded developer path. */
async function captureVendorEvidence(page: Page, name: string): Promise<void> {
  const directory = process.env.VENDOR_UI_ARTIFACT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
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
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 900 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);

      for (const path of ['/app', '/app/qr', '/app/settings', '/app/customers']) {
        await page.goto(path);
        await expect(page.locator('.app-sidebar')).toBeVisible();
        // The workspace top bar is desktop-only. Below 1024px the compact sidebar header
        // already carries the brand and the Menu toggle, and the top bar's only control
        // (Sign out) moves into that menu, so rendering both would duplicate the header.
        // See the `@media (max-width: 1023px)` rule in
        // apps/web/components/dashboard/VendorWorkspace.module.css, and
        // e2e/vendor-mobile-responsive.spec.ts, which asserts the same rule from 320px.
        //
        // The unconditional assertion this replaces dates from the initial commit and was
        // never revisited when the vendor shell was redesigned.
        if (viewport.width >= 1024) {
          await expect(page.locator('.app-topbar')).toBeVisible();
        } else {
          await expect(page.locator('.app-topbar')).toBeHidden();
          await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
        }
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
        if (viewport.width < 768) {
          expect(geometry.mainTop!).toBeLessThan(260);
          expect(geometry.navHeight!).toBeLessThan(70);

          if (path === '/app') {
            const menu = page.getByRole('button', { name: 'Menu' });
            await expect(menu).toHaveAttribute('aria-expanded', 'false');
            await menu.click();
            await expect(menu).toHaveAttribute('aria-expanded', 'true');
            const navigation = page.getByRole('navigation', { name: 'Dashboard sections' });
            await expect(
              navigation.getByRole('link', { name: 'QR Codes', exact: true }),
            ).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(menu).toHaveAttribute('aria-expanded', 'false');
            await expect(menu).toBeFocused();
            await menu.click();
            await navigation.getByRole('link', { name: 'QR Codes', exact: true }).click();
            await expect(page).toHaveURL(/\/app\/qr$/);
            await expect(menu).toHaveAttribute('aria-expanded', 'false');
          }
        }
        if (path === '/app') {
          await page.goto('/app');
          await expect(page.locator('.vendor-figures .dashboard-kpi')).toHaveCount(2);
          // Streaming can insert the Suspense payload before its hidden container is revealed.
          // Count alone is not proof that an owner can actually see either metric.
          await expect(page.locator('.vendor-figures .dashboard-kpi').first()).toBeVisible();
          await expect(
            page.getByRole('heading', { name: 'Digital Hammerr', exact: true }),
          ).toBeVisible();
          await captureVendorEvidence(page, `vendor-dashboard-${viewport.width}`);
        }
      }
    }
  });

  test('navigation exposes eleven working destinations in four clear groups', async ({ page }) => {
    await signIn(page);
    const navigation = page.getByRole('navigation', { name: 'Dashboard sections' });
    await expect(navigation.getByRole('link')).toHaveCount(11);
    await expect(navigation.locator('.vendor-nav-group')).toHaveText([
      'Workspace',
      'Review setup',
      'Customer activity',
      'Account',
    ]);
    await expect(navigation.getByText('Soon', { exact: true })).toHaveCount(0);
    await expect(navigation.getByText('Custom Domain', { exact: true })).toHaveCount(0);
    await expect(navigation.getByText('Support', { exact: true })).toHaveCount(0);
    const destinations = await navigation
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(destinations).toEqual(SCREENS.map((screen) => screen.path));
  });

  test('dashboard metrics and paired cards align at desktop and tablet widths', async ({
    page,
  }) => {
    await signIn(page);
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/app');
      await expect(page.locator('.vendor-figures .dashboard-kpi')).toHaveCount(2);
      await expect(page.locator('.vendor-figures .dashboard-kpi').first()).toBeVisible();
      for (const selector of [
        '.vendor-figures .dashboard-kpi',
        '.vendor-overview-panels > .ui-card',
      ]) {
        const cards = page.locator(selector);
        await expect(cards).toHaveCount(2);
        const boxes = await cards.evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return {
              width: box.width,
              height: box.height,
              top: box.top,
              left: box.left,
              right: box.right,
            };
          }),
        );
        expect(
          Math.abs(boxes[0]!.height - boxes[1]!.height),
          `${selector} heights at ${width}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(boxes[0]!.width - boxes[1]!.width),
          `${selector} widths at ${width}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(boxes[0]!.top - boxes[1]!.top),
          `${selector} alignment at ${width}`,
        ).toBeLessThanOrEqual(1);
        expect(boxes[1]!.left).toBeGreaterThan(boxes[0]!.right);
      }
      await expectNoHorizontalOverflow(page);
    }
  });

  test('customer table and edit modal stay usable without saving any contact', async ({ page }) => {
    await signIn(page);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app/customers');
      await expect(page.getByRole('table', { name: 'Your customer contacts' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const add = page.getByRole('button', { name: 'Add customer', exact: true }).first();
      await add.click();
      const dialog = page.getByRole('dialog', { name: 'Add a customer' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Name', { exact: false })).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await expectNoHorizontalOverflow(page);
      await captureVendorEvidence(page, `vendor-customer-modal-${width}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(add).toBeFocused();
      const search = page.getByRole('search').getByLabel('Search', { exact: true });
      await search.fill('synthetic-no-match-for-layout');
      await page.getByRole('search').getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('table', { name: 'Your customer contacts' })).toContainText(
        /no matches|no customers/i,
      );
      await expectNoHorizontalOverflow(page);
    }
  });

  test('all five onboarding forms retain progress, readable fields and a safe Back path', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signIn(page);
    const steps = ['business', 'review-link', 'links', 'ai', 'finish'];
    const labels = ['Your business', 'Google link', 'Contact links', 'Ai context', 'Publish'];
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      for (const [index, step] of steps.entries()) {
        await page.goto(`/onboarding/${step}`);
        await expect(page.locator('.onboarding-panel')).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const progress = page.getByRole('navigation', { name: 'Setup progress' });
        await expect(progress.locator('li')).toHaveCount(5);
        await expect(progress.locator('[aria-current="step"]')).toHaveCount(1);
        await expect(progress.locator('[aria-current="step"]')).toContainText(labels[index]!);
        for (const label of labels) await expect(progress).toContainText(label);
        await expectNoHorizontalOverflow(page);
        const clippedLabels = await progress.locator('li').evaluateAll(
          (items) =>
            items.filter((item) => {
              const box = item.getBoundingClientRect();
              return (
                box.left < 0 ||
                box.right > document.documentElement.clientWidth + 1 ||
                item.scrollWidth > item.clientWidth + 1
              );
            }).length,
        );
        expect(clippedLabels).toBe(0);
        const controls = await page
          .locator(
            '.onboarding-panel .ui-input, .onboarding-panel .ui-select, .onboarding-panel .ui-textarea',
          )
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.getBoundingClientRect().width > 0)
              .map((element) => ({
                font: Number.parseFloat(getComputedStyle(element).fontSize),
                height: element.getBoundingClientRect().height,
                left: element.getBoundingClientRect().left,
                right: element.getBoundingClientRect().right,
              })),
          );
        for (const control of controls) {
          expect(control.font, `${step} field font at ${width}`).toBeGreaterThanOrEqual(16);
          expect(control.height, `${step} field target at ${width}`).toBeGreaterThanOrEqual(44);
          expect(control.left).toBeGreaterThanOrEqual(0);
          expect(control.right).toBeLessThanOrEqual(width + 1);
        }
        await expect(page.locator('body')).not.toContainText(
          /application error|unhandled runtime|something went wrong/i,
        );
        await captureVendorEvidence(page, `vendor-onboarding-${step}-${width}`);
      }
      await page.goto('/onboarding/review-link');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(/\/onboarding\/business$/);
      await expect(page.getByLabel(/business name/i)).toHaveValue('Digital Hammerr');
    }
    // The seeded business is already published; setup's resume route must not reset it.
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding\/finish$/);
    expect(errors).toEqual([]);
  });

  test('optional Ai and QR help opens with the keyboard while destructive actions remain legible', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signIn(page);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      for (const help of [
        {
          path: '/app/ai-review',
          summary: 'How your details are used',
          items: 'ol > li',
          count: 7,
          image: 'ai-settings',
        },
        {
          path: '/app/qr',
          summary: 'How your QR codes work',
          items: 'dl > div',
          count: 4,
          image: 'qr',
        },
      ]) {
        await page.goto(help.path);
        const summary = page.locator('summary').filter({ hasText: help.summary });
        const details = page.locator('details').filter({ has: summary });
        await expect(summary).toBeVisible();
        await expect(details).not.toHaveAttribute('open');
        await expect(details.locator(help.items)).toHaveCount(help.count);
        await captureVendorEvidence(page, `vendor-${help.image}-${width}`);
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(details).toHaveAttribute('open', '');
        await expect(details.locator(help.items).first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await page.keyboard.press('Space');
        await expect(details).not.toHaveAttribute('open');
        await expect(summary).toBeFocused();
      }

      await page.goto('/app/ai-review');
      await page.getByRole('button', { name: 'Reset to profile details', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Reset to profile details', exact: true });
      await expect(dialog).toBeVisible();
      const destructive = dialog.getByRole('button', { name: 'Reset the fields', exact: true });
      const appearance = await destructive.evaluate((button) => {
        const styles = getComputedStyle(button);
        const luminance = (color: string) => {
          const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
            const value = Number(part) / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const values = [luminance(styles.color), luminance(styles.backgroundColor)].sort(
          (a, b) => b - a,
        );
        return {
          foreground: styles.color,
          background: styles.backgroundColor,
          contrast: (values[0]! + 0.05) / (values[1]! + 0.05),
        };
      });
      expect(appearance.foreground).toBe('rgb(255, 255, 255)');
      expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(appearance.contrast).toBeGreaterThanOrEqual(4.5);
      await expectNoHorizontalOverflow(page);
      await captureVendorEvidence(page, `vendor-reset-dialog-${width}`);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    expect(errors).toEqual([]);
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
