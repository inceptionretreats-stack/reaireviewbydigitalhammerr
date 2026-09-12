import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import sharp from 'sharp';

const MARKETING_ROUTES = ['/'] as const;

const NAVIGATION = [
  { label: 'Home', href: '/#home', target: 'home' },
  { label: 'How it works', href: '/#how-it-works', target: 'how-it-works' },
  { label: 'Pricing', href: '/#pricing', target: 'pricing' },
] as const;

const GROWTH_TITLE = 'Boost Your Business Reviews on Google with Our Google Review System';
const GROWTH_CLAIM = 'Increase your reviews upto 10X in 90days';

test.describe('marketing site', () => {
  test('uses one homepage with section navigation', async ({ page }) => {
    await page.goto('/');

    const header = page.getByRole('banner');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'REVIEW Ai LIKH DEGA',
      }),
    ).toBeVisible();
    await expect(header.getByRole('link', { name: 'Features', exact: true })).toHaveCount(0);

    for (const item of NAVIGATION) {
      const link = header.getByRole('link', { name: item.label, exact: true });
      await expect(link).toHaveAttribute('href', item.href);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/#${item.target}$`));
      await expect(page.locator(`#${item.target}`)).toBeInViewport();
      await expect(link).toHaveAttribute('aria-current', 'location');
      await expect(header.locator('[aria-current="location"]')).toHaveCount(1);
      const headerBox = await header.boundingBox();
      expect(headerBox?.y).toBe(0);
    }
  });

  test('shows the new image-led hero message and working actions', async ({ page }) => {
    await page.goto('/');

    const hero = page.locator('#home');
    const message = hero.locator('[data-hero-message]');
    await expect(message).toHaveCount(1);
    await expect(message.locator('[data-hero-kicker]')).toHaveText('Aap bas scan karo...');
    await expect(message.getByRole('heading', { level: 1 })).toHaveText('REVIEW Ai LIKH DEGA');
    await expect(message.getByText('Share your experience.', { exact: true })).toBeVisible();
    await expect(message.getByText('Help others choose us!', { exact: true })).toBeVisible();
    await expect(message.locator('[data-hero-flow-step]')).toHaveText([
      'SCAN',
      'COPY',
      'PASTE',
      'REVIEW',
    ]);
    await expect(message.locator('[data-hero-trust-line]')).toHaveText(
      'Real reviews. Real trust. Real growth.',
    );
    await expect(hero.getByText('More Google reviews. Less awkward asking.')).toHaveCount(0);
    await expect(
      hero.getByText('Customers scan, Ai helps them write, and they choose what gets posted.'),
    ).toHaveCount(0);
    await expect(hero.locator('[data-review-stars="hero"]')).toHaveCount(0);

    const typography = await message.evaluate((element) => {
      const kicker = element.querySelector<HTMLElement>('[data-hero-kicker]')!;
      const headline = element.querySelector<HTMLElement>('h1')!;
      const support = Array.from(element.querySelectorAll<HTMLElement>('h1 + div > *'));
      return {
        kicker: Number.parseInt(getComputedStyle(kicker).fontWeight, 10),
        headline: Number.parseInt(getComputedStyle(headline).fontWeight, 10),
        support: support.map((line) => Number.parseInt(getComputedStyle(line).fontWeight, 10)),
      };
    });
    expect(typography.kicker).toBeLessThan(800);
    expect(typography.headline).toBeLessThan(850);
    expect(typography.support.every((weight) => weight < 750)).toBe(true);

    const primaryAction = message.getByRole('link', { name: 'Create your free QR', exact: true });
    await expect(primaryAction).toHaveCount(1);
    await expect(primaryAction).toHaveAttribute('href', '/signup');
    expect((await primaryAction.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await primaryAction.click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('gives the Ai headline accent a click response without forcing motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');

    const accent = page.locator('[data-hero-ai]');
    await expect(accent).toBeVisible();
    await expect(accent).toHaveRole('button');
    await expect(accent).toHaveAccessibleName('Ai');
    await expect(accent).toHaveAttribute('data-animation-cycle', '0');
    expect((await accent.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await accent.focus();
    await page.keyboard.press('Enter');
    await expect(accent).toHaveAttribute('data-animation-cycle', '1');
    await expect(accent.locator('span').last()).toBeAttached();
    expect(
      await accent
        .locator('span')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).not.toBe('none');

    await accent.click();
    await expect(accent).toHaveAttribute('data-animation-cycle', '2');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const reducedAccent = page.locator('[data-hero-ai]');
    await reducedAccent.click();
    expect(
      await reducedAccent
        .locator('span')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
  });

  test('places the three-step journey immediately below the homepage hero', async ({ page }) => {
    await page.goto('/');

    const journey = page.locator('#how-it-works');
    await expect(journey).toBeVisible();
    expect(
      await page.locator('main').evaluate((main) => {
        const sections = Array.from(main.children);
        return sections[1]?.id === 'how-it-works';
      }),
    ).toBe(true);
    await expect(
      journey.getByRole('heading', {
        name: /simple for you\. effortless for customers\./i,
      }),
    ).toBeVisible();
    await expect(journey.getByRole('listitem')).toHaveCount(3);
    const expectedCards = [
      {
        title: 'Scan or Tap',
        body: 'Customer scans your QR code or taps your NFC card at the counter. No app download needed.',
      },
      {
        title: 'Ai Writes the Review',
        body: 'In under 3 seconds, Ai creates a genuine-sounding review based on your business type. Sounds like a real person wrote it.',
      },
      {
        title: 'One Tap to Post',
        body: 'Customer copies the review and is instantly redirected to your Google page. Done in 10 seconds.',
      },
    ] as const;
    for (const [index, card] of expectedCards.entries()) {
      const renderedCard = journey.getByRole('listitem').nth(index);
      await expect(renderedCard.getByRole('heading', { name: card.title })).toBeVisible();
      await expect(renderedCard.getByText(card.body, { exact: true })).toBeVisible();
    }

    const journeyLink = page
      .getByRole('banner')
      .getByRole('link', { name: 'How it works', exact: true });
    await expect(journeyLink).toHaveAttribute('href', '/#how-it-works');
    await journeyLink.click();
    await expect(page).toHaveURL(/\/#how-it-works$/);
    await expect
      .poll(() =>
        journey.evaluate((section) => {
          const box = section.getBoundingClientRect();
          return box.top >= 0 && box.top < window.innerHeight;
        }),
      )
      .toBe(true);
  });

  test('uses the supplied growth messages with the Ai review mascot', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 760, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');

      const growth = page.locator('#review-growth');
      const robot = growth.locator('[data-review-growth-robot]');
      const pricing = page.locator('#pricing');
      await expect(growth).toHaveCount(1);
      await expect(
        growth.getByRole('heading', { level: 2, name: GROWTH_TITLE, exact: true }),
      ).toBeVisible();
      await expect(growth.getByText(GROWTH_CLAIM, { exact: true })).toBeVisible();
      await expect(robot).toHaveCount(1);
      await expect(robot).toHaveAttribute(
        'alt',
        'Friendly Ai robot helping a business grow its Google reviews',
      );
      await growth.scrollIntoViewIfNeeded();
      await expect(growth).toBeInViewport();
      await expect
        .poll(() =>
          robot.evaluate(
            (element) =>
              element instanceof HTMLImageElement &&
              element.complete &&
              element.naturalWidth >= 200 &&
              element.naturalHeight >= 240,
          ),
        )
        .toBe(true);

      const currentSrc = await robot.evaluate((element) =>
        decodeURIComponent((element as HTMLImageElement).currentSrc),
      );
      expect(currentSrc).toContain('/marketing/ai-review-robot-mascot.png');
      expect((await page.request.get(currentSrc)).ok()).toBe(true);

      expect(
        await growth.evaluate((section, mobileBreakpoint) => {
          const copy = section.querySelector<HTMLElement>('[data-review-growth-copy]')!;
          const image = section.querySelector<HTMLImageElement>('[data-review-growth-robot]')!;
          const sectionBox = section.getBoundingClientRect();
          const copyBox = copy.getBoundingClientRect();
          const imageBox = image.getBoundingClientRect();
          const pricingBox = document
            .querySelector<HTMLElement>('#pricing')!
            .getBoundingClientRect();
          return {
            copyInside:
              copyBox.left >= sectionBox.left &&
              copyBox.right <= sectionBox.right &&
              copyBox.top >= sectionBox.top &&
              copyBox.bottom <= sectionBox.bottom,
            robotInside:
              imageBox.left >= sectionBox.left &&
              imageBox.right <= sectionBox.right &&
              imageBox.top >= sectionBox.top &&
              imageBox.bottom <= sectionBox.bottom,
            mobileOrder: window.innerWidth > mobileBreakpoint || copyBox.bottom <= imageBox.top,
            sectionInsideViewport:
              sectionBox.left >= 0 && sectionBox.right <= document.documentElement.clientWidth,
            directlyBelowPricing: pricingBox.bottom <= sectionBox.top,
          };
        }, 820),
      ).toEqual({
        copyInside: true,
        robotInside: true,
        mobileOrder: true,
        sectionInsideViewport: true,
        directlyBelowPricing: true,
      });
      await expect(pricing).toHaveCount(1);
    }

    await expect(page.locator('#how-it-works img[src*="ai-review-robot-mascot"]')).toHaveCount(1);
    await expect(page.locator('main > #pricing + #review-growth')).toHaveCount(1);
    expect(
      await page.locator('main').evaluate((main) => {
        const home = main.querySelector('#home')!;
        const how = main.querySelector('#how-it-works')!;
        const growth = main.querySelector('#review-growth')!;
        const story = main.querySelector('#review-journey')!;
        const pricing = main.querySelector('#pricing')!;
        const before = (first: Element, second: Element) =>
          Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
        return (
          before(home, how) &&
          before(how, story) &&
          before(story, pricing) &&
          pricing.nextElementSibling === growth
        );
      }),
    ).toBe(true);
  });

  test('redirects retired marketing pages into the single homepage', async ({ page }) => {
    for (const route of [
      { from: '/features', to: '/#home', target: 'home' },
      { from: '/pricing', to: '/#pricing', target: 'pricing' },
      { from: '/how-it-works', to: '/#how-it-works', target: 'how-it-works' },
    ]) {
      const response = await page.request.get(route.from, { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers().location).toContain(route.to);

      await page.goto(route.from);
      await expect
        .poll(() => {
          const url = new URL(page.url());
          return `${url.pathname}${url.hash}`;
        })
        .toBe(route.to);
      await expect(page.locator(`#${route.target}`)).toBeInViewport();
    }

    await page.goto('/how-it-works');
    await expect(page).toHaveURL(/\/#how-it-works$/);
    await expect(
      page.getByRole('heading', {
        name: /simple for you\. effortless for customers\./i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'How it works', exact: true }),
    ).toHaveAttribute('aria-current', 'location');
  });

  test('removes the teaser blocks while keeping real pricing and customer-control promises', async ({
    page,
  }) => {
    await page.goto('/');

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).toContain('₹999');
    expect(body).toContain('they post it themselves');
    expect(body).toContain('no rating is requested');
    expect(body).toContain('we never claim it was submitted');
    expect(body).toContain('every draft stays editable—no forced merchant wording');
    expect(body).not.toContain('ready to make every visit easier to share?');
    expect(body).not.toContain('simple tools. a more human review experience.');
    expect(body).not.toContain('start free. grow when it makes sense.');
    await expect(page.getByRole('link', { name: 'Explore all features' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Compare plans' })).toHaveCount(0);
    const pricing = page.locator('#pricing');
    await expect(pricing.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
    await expect(pricing.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible();
    await expect(pricing).toContainText('2,000 Ai review drafts per year');
    await expect(pricing).not.toContainText(/unlimited/i);
    const freePlan = pricing
      .locator('article')
      .filter({ hasText: 'Try the complete review loop.' });
    await expect(freePlan).toContainText('Ten Ai drafts per business');
    await expect(freePlan).not.toContainText(/lifetime/i);
    await expect(pricing).not.toContainText(/lifetime/i);
  });

  test('keeps the brand colors and uses the reference focus treatment on the steps', async ({
    page,
  }) => {
    for (const route of MARKETING_ROUTES) {
      await page.goto(route);
      const details = await page.locator('main [data-accent]:visible').evaluateAll((elements) =>
        elements.map((element) => ({
          name: element.getAttribute('data-accent'),
          value: getComputedStyle(element).getPropertyValue('--section-accent').trim(),
        })),
      );
      expect(details.map((detail) => detail.name)).toEqual(['yellow', 'green']);
      expect(details.every((detail) => detail.value.length > 0)).toBe(true);
    }

    await page.goto('/');

    const markBackgrounds = await page
      .getByRole('banner')
      .getByRole('link', { name: 'Ai Review home' })
      .locator('i')
      .evaluateAll((parts) => parts.map((part) => window.getComputedStyle(part).backgroundColor));
    expect(markBackgrounds).toEqual([
      'rgb(66, 133, 244)',
      'rgb(234, 67, 53)',
      'rgb(251, 188, 5)',
      'rgb(52, 168, 83)',
    ]);

    await page.goto('/');
    const cards = page.locator('#how-it-works li');
    await expect(cards).toHaveCount(3);
    expect(await cards.nth(1).evaluate((card) => getComputedStyle(card).borderColor)).toBe(
      'rgb(67, 56, 202)',
    );
    expect(await cards.nth(1).evaluate((card) => getComputedStyle(card).transform)).toContain('-6');
    expect(
      await cards
        .locator('[aria-hidden="true"]:nth-of-type(2)')
        .evaluateAll((icons) => icons.map((icon) => getComputedStyle(icon).backgroundColor)),
    ).toEqual(['rgb(238, 242, 255)', 'rgb(238, 242, 255)', 'rgb(238, 242, 255)']);
  });

  test('loads one optimized hero image and removes the former video treatment', async ({
    page,
  }) => {
    await page.goto('/');

    const hero = page.locator('#home');
    const media = hero.locator('[data-hero-media="image"]');
    const image = media.getByRole('img', {
      name: 'Customer showing an editable Ai-written review draft on her phone',
    });

    await expect(media).toHaveCount(1);
    await expect(image).toHaveCount(1);
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth >= 640 &&
            element.naturalHeight >= 420,
        ),
      )
      .toBe(true);

    const currentSrc = await image.evaluate((element) => (element as HTMLImageElement).currentSrc);
    expect(decodeURIComponent(currentSrc)).toContain('/marketing/customer-review-hero-v4.png');
    expect((await page.request.get(currentSrc)).ok()).toBe(true);

    await expect(hero.locator('video,[data-hero-video],[data-hero-media="video"]')).toHaveCount(0);
    await expect(hero.getByRole('button', { name: /hero review animation/i })).toHaveCount(0);
    await expect(hero.locator('[data-review-stars="hero"]')).toHaveCount(0);
    await expect(media.locator('[data-hero-flow-step],[data-hero-trust-line]')).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(1);
    await expect(page.locator('#review-journey video')).toHaveCount(1);
  });

  test('plays, pauses and resumes the homepage review story', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');

    const story = page.locator('section:has(#story-showcase-title)');
    const video = story.locator('video');
    await expect(
      story.getByRole('heading', { name: 'The whole review journey, brought to life.' }),
    ).toBeVisible();
    await expect(video).toHaveAttribute('poster', '/marketing/ai-review-story-v2-poster.png');
    await expect(story.getByText('Ai Review Draft', { exact: true })).toBeVisible();
    await expect(story.getByText('Ai,', { exact: true })).toHaveCount(1);
    await expect
      .poll(() => video.evaluate((element) => element.readyState))
      .toBeGreaterThanOrEqual(1);
    expect(await video.evaluate((element) => element.duration)).toBeGreaterThan(8);
    expect(await video.evaluate((element) => element.videoWidth)).toBe(800);
    expect(await video.evaluate((element) => element.videoHeight)).toBe(1000);
    await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);

    await story.scrollIntoViewIfNeeded();
    await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);

    const frameGeometry = await video.evaluate((element) => {
      const frame = element.parentElement!;
      const control = frame.querySelector('button')!;
      const frameBox = frame.getBoundingClientRect();
      const controlBox = control.getBoundingClientRect();
      return {
        overflow: getComputedStyle(frame).overflow,
        controlInside:
          controlBox.top >= frameBox.top &&
          controlBox.right <= frameBox.right &&
          controlBox.bottom <= frameBox.bottom &&
          controlBox.left >= frameBox.left,
      };
    });
    expect(frameGeometry).toEqual({ overflow: 'hidden', controlInside: true });

    const startedAt = await video.evaluate((element) => element.currentTime);
    await expect
      .poll(() => video.evaluate((element) => element.currentTime))
      .toBeGreaterThan(startedAt + 0.1);

    await story.getByRole('button', { name: 'Pause review journey animation' }).click();
    await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);

    await story.getByRole('button', { name: 'Play review journey animation' }).click();
    await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);

    await video.evaluate((element) => {
      element.currentTime = 7.9;
    });
    await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeLessThan(2);

    await video.evaluate((element) => {
      element.dispatchEvent(new Event('ended'));
    });
    await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeLessThan(2);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const reducedVideo = page.locator('section:has(#story-showcase-title) video');
    const reducedStory = page.locator('section:has(#story-showcase-title)');
    await expect(reducedStory.getByRole('button')).toBeHidden();
    await expect.poll(() => reducedVideo.evaluate((element) => element.paused)).toBe(true);
    await expect
      .poll(() =>
        reducedStory
          .locator('video')
          .evaluate((element) => getComputedStyle(element.parentElement!).backgroundImage),
      )
      .toContain('ai-review-story-v2-poster.png');
  });

  test('keeps the single marketing page and its anchors inside every viewport', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 760, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of MARKETING_ROUTES) {
        await page.goto(route);
        const geometry = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          floating: Array.from(
            document.querySelectorAll<HTMLElement>('[data-motion-accent="motion-tick"]'),
            (element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right };
            },
          ),
        }));
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
        for (const floating of geometry.floating) {
          expect(floating.left).toBeGreaterThanOrEqual(0);
          expect(floating.right).toBeLessThanOrEqual(geometry.clientWidth);
        }
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const headerCta = page.getByRole('banner').getByRole('link', { name: 'Create account' });
        await expect(headerCta).toBeVisible();
        expect((await headerCta.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
        await expect(signIn).toBeVisible();
        expect((await signIn.boundingBox())!.height).toBeGreaterThanOrEqual(44);

        const hero = page.locator('#home');
        const heroMedia = hero.locator('[data-hero-media="image"]');
        const heroImage = heroMedia.getByRole('img', {
          name: 'Customer showing an editable Ai-written review draft on her phone',
        });
        const heroAction = hero.getByRole('link', { name: 'Create your free QR' });
        const heroQr = hero.locator('[data-hero-qr]');
        const liveDemo = heroQr.getByRole('link', { name: 'Open live demo', exact: true });
        await expect(hero.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(heroMedia).toBeVisible();
        await expect(heroImage).toBeVisible();
        await expect(heroAction).toBeVisible();
        await expect(heroQr).toBeVisible();
        await expect(liveDemo).toBeVisible();
        await expect(hero.locator('[data-hero-flow-step]')).toHaveCount(4);
        await expect(hero.locator('[data-hero-trust-line]')).toBeVisible();
        expect((await heroAction.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(
          await hero.evaluate((section, viewportWidth) => {
            const copy = section.querySelector<HTMLElement>('[data-hero-message]')!;
            const frame = section.querySelector<HTMLElement>('[data-hero-visual]')!;
            const media = section.querySelector<HTMLElement>('[data-hero-media="image"]')!;
            const image = media.querySelector<HTMLImageElement>('img')!;
            const action = Array.from(section.querySelectorAll<HTMLAnchorElement>('a')).find(
              (link) => link.textContent?.includes('Create your free QR'),
            )!;
            const qr = section.querySelector<HTMLElement>('[data-hero-qr]')!;
            const sectionBox = section.getBoundingClientRect();
            const copyBox = copy.getBoundingClientRect();
            const frameBox = frame.getBoundingClientRect();
            const mediaBox = media.getBoundingClientRect();
            const imageBox = image.getBoundingClientRect();
            const actionBox = action.getBoundingClientRect();
            const qrBox = qr.getBoundingClientRect();
            const live = qr.querySelector<HTMLElement>('a[href^="/r/"]')!;
            const liveBox = live.getBoundingClientRect();

            return {
              mediaInsideFrame:
                mediaBox.left >= frameBox.left &&
                mediaBox.right <= frameBox.right &&
                mediaBox.top >= frameBox.top &&
                mediaBox.bottom <= frameBox.bottom,
              imageCoversMedia:
                imageBox.left <= mediaBox.left &&
                imageBox.right >= mediaBox.right &&
                imageBox.top <= mediaBox.top &&
                imageBox.bottom >= mediaBox.bottom,
              mediaHasSize: mediaBox.width > 0 && mediaBox.height > 0,
              imageLoaded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
              objectFit: getComputedStyle(image).objectFit,
              mediaOverflow: getComputedStyle(media).overflow,
              actionInsideViewport: actionBox.left >= 0 && actionBox.right <= viewportWidth,
              qrInsideViewport: qrBox.left >= 0 && qrBox.right <= viewportWidth,
              qrInsideVisual:
                qrBox.left >= frameBox.left &&
                qrBox.right <= frameBox.right &&
                qrBox.top >= frameBox.top &&
                qrBox.bottom <= frameBox.bottom,
              liveInsideDock:
                liveBox.left >= qrBox.left &&
                liveBox.right <= qrBox.right &&
                liveBox.top >= qrBox.top &&
                liveBox.bottom <= qrBox.bottom,
              mobileDockPlacement: viewportWidth > 560 || qrBox.top >= mediaBox.bottom - 72,
              sectionContainsChildren:
                sectionBox.bottom >= Math.max(copyBox.bottom, frameBox.bottom),
              layoutOrder:
                viewportWidth > 820
                  ? copyBox.right <= frameBox.left
                  : copyBox.bottom <= frameBox.top,
            };
          }, viewport.width),
        ).toEqual({
          mediaInsideFrame: true,
          imageCoversMedia: true,
          mediaHasSize: true,
          imageLoaded: true,
          objectFit: 'cover',
          mediaOverflow: 'hidden',
          actionInsideViewport: true,
          qrInsideViewport: true,
          qrInsideVisual: true,
          liveInsideDock: true,
          mobileDockPlacement: true,
          sectionContainsChildren: true,
          layoutOrder: true,
        });

        for (const item of NAVIGATION.slice(1)) {
          const navLink = page
            .getByRole('banner')
            .getByRole('link', { name: item.label, exact: true });
          expect((await navLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await navLink.click();
          const targetBox = await page.locator(`#${item.target}`).boundingBox();
          const stickyHeaderBox = await page.getByRole('banner').boundingBox();
          expect(stickyHeaderBox?.y).toBe(0);
          expect(targetBox!.y).toBeGreaterThanOrEqual(stickyHeaderBox!.height);
          await expect(navLink).toHaveAttribute('aria-current', 'location');
        }
      }
    }
  });

  test('never introduces a rating gate or a customer questionnaire', async ({ page }) => {
    for (const route of MARKETING_ROUTES) {
      await page.goto(route);

      await expect(page.locator('[type="radio"]')).toHaveCount(0);
      await expect(page.getByRole('radiogroup')).toHaveCount(0);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/★|⭐|\b[1-5] stars?\b/i);
      expect(body).not.toMatch(/how would you rate|what did you like|tell us about your visit/i);
    }
  });

  test('offers account access from every page', async ({ page }) => {
    for (const route of MARKETING_ROUTES) {
      await page.goto(route);
      await expect(
        page.getByRole('banner').getByRole('link', { name: /^sign in$/i }),
      ).toHaveAttribute('href', '/login');
      await expect(
        page.getByRole('banner').getByRole('link', { name: 'Create account' }),
      ).toHaveAttribute('href', '/signup');
    }
  });

  test('shows a real QR that resolves to the live customer page', async ({ page }) => {
    await page.goto('/');

    const heroQr = page.locator('[data-hero-qr]');
    const qr = heroQr.getByRole('img', { name: /qr code/i });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);

    const link = heroQr.getByRole('link', { name: /open live demo/i });
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/r\/[A-Z0-9]{10}$/);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('keeps the three-part standee complete and its QR decodable', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 760, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');

      const heroQr = page.locator('[data-hero-qr]');
      const card = heroQr.locator('figure[aria-label^="QR card"]');
      const qr = card.getByRole('img', { name: /qr code/i });
      const liveLink = heroQr.getByRole('link', { name: /open live demo/i });

      await expect(card.getByText('Demo South Cafe')).toBeVisible();
      await expect(card.getByText('Digital Hammerr')).toBeVisible();
      await expect(qr).toBeVisible();
      await expect(card.locator('[data-qr-card-part]')).toHaveCount(3);
      expect(
        await card.evaluate((element) =>
          (element as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
        ),
      ).toBe('Demo South Cafe Ai Review by Digital Hammerr');
      await expect(liveLink).toBeVisible();
      await expect(heroQr).toHaveAttribute('role', 'group');
      await expect(heroQr).toHaveAttribute('aria-label', 'Live review demo');
      expect(
        await card.evaluate((element) => element.parentElement?.hasAttribute('data-hero-qr')),
      ).toBe(true);
      expect((await liveLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await card.scrollIntoViewIfNeeded();

      const href = await liveLink.getAttribute('href');
      expect(href).toMatch(/^\/r\/[A-Z0-9]{10}$/);

      const qrPng = await qr.screenshot({ animations: 'disabled' });
      const raster = await sharp(qrPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const decoded = jsQR(
        new Uint8ClampedArray(raster.data),
        raster.info.width,
        raster.info.height,
        { inversionAttempts: 'dontInvert' },
      );
      const configuredBase = process.env.APP_BASE_URL;
      expect(
        configuredBase,
        'APP_BASE_URL must be set so the QR is checked against its canonical public origin',
      ).toBeTruthy();
      expect(decoded?.data).toBe(new URL(href!, configuredBase).href);

      const geometry = await page.evaluate(() => {
        const wrapperElement = document.querySelector<HTMLElement>('[data-hero-qr]');
        const cardElement = wrapperElement?.querySelector<HTMLElement>(
          'figure[aria-label^="QR card"]',
        );
        const qrElement = cardElement?.querySelector<HTMLImageElement>('img');
        const nameElement = cardElement?.querySelector<HTMLElement>('[data-qr-card-part="name"]');
        const creditElement = cardElement?.querySelector<HTMLElement>(
          '[data-qr-card-part="credit"]',
        );
        const liveElement = wrapperElement?.querySelector<HTMLElement>('a[href^="/r/"]');
        if (!cardElement || !qrElement || !nameElement || !creditElement || !liveElement)
          return null;

        const exposed = (element: HTMLElement) => {
          const rect = element.getBoundingClientRect();
          return [rect.top + 2, rect.top + rect.height / 2, rect.bottom - 2].every((y) => {
            const top = document.elementFromPoint(rect.left + rect.width / 2, y);
            return top === element || Boolean(top && element.contains(top));
          });
        };
        const cardRect = cardElement.getBoundingClientRect();
        const nameRect = nameElement.getBoundingClientRect();
        const qrRect = qrElement.getBoundingClientRect();
        const creditRect = creditElement.getBoundingClientRect();
        const liveRect = liveElement.getBoundingClientRect();
        return {
          left: cardRect.left,
          right: cardRect.right,
          ratio: cardElement.offsetWidth / cardElement.offsetHeight,
          qrWidth: qrRect.width,
          qrHeight: qrRect.height,
          qrExposed: exposed(qrElement),
          nameExposed: exposed(nameElement),
          creditExposed: exposed(creditElement),
          contentOrder: nameRect.bottom <= qrRect.top && qrRect.bottom <= creditRect.top,
          liveTop: liveRect.top,
          liveBottom: liveRect.bottom,
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: document.documentElement.clientHeight,
        };
      });

      expect(geometry).not.toBeNull();
      expect(geometry!.left).toBeGreaterThanOrEqual(0);
      expect(geometry!.right).toBeLessThanOrEqual(geometry!.viewportWidth);
      expect(geometry!.ratio).toBeCloseTo(2 / 3, 1);
      expect(geometry!.qrWidth).toBeGreaterThanOrEqual(104);
      expect(geometry!.qrHeight).toBeGreaterThanOrEqual(104);
      expect(geometry!.qrExposed).toBe(true);
      expect(geometry!.nameExposed).toBe(true);
      expect(geometry!.creditExposed).toBe(true);
      expect(geometry!.contentOrder).toBe(true);
      if (viewport.width === 1280) {
        expect(geometry!.liveTop).toBeGreaterThanOrEqual(0);
        expect(geometry!.liveBottom).toBeLessThanOrEqual(geometry!.viewportHeight);
      }
      await liveLink.scrollIntoViewIfNeeded();
      await expect(liveLink).toBeInViewport();
    }
  });
});
