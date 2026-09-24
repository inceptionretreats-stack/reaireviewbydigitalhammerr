import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { revealMarketingNavigation } from './helpers/marketing-navigation';

// Browser plugin not available. Reuse the project's Chrome/Playwright suite through the
// isolated vendor UI harness. These checks only read public marketing content.
const HEADLINE = 'Ignoring reviews is like turning customers away at your door';
const ITEMS = ['Lost Trust', 'Lost Sales', 'Lost Customers'];
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1329, height: 900 },
  { width: 1440, height: 1000 },
] as const;

async function captureSection(section: Locator, filename: string) {
  const artifactDirectory = process.env.VENDOR_UI_ARTIFACT_DIR;
  if (!artifactDirectory) return;
  const directory = path.join(artifactDirectory, 'review-opportunity');
  await mkdir(directory, { recursive: true });
  const page = section.page();
  const viewport = page.viewportSize()!;
  // Keep the full section in view so tall mobile panels aren't stitched beneath the header.
  await page.setViewportSize({
    ...viewport,
    height: Math.max(viewport.height, Math.ceil((await section.boundingBox())!.height) + 160),
  });
  try {
    await section.evaluate((element) =>
      element.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    await section.screenshot({
      path: path.join(directory, filename),
      animations: 'disabled',
      style:
        'header:has(a[aria-label="Ai Review home"]), nextjs-portal { visibility: hidden !important; }',
    });
  } finally {
    await page.setViewportSize(viewport);
  }
}

test.describe('review opportunity section', () => {
  test('adds the requested message before How it works using only actual product capabilities', async ({
    page,
  }) => {
    await page.goto('/');
    const section = page.locator('#review-opportunity');
    await expect(section).toHaveAttribute('data-review-opportunity');
    await expect(section).toHaveAccessibleName(HEADLINE);
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(HEADLINE);
    await expect(section.getByRole('heading', { level: 3 })).toHaveText(ITEMS);
    await expect(section.getByRole('listitem')).toHaveCount(3);
    await expect(section).toContainText(/QR/);
    await expect(section).toContainText(/services/i);
    await expect(section).toContainText(/draft/i);
    await expect(section).toContainText(/edit/i);
    await expect(section).toContainText(/Google/);
    await expect(section).not.toContainText(/ebook|multichannel|holiday|guarantee|10x/i);
    await expect(section.getByRole('link')).toHaveCount(0);
    await expect(section.getByRole('button')).toHaveCount(0);
    const emoji = section.locator('[data-review-opportunity-emoji]');
    await expect(emoji).toHaveText(['💔', '📉', '🚶']);
    for (const icon of await emoji.all()) {
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
    }

    expect(
      await section.evaluate((element) => ({
        previous: element.previousElementSibling?.hasAttribute('data-business-audience'),
        next: element.nextElementSibling?.id,
        decorativeSvg: [...element.querySelectorAll('svg')].every(
          (svg) =>
            Boolean(svg.closest('[aria-hidden="true"]')) &&
            svg.getAttribute('focusable') === 'false',
        ),
      })),
    ).toEqual({ previous: true, next: 'how-it-works', decorativeSvg: true });
    await expect(section.locator('[data-review-opportunity-arrow]')).toHaveCount(2);
    for (const arrow of await section.locator('[data-review-opportunity-arrow]').all()) {
      await expect(arrow).toHaveAttribute('aria-hidden', 'true');
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`keeps typography, icons and navigation readable at ${viewport.width}px`, async ({
      page,
    }) => {
      const runtimeProblems: string[] = [];
      page.on('pageerror', (error) => runtimeProblems.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          runtimeProblems.push(`${message.type()}: ${message.text()}`);
        }
      });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const response = await page.goto('/');
      expect(response?.ok()).toBe(true);
      await expect(page).toHaveURL(/\/$/);
      await expect(page).toHaveTitle('Ai Review by Digital Hammerr');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);

      const section = page.locator('#review-opportunity');
      await section.scrollIntoViewIfNeeded();
      await expect(section.getByRole('heading', { level: 2 })).toBeVisible();
      const geometry = await section.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const heading = element.querySelector('h2')!;
        const intro = heading.nextElementSibling!;
        const headingBox = heading.getBoundingClientRect();
        const introBox = intro.getBoundingClientRect();
        const items = [...element.querySelectorAll('li')].map((item) => {
          const rect = item.getBoundingClientRect();
          const contents = [...item.querySelectorAll('h3, [data-review-opportunity-emoji]')].map(
            (node) => node.getBoundingClientRect(),
          );
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            contentTop: Math.min(...contents.map((content) => content.top)),
            contentBottom: Math.max(...contents.map((content) => content.bottom)),
          };
        });
        const text = [...element.querySelectorAll<HTMLElement>('h2, h3, p')];
        return {
          width: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          left: box.left,
          right: box.right,
          headingGap: introBox.top - headingBox.bottom,
          headingSize: Number.parseFloat(getComputedStyle(heading).fontSize),
          headingFont: getComputedStyle(heading).fontFamily,
          headingFontToken: getComputedStyle(heading)
            .getPropertyValue('--font-opportunity-heading')
            .trim(),
          items,
          clipped: text.some((node) => {
            const rect = node.getBoundingClientRect();
            return (
              rect.left < box.left - 1 ||
              rect.right > box.right + 1 ||
              node.scrollWidth > node.clientWidth + 1
            );
          }),
          invisibleText: text.some((node) => {
            const style = getComputedStyle(node);
            return (
              style.visibility !== 'visible' ||
              style.opacity === '0' ||
              style.color === 'rgba(0, 0, 0, 0)'
            );
          }),
          textSizes: text
            .filter((node) => node.tagName === 'P')
            .map((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
        };
      });
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.width);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.width);
      expect(geometry.headingGap).toBeGreaterThanOrEqual(viewport.width <= 390 ? 12 : 16);
      expect(geometry.headingSize).toBeGreaterThanOrEqual(27);
      expect(geometry.headingFontToken).not.toBe('');
      expect(geometry.headingFont.replaceAll('"', '')).toContain(
        geometry.headingFontToken.split(',')[0]!.replaceAll('"', ''),
      );
      expect(geometry.clipped).toBe(false);
      expect(geometry.invisibleText).toBe(false);
      expect(geometry.textSizes.every((size) => size >= 14)).toBe(true);
      expect(geometry.items).toHaveLength(3);
      for (let index = 1; index < geometry.items.length; index++) {
        const previous = geometry.items[index - 1]!;
        const item = geometry.items[index]!;
        if (viewport.width <= 390) {
          expect(item.top - previous.bottom).toBeGreaterThanOrEqual(0);
          expect(item.contentTop - previous.contentBottom).toBeGreaterThanOrEqual(16);
        } else {
          expect(Math.abs(item.top - previous.top)).toBeLessThanOrEqual(1);
          expect(item.left - previous.right).toBeGreaterThanOrEqual(16);
        }
      }
      if (viewport.width === 390 || viewport.width === 1329) {
        await captureSection(section, `review-opportunity-${viewport.width}.png`);
      }

      // Ensure the inserted section doesn't break sticky navigation or the existing journey.
      const navigation = await revealMarketingNavigation(page);
      const howLink = navigation.getByRole('link', { name: 'How it works', exact: true });
      await howLink.focus();
      await howLink.press('Enter');
      await expect(page).toHaveURL(/\/#how-it-works$/);
      const how = page.locator('#how-it-works');
      await expect(how).toBeInViewport();
      await expect(how.getByRole('heading', { level: 2, name: 'How it works' })).toBeVisible();
      await expect(how.locator('[data-how-step-title]')).toHaveText(['Step 1', 'Step 2', 'Step 3']);
      await expect(how.locator('video[data-how-video]')).toHaveCount(3);
      const howBox = (await how.boundingBox())!;
      const headerBox = (await page.getByRole('banner').boundingBox())!;
      expect(howBox.y).toBeGreaterThanOrEqual(headerBox.height - 1);
      await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
      expect(runtimeProblems).toEqual([]);
    });
  }
});
