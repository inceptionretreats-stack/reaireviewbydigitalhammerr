import { expect, test, type Page } from '@playwright/test';

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const SLUG = process.env.E2E_SLUG ?? 'demo-south-cafe';

test.use({ baseURL: ORIGIN });

for (const viewport of [
  { width: 320, height: 740 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
]) {
  test(`business profile and private feedback fit ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const profile = await page.goto(`/${SLUG}`, { waitUntil: 'domcontentloaded' });
    expect(profile?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Digital Hammerr' })).toBeVisible();
    await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
    await expectContained(page, `profile ${viewport.width}px`);

    await page.getByRole('link', { name: 'Send private feedback' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/${SLUG}/feedback`);
    await expect(page.getByRole('heading', { name: /private feedback for/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /what would you like/i })).toBeVisible();
    await expectContained(page, `feedback ${viewport.width}px`);

    // Client-side validation must remain usable without sending data or moving the page.
    await page.getByRole('button', { name: 'Submit Feedback' }).click();
    await expect(page.locator('#feedback-message-error')).toContainText(
      'Please write between 5 and 2000',
    );
    await expect(page).toHaveURL(`${ORIGIN}/${SLUG}/feedback`);
  });
}

async function expectContained(page: Page, name: string) {
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    controls: Array.from(document.querySelectorAll<HTMLElement>('input, textarea, button, a')).map(
      (control) => {
        const bounds = control.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          height: bounds.height,
          visible: bounds.width > 0 && bounds.height > 0,
        };
      },
    ),
  }));
  expect(layout.scrollWidth, name).toBeLessThanOrEqual(layout.width);
  for (const control of layout.controls.filter((item) => item.visible)) {
    expect(control.left, name).toBeGreaterThanOrEqual(0);
    expect(control.right, name).toBeLessThanOrEqual(layout.width);
  }
}
