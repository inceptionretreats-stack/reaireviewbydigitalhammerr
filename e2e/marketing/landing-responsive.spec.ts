import { expect, test } from '@playwright/test';
import { revealMarketingNavigation } from '../support/marketing-navigation';

// Read-only layout and navigation checks using the repository's installed Chrome runner.
// Signup links are inspected, never submitted; the example editor is local-only.
const VIEWPORTS = [
  { width: 320, height: 760 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 600, height: 900 },
  { width: 601, height: 900 },
  { width: 680, height: 900 },
  { width: 681, height: 900 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 900, height: 900 },
  { width: 1024, height: 900 },
  { width: 1366, height: 768 },
  { width: 1440, height: 960 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3440, height: 1440 },
] as const;

test.describe('landing layout from narrow phones to ultrawide desktops', () => {
  for (const viewport of VIEWPORTS) {
    test(`preserves readable content and working navigation at ${viewport.width}px`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const response = await page.goto('/', { waitUntil: 'networkidle' });
      expect(response?.ok()).toBe(true);
      await expect(page).toHaveTitle('Ai Review by Digital Hammerr');
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);

      const hero = page.locator('#home');
      await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Review Ai likh dega');
      await expect(hero.locator('[data-hero-flow-step]')).toHaveText([
        'Scan',
        'Ai draft',
        'Copy',
        'Paste',
        'Review',
      ]);
      const layout = await page.evaluate(() => {
        const measure = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)!;
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
        };
        const heading = document.querySelector<HTMLElement>('#home h1')!;
        const description = document.querySelector<HTMLElement>('[data-hero-description]')!;
        const descriptionStyle = getComputedStyle(description);
        return {
          viewport: document.documentElement.clientWidth,
          page: document.documentElement.scrollWidth,
          header: measure('header > div'),
          hero: measure('#home'),
          heroMedia: measure('[data-hero-media="video"]'),
          pricing: measure('[aria-label="Pricing plans"]'),
          how: measure('#how-it-works'),
          faq: measure('#faq'),
          benefits: measure('[data-benefits-grid]'),
          headingClipped: heading.scrollWidth > heading.clientWidth + 1,
          headingSize: Number.parseFloat(getComputedStyle(heading).fontSize),
          descriptionCharactersPerLine:
            description.clientWidth / (Number.parseFloat(descriptionStyle.fontSize) * 0.5),
        };
      });
      if (process.env.RESPONSIVE_DEBUG)
        process.stdout.write(`${JSON.stringify({ width: viewport.width, ...layout })}\n`);
      expect(layout.page).toBeLessThanOrEqual(layout.viewport);
      expect(layout.headingClipped).toBe(false);
      expect(layout.descriptionCharactersPerLine).toBeLessThanOrEqual(72);
      if (viewport.width >= 601 && viewport.width <= 680) {
        expect(layout.how.height).toBeLessThan(1150);
      }
      if (viewport.width >= 681 && viewport.width <= 820) {
        expect(layout.how.height).toBeLessThan(900);
      }
      for (const rect of [
        layout.header,
        layout.hero,
        layout.pricing,
        layout.how,
        layout.faq,
        layout.benefits,
      ]) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(layout.viewport + 1);
        expect(Math.abs(rect.left - (layout.viewport - rect.right))).toBeLessThanOrEqual(2);
      }
      expect(layout.heroMedia.left).toBeGreaterThanOrEqual(layout.hero.left);
      expect(layout.heroMedia.right).toBeLessThanOrEqual(layout.hero.right + 1);
      expect(Math.abs(layout.heroMedia.width - layout.heroMedia.height)).toBeLessThanOrEqual(1);
      if (viewport.width >= 1920) {
        // Expand modestly on desktop, then stop. Ultrawide screens must not stretch
        // the copy, cards or product video into an oversized wall of content.
        for (const [rect, minimum, maximum] of [
          [layout.hero, 1320, 1441],
          [layout.pricing, 1080, 1161],
          [layout.faq, 1200, 1321],
          [layout.benefits, 1280, 1321],
        ] as const) {
          expect(rect.width).toBeGreaterThanOrEqual(minimum);
          expect(rect.width).toBeLessThanOrEqual(maximum);
        }
        expect(layout.header.width).toBeLessThanOrEqual(1521);
        expect(layout.heroMedia.width).toBeLessThanOrEqual(640);
        expect(layout.headingSize).toBeLessThanOrEqual(112);
      }

      const header = page.getByRole('banner');
      const navigation = page.locator('#marketing-navigation');
      const menu = header.getByRole('button', { name: /navigation menu$/ });
      if (viewport.width <= 600) {
        expect((await header.boundingBox())!.height).toBeLessThanOrEqual(65);
        await expect(menu).toHaveAccessibleName('Open navigation menu');
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await expect(navigation).toBeHidden();
        const menuBox = (await menu.boundingBox())!;
        expect(menuBox.width).toBeGreaterThanOrEqual(44);
        expect(menuBox.height).toBeGreaterThanOrEqual(44);
        await menu.focus();
        await menu.press('Space');
        await expect(menu).toHaveAccessibleName('Close navigation menu');
        await expect(navigation).toBeVisible();
        await expect(navigation.getByRole('link')).toHaveText([
          'Home',
          'How it works',
          'Pricing',
          'Sign in',
        ]);
        for (const link of await navigation.getByRole('link').all()) {
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await navigation.getByRole('link', { name: 'Home', exact: true }).focus();
        await page.keyboard.press('Escape');
        await expect(navigation).toBeHidden();
        await expect(menu).toBeFocused();
        await menu.click();
        await page.mouse.click(viewport.width - 2, viewport.height - 2);
        await expect(navigation).toBeHidden();
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        const [action, media, flow] = await Promise.all([
          hero.getByRole('link', { name: 'Create your free QR' }).boundingBox(),
          hero.locator('[data-hero-media]').boundingBox(),
          hero.locator('[data-hero-flow]').boundingBox(),
        ]);
        expect(action!.y + action!.height).toBeLessThanOrEqual(flow!.y);
        expect(flow!.y + flow!.height).toBeLessThanOrEqual(media!.y);
        expect(media!.width).toBeGreaterThanOrEqual(280);
        if (viewport.width <= 360) {
          const narrowStep = await page
            .locator('[data-how-step]')
            .first()
            .evaluate((card) => {
              const caption = card
                .querySelector<HTMLElement>('[data-how-step-caption]')!
                .getBoundingClientRect();
              const media = card.querySelector<HTMLElement>('video, img')!.getBoundingClientRect();
              return {
                captionWidth: caption.width,
                captionBottom: caption.bottom,
                mediaTop: media.top,
              };
            });
          expect(narrowStep.captionWidth).toBeGreaterThanOrEqual(200);
          expect(narrowStep.captionBottom).toBeLessThanOrEqual(narrowStep.mediaTop);
        }
      } else {
        await expect(menu).toBeHidden();
        await expect(navigation).toBeVisible();
      }
      for (const target of [
        { label: 'How it works', id: 'how-it-works' },
        { label: 'Pricing', id: 'pricing' },
      ]) {
        await revealMarketingNavigation(page);
        const link = navigation.getByRole('link', {
          name: target.label,
          exact: true,
          includeHidden: true,
        });
        await expect(link).toBeVisible();
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/#${target.id}$`));
        await expect(link).toHaveAttribute('aria-current', 'location');
        if (viewport.width <= 600) await expect(navigation).toBeHidden();
        // The in-page handler schedules scrollIntoView in the next animation frame after
        // closing the phone menu. A remote build can expose the hash before that frame runs.
        await expect
          .poll(() =>
            page
              .locator(`#${target.id}`)
              .evaluate((element) => element.getBoundingClientRect().top),
          )
          .toBeLessThan(viewport.height);
        const targetBox = (await page.locator(`#${target.id}`).boundingBox())!;
        const headerBox = (await header.boundingBox())!;
        expect(headerBox.y).toBe(0);
        expect(targetBox.y).toBeGreaterThanOrEqual(headerBox.height - 1);
        expect(targetBox.y).toBeLessThan(viewport.height);
      }

      const cards = page.locator('#pricing article');
      await expect(cards).toHaveCount(2);
      const geometry = await cards.evaluateAll((elements) =>
        elements.map((card) => {
          const rect = card.getBoundingClientRect();
          const action = card
            .querySelector<HTMLAnchorElement>(':scope > a')!
            .getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            actionTop: action.top,
            clippedText: Array.from(card.querySelectorAll<HTMLElement>('h3, p, li, a')).some(
              (element) => element.scrollWidth > element.clientWidth + 1,
            ),
          };
        }),
      );
      expect(geometry.every((card) => !card.clippedText)).toBe(true);
      const [free, pro] = geometry;
      if (Math.abs(free!.top - pro!.top) <= 1) {
        expect(free!.right).toBeLessThanOrEqual(pro!.left);
        expect(Math.abs(free!.height - pro!.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(free!.actionTop - pro!.actionTop)).toBeLessThanOrEqual(1);
      } else {
        expect(pro!.top).toBeGreaterThanOrEqual(free!.bottom);
      }
      await expect(
        cards.nth(0).getByRole('link', { name: 'Show more about the Free plan' }),
      ).toHaveAttribute('href', '/legal/pricing');
      await expect(
        cards.nth(1).getByRole('link', { name: 'Show more about the Pro plan' }),
      ).toHaveAttribute('href', '/legal/pricing');

      for (const selector of ['#how-it-works', '#why-ai-review', '#review-growth', '#faq']) {
        const section = page.locator(selector);
        await section.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            section
              .locator('img:visible')
              .evaluateAll((images) =>
                images.every(
                  (image) =>
                    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
                ),
              ),
          )
          .toBe(true);
        const overflow = await section.evaluate((element) =>
          Array.from(
            element.querySelectorAll<HTMLElement>('h2, h3, [data-benefit-description], img, video'),
          )
            .filter(
              (child) =>
                getComputedStyle(child).display !== 'none' &&
                child.getBoundingClientRect().width > 0,
            )
            .some((child) => {
              const rect = child.getBoundingClientRect();
              return (
                rect.left < -1 ||
                rect.right > document.documentElement.clientWidth + 1 ||
                (['H2', 'H3'].includes(child.tagName) && child.scrollWidth > child.clientWidth + 1)
              );
            }),
        );
        expect(overflow).toBe(false);
      }
      expect(
        await page
          .locator('[data-hero-video], [data-how-video], [data-promo-video]')
          .evaluateAll((videos) =>
            videos.every((video) => getComputedStyle(video).objectFit === 'contain'),
          ),
      ).toBe(true);

      const faq = page.locator('#faq');
      const editQuestion = faq.getByRole('button', {
        name: 'Can customers edit the Ai review?',
        exact: true,
      });
      await editQuestion.click();
      await expect(editQuestion).toHaveAttribute('aria-expanded', 'true');
      await expect(faq.locator('#faq-answer-edit')).toBeVisible();
      const selectedImage = faq.locator('[data-faq-preview-for="edit"] img:visible');
      await expect(selectedImage).toHaveCount(1);
      await expect(selectedImage).toHaveCSS('object-fit', 'contain');
      await expect(selectedImage).toHaveAttribute('src', '/marketing/faq/edit-review.webp');
      await expect
        .poll(() =>
          selectedImage.evaluate(
            (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await editQuestion.press('Enter');
      await expect(editQuestion).toHaveAttribute('aria-expanded', 'false');
      expect(errors).toEqual([]);
    });
  }
});
