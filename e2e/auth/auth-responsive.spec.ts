import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

test.use({ baseURL: ORIGIN });

for (const viewport of [
  { width: 320, height: 740 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
]) {
  test(`signed-out account screens fit ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);

    for (const route of ['/login', '/signup', '/forgot-password', '/reset-password']) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), route).toBe(200);
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
      const layout = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls: Array.from(document.querySelectorAll<HTMLElement>('input, button, a')).map(
          (control) => {
            const bounds = control.getBoundingClientRect();
            return {
              text: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
              left: bounds.left,
              right: bounds.right,
              height: bounds.height,
            };
          },
        ),
      }));
      expect(layout.scrollWidth, `${route} at ${viewport.width}px`).toBeLessThanOrEqual(
        layout.width,
      );
      for (const control of layout.controls) {
        expect(control.left, `${route}: ${control.text}`).toBeGreaterThanOrEqual(0);
        expect(control.right, `${route}: ${control.text}`).toBeLessThanOrEqual(layout.width);
      }
      await expect(page.locator('aside[aria-label="Ai robot review story"]')).toBeHidden();
    }
  });
}

test('mobile login navigation keeps recovery and signup within reach', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/forgot-password`);
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/login`);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/signup`);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
});

test('signed-out forms never submit credentials in a GET URL before hydration', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const route of [
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password?token=responsive-qa-dummy',
  ]) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('form').first()).toHaveAttribute('method', 'post');
  }
});
