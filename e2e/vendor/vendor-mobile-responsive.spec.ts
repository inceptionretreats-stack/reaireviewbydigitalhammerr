import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? 'demo-owner@example.com',
  password: process.env.E2E_OWNER_PASSWORD ?? 'demo-owner-Password1!',
};

const ROUTES = [
  '/app',
  '/app/ai-review',
  '/app/review-modes',
  '/app/qr',
  '/app/profile',
  '/app/customers',
  '/app/review-requests',
  '/app/feedback',
  '/app/analytics',
  '/app/subscription',
  '/app/settings',
] as const;

const SETUP_STEPS = ['business', 'review-link', 'links', 'ai', 'finish'] as const;

test('every vendor screen fits phone and small-tablet viewports', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(OWNER.email);
  await page.getByLabel(/^password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });

  for (const width of [320, 375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ROUTES) {
      await page.goto(path);
      await expect(page.locator('.app-main h1').first(), path).toBeVisible();
      await expect(page.locator('.app-sidebar')).toBeVisible();

      const geometry = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(geometry.documentWidth, `${path} at ${width}px`).toBeLessThanOrEqual(
        geometry.viewportWidth + 1,
      );

      const artifactDir = process.env.VENDOR_UI_ARTIFACT_DIR;
      if (artifactDir && (width === 320 || width === 390)) {
        await mkdir(artifactDir, { recursive: true });
        await page.screenshot({
          path: join(artifactDir, `${path.replaceAll('/', '-').slice(1)}-${width}.png`),
          fullPage: true,
        });
      }
    }
  }

  expect(pageErrors).toEqual([]);
});

test('each onboarding step keeps its progress and fields inside phone widths', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(OWNER.email);
  await page.getByLabel(/^password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });

  for (const width of [320, 375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const step of SETUP_STEPS) {
      await page.goto(`/onboarding/${step}`);
      await expect(page.locator('.onboarding-panel h1')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Setup progress' })).toBeVisible();
      const geometry = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        progressWidth: document.querySelector<HTMLElement>('.onboarding-panel nav')?.scrollWidth,
        progressVisibleWidth:
          document.querySelector<HTMLElement>('.onboarding-panel nav')?.clientWidth,
      }));
      expect(geometry.documentWidth, `${step} at ${width}px`).toBeLessThanOrEqual(
        geometry.viewportWidth + 1,
      );
      expect(geometry.progressWidth, `${step} progress at ${width}px`).toBeLessThanOrEqual(
        geometry.progressVisibleWidth! + 1,
      );
    }
  }
});

test('compact vendor header keeps navigation and sign-out reachable on a narrow phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(OWNER.email);
  await page.getByLabel(/^password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });

  await expect(page.locator('.app-topbar')).toBeHidden();
  const metrics = page.locator('.vendor-figures .dashboard-kpi');
  await expect(metrics).toHaveCount(2);
  const first = await metrics.nth(0).boundingBox();
  const second = await metrics.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs(first!.y - second!.y)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Dashboard sections' })
    .getByRole('link', { name: 'QR Codes' })
    .click();
  await expect(page).toHaveURL(/\/app\/qr$/);
  await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
