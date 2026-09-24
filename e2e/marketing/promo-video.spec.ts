import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const PROMO_TITLE = 'Stop Losing Customers Because of Bad or Missing Reviews';
const PROMO_VIDEO = '/marketing/ai-review-promo.mp4';
const PROMO_POSTER = '/marketing/ai-review-promo-poster.webp';

test.describe('homepage promotional video', () => {
  test('shows only a headline and the supplied video immediately below How it works', async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.goto('/');
    await expect(page).toHaveTitle('Ai Review by Digital Hammerr');
    await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
    const section = page.locator('#review-video[data-promo-section]');
    await expect(section).toHaveCount(1);
    await expect(section.getByRole('heading')).toHaveCount(1);
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(PROMO_TITLE);
    await expect(section.locator('p, figcaption, a, button')).toHaveCount(0);
    expect(
      await section.evaluate((element) => ({
        previous: element.previousElementSibling?.id,
        next: element.nextElementSibling?.id,
      })),
    ).toEqual({ previous: 'how-it-works', next: 'why-ai-review' });

    const video = section.locator('video[data-promo-video]');
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAccessibleName('Ai Review promotional video');
    await expect(video).toHaveAttribute('poster', PROMO_POSTER);
    await expect(video).toHaveAttribute('preload', 'none');
    await expect(video).toHaveJSProperty('controls', true);
    await expect(video).toHaveJSProperty('playsInline', true);
    await expect(video).toHaveJSProperty('autoplay', false);
    await expect(video).toHaveJSProperty('muted', false);
    await expect(video).toHaveJSProperty('paused', true);
    await expect(video.locator('source')).toHaveCount(1);
    await expect(video.locator('source')).toHaveAttribute('src', PROMO_VIDEO);
    await expect(video.locator('source')).toHaveAttribute('type', 'video/mp4');

    for (const [path, contentType] of [
      [PROMO_VIDEO, 'video/mp4'],
      [PROMO_POSTER, 'image/webp'],
    ]) {
      const response = await page.request.head(path!);
      expect(response.ok(), path).toBe(true);
      expect(response.headers()['content-type']).toContain(contentType);
      expect(Number(response.headers()['content-length'])).toBeGreaterThan(100);
    }
    expect(runtimeErrors).toEqual([]);
  });

  test('keeps the headline and complete video frame balanced at desktop and mobile sizes', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const evidenceDirectory = await mkdtemp(join(tmpdir(), 'ai-review-promo-heading-'));
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 1218, height: 900 },
      { width: 768, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/#review-video');
      await page.evaluate(() => document.fonts.ready);
      const section = page.locator('[data-promo-section]');
      const heading = section.getByRole('heading', { level: 2, name: PROMO_TITLE });
      const video = section.locator('[data-promo-video]');
      await expect(heading).toBeVisible();
      await expect(heading.getByText('Reviews', { exact: true })).toBeVisible();
      await video.scrollIntoViewIfNeeded();
      await expect(video).toBeVisible();
      await expect(video).toHaveJSProperty('paused', true);
      await expect(video).toHaveJSProperty('controls', true);
      const geometry = await section.evaluate((element) => {
        const video = element.querySelector<HTMLVideoElement>('[data-promo-video]')!;
        const heading = element.querySelector('h2')!;
        const videoBox = video.getBoundingClientRect();
        const headingBox = heading.getBoundingClientRect();
        const sectionBox = element.getBoundingClientRect();
        const headingStyle = getComputedStyle(heading);
        const textBounds: DOMRect[] = [];
        const textNodes = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        let textNode: Node | null;
        while ((textNode = textNodes.nextNode())) {
          if (!textNode.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(textNode);
          textBounds.push(...range.getClientRects());
        }
        const decorationBounds = [...heading.querySelectorAll('svg')].map((decoration) =>
          decoration.getBoundingClientRect(),
        );
        return {
          objectFit: getComputedStyle(video).objectFit,
          width: videoBox.width,
          height: videoBox.height,
          videoLeft: videoBox.left,
          videoRight: videoBox.right,
          headingBeforeVideo: headingBox.bottom <= videoBox.top,
          headingLeft: headingBox.left,
          headingRight: headingBox.right,
          textLeft: Math.min(...textBounds.map((bounds) => bounds.left)),
          textRight: Math.max(...textBounds.map((bounds) => bounds.right)),
          decorationLeft: Math.min(...decorationBounds.map((bounds) => bounds.left)),
          decorationRight: Math.max(...decorationBounds.map((bounds) => bounds.right)),
          headingAlignment: headingStyle.textAlign,
          headingWeight: Number(headingStyle.fontWeight),
          headingFontSize: Number.parseFloat(headingStyle.fontSize),
          sectionContainsVideo:
            videoBox.top >= sectionBox.top && videoBox.bottom <= sectionBox.bottom,
          viewportWidth: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
        };
      });
      expect(geometry.objectFit).toBe('contain');
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.height).toBeGreaterThan(0);
      expect(geometry.width / geometry.height).toBeCloseTo(16 / 9, 1);
      expect(geometry.videoLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.videoRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.headingBeforeVideo).toBe(true);
      expect(geometry.headingLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.headingRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.textLeft).toBeGreaterThanOrEqual(geometry.headingLeft - 1);
      expect(geometry.textRight).toBeLessThanOrEqual(geometry.headingRight + 1);
      expect(geometry.decorationLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.decorationRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.headingAlignment).toBe('center');
      expect(geometry.headingWeight).toBeGreaterThanOrEqual(700);
      expect(geometry.headingFontSize).toBeGreaterThanOrEqual(26);
      expect(geometry.headingFontSize).toBeLessThanOrEqual(76);
      expect(geometry.sectionContainsVideo).toBe(true);
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      if ([1440, 1218, 390].includes(viewport.width)) {
        const sectionBox = await section.boundingBox();
        await page.setViewportSize({
          width: viewport.width,
          height: Math.max(viewport.height, Math.ceil(sectionBox!.height) + 130),
        });
        await section.evaluate((element) =>
          element.scrollIntoView({ block: 'start', behavior: 'instant' }),
        );
        const screenshotPath = join(evidenceDirectory, `promo-heading-${viewport.width}.png`);
        await section.screenshot({ path: screenshotPath });
        await testInfo.attach(`Promo heading at ${viewport.width}px`, {
          path: screenshotPath,
          contentType: 'image/png',
        });
      }
    }
  });

  test('plays with sound only after user action and supports native keyboard pause', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#review-video');
    const video = page.locator('[data-promo-video]');
    await video.scrollIntoViewIfNeeded();
    await expect(video).toBeVisible();
    await expect(video).toHaveJSProperty('paused', true);
    await video.focus();
    await expect(video).toBeFocused();
    await page.keyboard.press('Space');
    await expect(video).toHaveJSProperty('paused', false);
    await expect(video).toHaveJSProperty('muted', false);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    const metadata = await video.evaluate((element: HTMLVideoElement) => ({
      width: element.videoWidth,
      height: element.videoHeight,
      duration: element.duration,
      error: element.error,
    }));
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
    expect(metadata.width / metadata.height).toBeCloseTo(16 / 9, 1);
    expect(metadata.duration).toBeGreaterThan(0);
    expect(metadata.error).toBeNull();
    const startedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(startedAt + 0.1);
    await page.keyboard.press('Space');
    await expect(video).toHaveJSProperty('paused', true);
  });
});
