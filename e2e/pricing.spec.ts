import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';

// Browser plugin not available. Use the existing Chrome/Playwright setup for these
// read-only marketing checks; visiting signup never submits a form or creates an account.
const ENTRY_ROUTES = ['/#pricing', '/pricing'] as const;
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 1622, height: 900 },
  { width: 1586, height: 992 },
  { width: 1622, height: 818 },
  { width: 900, height: 900 },
  { width: 744, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

async function capturePricing(section: Locator, filename: string) {
  if (!process.env.PRICING_SCREENSHOT_DIR) return;
  const page = section.page();
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.width,
    height: Math.max(viewport.height, Math.ceil((await section.boundingBox())!.height) + 160),
  });
  try {
    await section.evaluate((element) =>
      element.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    await section.screenshot({
      path: path.join(process.env.PRICING_SCREENSHOT_DIR, filename),
      animations: 'disabled',
      style:
        'header:has(a[aria-label="Ai Review home"]), nextjs-portal { visibility: hidden !important; }',
    });
  } finally {
    await page.setViewportSize(viewport);
  }
}

async function expectReadableCard(card: Locator, page: Page, descriptionText: string) {
  const description = card.getByText(descriptionText, { exact: true });
  const features = card.getByRole('listitem');
  const action = card.locator(':scope > a');
  await expect(description).toBeVisible();
  await expect(features).toHaveCount(3);
  await expect(action).toHaveAttribute('href', '/signup');
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('background-image', 'none');
  expect(
    await action.evaluate((element) => {
      const featureList = element.closest('article')!.querySelector('ul')!;
      return Boolean(
        element.compareDocumentPosition(featureList) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
  const typography = await card.evaluate((element) => {
    const size = (node: Element) => Number.parseFloat(getComputedStyle(node).fontSize);
    return {
      features: Array.from(element.querySelectorAll('li'), size),
      action: size(element.querySelector('a')!),
      clippedText: Array.from(element.querySelectorAll<HTMLElement>('h3, p, li, a')).some(
        (node) => node.scrollWidth > node.clientWidth + 1,
      ),
    };
  });
  expect(
    await description.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  for (const size of typography.features) expect(size).toBeGreaterThanOrEqual(15);
  expect(typography.action).toBeGreaterThanOrEqual(15);
  expect(typography.clippedText).toBe(false);
  expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(action).toHaveCSS('transition-duration', '0s');
  await expect(card).toHaveCSS('animation-name', 'none');

  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  for (const element of [card, description, action, ...(await features.all())]) {
    const box = (await element.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
  }
}

test.describe('readable compact pricing plans', () => {
  for (const route of ENTRY_ROUTES) {
    for (const viewport of VIEWPORTS) {
      test(`${route} keeps both plans readable and signup actions working at ${viewport.width}x${viewport.height}px`, async ({
        page,
      }) => {
        const runtimeProblems: string[] = [];
        page.on('pageerror', (error) => runtimeProblems.push(error.message));
        page.on('console', (message) => {
          if (
            message.type() === 'warning' &&
            message
              .text()
              .startsWith(
                'Image with src "/marketing/ai-review-robot-mascot.png" was detected as the Largest Contentful Paint (LCP).',
              )
          ) {
            // The existing section below pricing can enter the initial hash-linked viewport.
            // Preserve its dev-only loading advisory without treating it as a pricing failure.
            test
              .info()
              .annotations.push({ type: 'existing-image-advisory', description: message.text() });
            return;
          }
          if (message.type() === 'error' || message.type() === 'warning') {
            runtimeProblems.push(`${message.type()}: ${message.text()}`);
          }
        });
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const response = await page.goto(route);
        expect(response?.ok()).toBe(true);
        // End initial LCP measurement through user scrolling before section-sized captures.
        await page.mouse.wheel(0, 1);
        await expect(page).toHaveURL(/\/#pricing$/);
        await expect(page).toHaveTitle('Ai Review by Digital Hammerr');
        await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);

        const pricing = page.locator('#pricing');
        await expect(pricing.getByRole('heading', { level: 2 })).toBeVisible();
        const cards = pricing.getByRole('article');
        await expect(cards).toHaveCount(2);
        const free = cards.filter({
          has: page.getByRole('heading', { name: 'Free', exact: true }),
        });
        const pro = cards.filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) });
        await expect(free.getByText('₹0', { exact: true })).toBeVisible();
        await expect(pro.locator('p').filter({ hasText: /^₹999\s*\/\s*year$/ })).toBeVisible();
        await expect(free).toContainText(/(?:Ten|10)\s+Ai(?: review)? drafts per business/i, {
          useInnerText: true,
        });
        await expect(pro).toContainText('2,000 Ai drafts per year', { useInnerText: true });
        await expect(pro).toContainText(/billed annually/i);
        await expect(pricing).not.toContainText(/unlimited|lifetime/i);
        await expectReadableCard(free, page, 'Try the complete review loop.');
        await expectReadableCard(pro, page, 'More capacity for your business.');

        const freeBox = (await free.boundingBox())!;
        const proBox = (await pro.boundingBox())!;
        if (viewport.width > 820) {
          // Includes the accessible 44px Show more link added beneath the features.
          expect(freeBox.height).toBeLessThan(550);
          expect(proBox.height).toBeLessThan(550);
          expect(Math.abs(freeBox.y - proBox.y)).toBeLessThanOrEqual(1);
          expect(Math.abs(freeBox.height - proBox.height)).toBeLessThanOrEqual(1);
          expect(Math.abs(freeBox.width - proBox.width)).toBeLessThanOrEqual(1);
          expect(freeBox.x + freeBox.width).toBeLessThanOrEqual(proBox.x);
          const freeAction = (await free.locator(':scope > a').boundingBox())!;
          const proAction = (await pro.locator(':scope > a').boundingBox())!;
          expect(Math.abs(freeAction.y - proAction.y)).toBeLessThanOrEqual(1);
          expect(Math.abs(freeAction.height - proAction.height)).toBeLessThanOrEqual(1);
        } else {
          expect(proBox.y).toBeGreaterThanOrEqual(freeBox.y + freeBox.height);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await capturePricing(
          pricing,
          `pricing-final-${route === '/pricing' ? 'redirect' : 'home'}-${viewport.width}x${viewport.height}.png`,
        );

        for (const plan of ['Free', 'Pro']) {
          const card = pricing.getByRole('article').filter({
            has: page.getByRole('heading', { name: plan, exact: true }),
          });
          await card.locator(':scope > a').click();
          await expect(page).toHaveURL(/\/signup$/);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await page.goBack();
          await page.mouse.wheel(0, 1);
          await expect(page).toHaveURL(/\/#pricing$/);
          await expect(pricing.getByRole('heading', { name: plan, exact: true })).toBeVisible();
        }
        expect(runtimeProblems).toEqual([]);
      });
    }
  }
});
