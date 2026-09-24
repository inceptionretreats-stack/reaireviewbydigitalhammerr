import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Browser plugin not available. Use the repository's installed Chrome/Playwright
// workflow. These checks never submit signup, contact anyone, or start checkout.
const ORIGIN = 'http://127.0.0.1:3000';
const ROUTES = [
  { path: '/legal/privacy', label: 'Privacy', heading: 'Privacy Policy', title: 'Privacy Policy' },
  { path: '/legal/terms', label: 'Terms', heading: 'Terms of service', title: 'Terms of service' },
  {
    path: '/legal/cancellation-refunds',
    label: 'Cancellation / Refunds',
    heading: 'Cancellation and refunds',
    title: 'Cancellation and refunds',
  },
  { path: '/legal/contact', label: 'Contact', heading: 'Contact us', title: 'Contact' },
] as const;
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 760 },
] as const;
const evidenceDirectory =
  process.env.PUBLIC_INFORMATION_SCREENSHOT_DIR ??
  path.join(os.tmpdir(), 'ai-review-public-information-qa');
const health = new WeakMap<BrowserContext, { errors: string[]; mutations: string[] }>();

test.use({ baseURL: ORIGIN, storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, page }, testInfo) => {
  const problems = { errors: [] as string[], mutations: [] as string[] };
  health.set(context, problems);
  const observed = new WeakSet<Page>();
  const observe = (target: Page) => {
    if (observed.has(target)) return;
    observed.add(target);
    target.on('pageerror', (error) => problems.errors.push(error.message));
    target.on('console', (message) => {
      if (!['error', 'warning'].includes(message.type())) return;
      if (
        message.type() === 'warning' &&
        message.text().startsWith('Image with src "/marketing/ai-review-robot-mascot.png"') &&
        message.text().includes('Largest Contentful Paint')
      ) {
        testInfo.annotations.push({ type: 'existing-image-advisory', description: message.text() });
        return;
      }
      problems.errors.push(`${message.type()}: ${message.text()}`);
    });
  };
  observe(page);
  context.on('page', observe);
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      problems.mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (request.isNavigationRequest() && new URL(request.url()).origin !== ORIGIN) {
      problems.errors.push(`Unexpected external navigation: ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(async ({ context }) => {
  expect(health.get(context)?.mutations, 'No state-changing HTTP requests').toEqual([]);
  expect(health.get(context)?.errors, 'No relevant browser warnings or runtime errors').toEqual([]);
});

async function expectHealthyLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const geometry = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(geometry.scroll, 'No horizontal document overflow').toBeLessThanOrEqual(geometry.client);
}

async function screenshot(page: Page, filename: string, selector?: string) {
  await mkdir(evidenceDirectory, { recursive: true });
  if (selector) {
    await page.locator(selector).screenshot({
      path: path.join(evidenceDirectory, filename),
      animations: 'disabled',
    });
    return;
  }
  await page.screenshot({
    path: path.join(evidenceDirectory, filename),
    fullPage: true,
    animations: 'disabled',
  });
}

test.describe('public information without an account', () => {
  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route.path} renders signed out at ${viewport.width}px`, async ({ page, context }) => {
        expect(await context.cookies()).toEqual([]);
        await page.setViewportSize(viewport);
        const response = await page.goto(route.path);
        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(`${ORIGIN}${route.path}`);
        await expect(page).toHaveTitle(`${route.title} | Ai Review by Digital Hammerr`);
        await expect(
          page.getByRole('heading', { level: 1, name: route.heading, exact: true }),
        ).toBeVisible();
        await expect(page.locator('article section')).not.toHaveCount(0);
        await expect(
          page.getByRole('navigation', { name: 'Policies and contact' }).getByRole('link', {
            name: route.label,
            exact: true,
          }),
        ).toHaveAttribute('aria-current', 'page');
        await expectHealthyLayout(page);
        await screenshot(page, `${route.path.split('/').at(-1)}-${viewport.width}.png`);
      });
    }

    test(`public navigation and footer links work at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/legal/privacy');
      for (const navigation of ['Policies and contact', 'Footer navigation']) {
        for (const route of ROUTES) {
          await page
            .getByRole('navigation', { name: navigation })
            .getByRole('link', { name: route.label, exact: true })
            .click();
          await expect(page).toHaveURL(`${ORIGIN}${route.path}`);
          await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
        }
      }
    });

    test(`signup legal tabs preserve all entered fields at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/signup');
      const fields = {
        full_name: 'Public information QA',
        email: 'public-information-qa@example.com',
        mobile: '9876543210',
        password: 'Local-only-test-passphrase-123',
      };
      for (const [name, value] of Object.entries(fields)) {
        await page.locator(`input[name="${name}"]`).fill(value);
      }
      const checkbox = page.locator('input[name="accept_terms"]');
      await checkbox.check();
      for (const route of [ROUTES[1], ROUTES[0]]) {
        const link = page.locator(`form a[href="${route.path}"]`);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
        const popupPromise = page.waitForEvent('popup');
        await link.click();
        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await expect(popup).toHaveURL(`${ORIGIN}${route.path}`);
        await expect(popup.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
        await popup.close();
        await expect(page).toHaveURL(`${ORIGIN}/signup`);
        for (const [name, value] of Object.entries(fields)) {
          await expect(page.locator(`input[name="${name}"]`)).toHaveValue(value);
        }
        await expect(checkbox).toBeChecked();
      }
      await expectHealthyLayout(page);
      await screenshot(page, `signup-preserved-${viewport.width}.png`);
    });

    test(`Show more opens one plan comparison page and preserves card size at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const response = await page.goto('/#pricing');
      expect(response?.status()).toBe(200);
      await expect(page.locator('#billing-details-title')).toHaveCount(0);
      await expect(page.locator('footer a[href="/legal/pricing"]')).toHaveCount(0);
      const pricing = page.locator('#pricing');
      const free = pricing
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: 'Free', exact: true }) });
      const pro = pricing
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) });
      await expect(pricing.locator('details, summary, dl')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(/10\s*[x×]|90[ -]days|90\s+days/i);
      await expectHealthyLayout(page);
      await screenshot(page, `pricing-cards-${viewport.width}.png`, '#pricing');
      const originalSizes = await pricing.getByRole('article').evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
      for (const [plan, card] of [
        ['Free', free],
        ['Pro', pro],
      ] as const) {
        const route = '/legal/pricing';
        const link = card.getByRole('link', { name: `Show more about the ${plan} plan` });
        await expect(link).toHaveAttribute('href', route);
        if (plan === 'Free') {
          await link.focus();
          await link.press('Enter');
        } else {
          await link.click();
        }
        await expect(page).toHaveURL(`${ORIGIN}${route}`);
        expect((await page.reload())?.status()).toBe(200);
        await expect(page).toHaveTitle('Free and Pro plan details | Ai Review by Digital Hammerr');
        await expect(
          page.getByRole('heading', { level: 1, name: 'Free and Pro plan details' }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Free plan' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Pro plan' })).toBeVisible();
        const comparison = page.getByRole('table', { name: 'Free and Pro plan comparison' });
        await expect(comparison).toBeVisible();
        await expect(comparison.getByRole('columnheader', { name: /^Free\b/ })).toBeVisible();
        await expect(comparison.getByRole('columnheader', { name: /^Pro\b/ })).toBeVisible();
        await expect(comparison).toContainText('₹0');
        await expect(comparison).toContainText('₹999');
        await expect(comparison).toContainText('2,000');
        await expect(page.getByRole('main')).toContainText('10 Ai drafts');
        await expect(page.getByRole('main')).toContainText('12 calendar months');
        await expect(page.getByRole('main')).toContainText('no automatic recurring charge');
        await expectHealthyLayout(page);
        await screenshot(page, `pricing-comparison-page-${viewport.width}.png`);
        await page.getByRole('link', { name: '← Back to pricing' }).click();
        await expect(page).toHaveURL(`${ORIGIN}/#pricing`);
        await expectHealthyLayout(page);
        const returnedSizes = await pricing.getByRole('article').evaluateAll((cards) =>
          cards.map((element) => {
            const box = element.getBoundingClientRect();
            return { width: box.width, height: box.height };
          }),
        );
        expect(returnedSizes).toEqual(originalSizes);
      }
      for (const legacyRoute of ['/legal/pricing/free', '/legal/pricing/pro']) {
        await page.goto(legacyRoute);
        await expect(page).toHaveURL(`${ORIGIN}/legal/pricing`);
        await expect(
          page.getByRole('heading', { level: 1, name: 'Free and Pro plan details' }),
        ).toBeVisible();
      }
      await page.goto('/legal/pricing');
      await page.getByRole('link', { name: 'Cancellation and refunds' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/legal/cancellation-refunds`);
      await page.goto('/legal/pricing');
      await page.getByRole('link', { name: 'Ask a billing question' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/legal/contact`);
    });
  }

  test('contact actions are valid links and refund uncertainty remains explicit', async ({
    page,
  }) => {
    await page.goto('/legal/contact');
    const email = page.locator('article a[href^="mailto:"]');
    await expect(email).toHaveCount(1);
    await expect(email).toHaveAttribute('href', 'mailto:info@digitalhammerr.com');
    await expect(email).toHaveText('info@digitalhammerr.com');
    const phone = page.locator('article a[href^="tel:"]');
    await expect(phone).toHaveCount(1);
    await expect(phone).toHaveAttribute('href', 'tel:+919929753194');
    await expect(phone).toHaveText('+91 99297 53194');
    // Inspect hrefs only: do not invoke mail, telephone, or external contact services.
    await page.goto('/legal/cancellation-refunds');
    await expect(page.locator('article')).toContainText(
      'A plan-specific refund window, eligibility rule and processing deadline have not yet been confirmed',
    );
  });
});
