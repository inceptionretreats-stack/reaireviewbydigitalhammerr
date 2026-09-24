import { expect, test } from '@playwright/test';
import { revealMarketingNavigation } from './helpers/marketing-navigation';

// Browser plugin not available. Exercise the repository's installed Chrome runner;
// these public-page checks never sign up, generate a review, or submit server data.
const WIDTHS = [320, 360, 375, 390, 430, 600, 601, 768, 1440, 1920] as const;

test.describe('mobile landing composition and public actions', () => {
  for (const width of WIDTHS) {
    test(`keeps the local editor and public plan/privacy routes usable at ${width}px`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      const mutations: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('request', (request) => {
        if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url());
      });
      await page.setViewportSize({ width, height: width >= 1440 ? 960 : 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveTitle('Ai Review by Digital Hammerr');
      await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
      if ([320, 390, 430, 601, 1440, 1920].includes(width)) {
        await page.screenshot({ path: testInfo.outputPath(`landing-${width}-first.png`) });
      }

      const editor = page.getByRole('textbox', { name: 'Edit the example review draft' });
      const edit = page.getByRole('button', { name: 'Edit the example draft', exact: true });
      await expect(editor).toHaveAttribute('readonly', '');
      await edit.scrollIntoViewIfNeeded();
      if (width <= 600) expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await edit.click();
      await expect(editor).toBeFocused();
      await expect(editor).not.toHaveAttribute('readonly');
      if (width <= 600) await expect(editor).toHaveCSS('font-size', '16px');
      await editor.fill('This is my own illustrative draft.');
      const done = page.getByRole('button', { name: 'Finish editing the example draft' });
      if (width <= 600) expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await done.click();
      await expect(editor).toHaveValue('This is my own illustrative draft.');
      await expect(editor).toHaveAttribute('readonly', '');
      await expect(page.locator('#why-ai-review')).toContainText(
        'Illustrative draft preview, not a customer result.',
      );

      const cards = page.locator('#pricing article');
      await expect(cards).toHaveCount(2);
      for (const card of await cards.all()) {
        const action = card.locator(':scope > a');
        const features = card.locator('ul');
        const price = card.locator('p').filter({ hasText: /^₹/ });
        const name = card.getByRole('heading', { level: 3 });
        const actionBox = (await action.boundingBox())!;
        const featuresBox = (await features.boundingBox())!;
        if (width <= 600) {
          expect(actionBox.y).toBeGreaterThanOrEqual(featuresBox.y + featuresBox.height);
          const nameBox = (await name.boundingBox())!;
          const priceBox = (await price.boundingBox())!;
          expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(priceBox.x);
          expect(
            Math.min(nameBox.y + nameBox.height, priceBox.y + priceBox.height),
          ).toBeGreaterThan(Math.max(nameBox.y, priceBox.y));
          expect(actionBox.height).toBeGreaterThanOrEqual(52);
        } else {
          expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(featuresBox.y);
        }
        await expect(action).toHaveAttribute('href', '/signup');
      }

      for (const plan of ['Free', 'Pro'] as const) {
        await page
          .getByRole('link', { name: `Show more about the ${plan} plan`, exact: true })
          .click();
        await expect(page).toHaveURL(/\/legal\/pricing$/);
        await expect(
          page.getByRole('heading', { level: 1, name: 'Free and Pro plan details' }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: `${plan} plan` })).toBeVisible();
        await expect(
          page.getByRole('table', { name: 'Free and Pro plan comparison' }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await page.goBack();
        await expect(page.locator('#pricing')).toBeVisible();
      }
      const footer = page.getByRole('contentinfo');
      for (const [label, href] of [
        ['Privacy', '/legal/privacy'],
        ['Terms', '/legal/terms'],
        ['Cancellation / Refunds', '/legal/cancellation-refunds'],
        ['Contact', '/legal/contact'],
      ]) {
        const link = footer.getByRole('link', { name: label, exact: true });
        await expect(link).toHaveAttribute('href', href);
        if (width <= 600) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await footer.getByRole('link', { name: 'Privacy', exact: true }).click();
      await expect(page).toHaveURL(/\/legal\/privacy$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test('resets the mobile menu across resize and navigates from home without stale scroll positions', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320, 390, 430, 600, 601, 768, 1440, 1920, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#home', { waitUntil: 'networkidle' });
      await revealMarketingNavigation(page);
      const pricing = page
        .locator('#marketing-navigation')
        .getByRole('link', { name: 'Pricing', exact: true, includeHidden: true });
      await pricing.click();
      await expect(page).toHaveURL(/\/#pricing$/);
      const headerHeight = (await page.getByRole('banner').boundingBox())!.height;
      const pricingTop = async () => (await page.locator('#pricing').boundingBox())!.y;
      await expect
        .poll(pricingTop, { message: `Pricing remains below header after resizing to ${width}px` })
        .toBeGreaterThanOrEqual(headerHeight - 1);
      await expect
        .poll(pricingTop, {
          message: `Pricing anchor lands near screen top after resizing to ${width}px`,
        })
        .toBeLessThan(150);
      if (width <= 600) await expect(page.locator('#marketing-navigation')).toBeHidden();
    }
    await revealMarketingNavigation(page);
    await page.setViewportSize({ width: 601, height: 900 });
    await expect(page.locator('#marketing-navigation')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.locator('#marketing-navigation')).toBeHidden();
  });

  test('restores the homepage when going back from plan details after section navigation', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      await revealMarketingNavigation(page);
      await page
        .locator('#marketing-navigation')
        .getByRole('link', { name: 'Pricing', exact: true })
        .click();
      await expect(page).toHaveURL(/\/#pricing$/);
      await page.getByRole('link', { name: 'Show more about the Free plan', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Free and Pro plan details' }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/#pricing$/);
      await expect(page.locator('#pricing')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review Ai likh dega');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Free and Pro plan details' }),
      ).toHaveCount(0);
      await page.getByRole('link', { name: 'Show more about the Free plan', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Free and Pro plan details' }),
      ).toBeVisible();
      await revealMarketingNavigation(page);
      await page
        .locator('#marketing-navigation')
        .getByRole('link', { name: 'How it works', exact: true })
        .click();
      await expect(page).toHaveURL(/\/#how-it-works$/);
      await expect(page.locator('#how-it-works')).toBeInViewport();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review Ai likh dega');
    }
  });
});
