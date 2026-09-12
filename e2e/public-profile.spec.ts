import { expect, test } from '@playwright/test';

const SLUG = process.env.E2E_SLUG ?? 'demo-south-cafe';

test.describe('public business link page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/${SLUG}`);
  });

  test('shows the business identity, ordered actions, and Digital Hammerr brand', async ({
    page,
  }) => {
    await expect(page.getByRole('heading', { name: 'Demo South Cafe' })).toBeVisible();
    await expect(page.getByText('Demo business used only in staging tests.')).toBeVisible();

    const navigation = page.getByRole('navigation', { name: /links for demo south cafe/i });
    const businessLinks = navigation.getByRole('link');
    await expect(businessLinks).toHaveText([
      'Review us on Google',
      'WhatsApp',
      'Call us',
      'Instagram',
      'Facebook',
    ]);

    const googleReview = navigation.getByRole('link', { name: 'Review us on Google' });
    await expect(googleReview).toHaveAttribute('target', '_blank');
    await expect(googleReview).toHaveAttribute('rel', /noopener/);
    const reviewBackground = await googleReview.evaluate(
      (element) => window.getComputedStyle(element).backgroundImage,
    );
    expect(reviewBackground).toMatch(/rgb\(25, 103, 210\)/);
    expect(reviewBackground).not.toMatch(/rgb\(199, 71, 43\)/);
    expect(reviewBackground).not.toMatch(/rgb\((?:109, 53, 214|69, 35, 154|127, 73, 228)\)/);

    const brandRule = await page
      .locator('article')
      .evaluate((element) => window.getComputedStyle(element, '::before').backgroundImage);
    expect(brandRule).toMatch(/rgb\(66, 133, 244\)/);
    expect(brandRule).toMatch(/rgb\(234, 67, 53\)/);
    expect(brandRule).toMatch(/rgb\(251, 188, 5\)/);
    expect(brandRule).toMatch(/rgb\(52, 168, 83\)/);

    const call = navigation.getByRole('link', { name: 'Call us' });
    await expect(call).toHaveAttribute('href', 'tel:+919999999999');
    await expect(call).not.toHaveAttribute('target', /.+/);

    const privateFeedback = page.getByRole('link', { name: 'Send private feedback' });
    await expect(privateFeedback).toHaveAttribute('href', `/${SLUG}/feedback`);
    await expect(privateFeedback).not.toHaveAttribute('target', /.+/);
    await expect(navigation.getByRole('link', { name: 'Send private feedback' })).toHaveCount(0);

    await expect(page.getByText('Digital Hammerr', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /digital hammerr/i })).toHaveCount(0);

    await expect(page.locator('[type="radio"]')).toHaveCount(0);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toMatch(/star rating|rate your experience|how many stars/);
  });

  test('opens the permanent private-feedback journey in the same tab', async ({ page }) => {
    await page.getByRole('link', { name: 'Send private feedback' }).click();

    await expect(page).toHaveURL(new RegExp(`/${SLUG}/feedback$`));
    await expect(
      page.getByRole('heading', { name: 'Private feedback for Demo South Cafe' }),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: /like the business to know/i })).toBeVisible();
  });

  for (const viewport of [
    { name: 'standard phone', width: 390, height: 844 },
    { name: 'small phone', width: 320, height: 568 },
    { name: 'reference width', width: 266, height: 491 },
  ]) {
    test(`fits every action at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.reload();

      const layout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
      }));
      expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);

      const actionHeights = await page
        .locator('nav a, a[href$="/feedback"]')
        .evaluateAll((actions) => actions.map((action) => action.getBoundingClientRect().height));
      expect(actionHeights.length).toBeGreaterThan(0);
      expect(Math.min(...actionHeights)).toBeGreaterThanOrEqual(44);

      const brand = page.getByText('Digital Hammerr', { exact: true });
      await brand.scrollIntoViewIfNeeded();
      await expect(brand).toBeVisible();
    });
  }
});
