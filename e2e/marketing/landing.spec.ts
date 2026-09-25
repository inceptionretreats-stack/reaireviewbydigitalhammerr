import { expect, test } from '@playwright/test';
import { revealMarketingNavigation } from '../support/marketing-navigation';

const MARKETING_ROUTES = ['/'] as const;
const DEMO_VIDEOS = 'main [data-hero-video], main [data-how-video]';

const NAVIGATION = [
  { label: 'Home', href: '/#home', target: 'home' },
  { label: 'How it works', href: '/#how-it-works', target: 'how-it-works' },
  { label: 'Pricing', href: '/#pricing', target: 'pricing' },
] as const;

const GROWTH_TITLE = 'Help your customers share reviews on Google with our Ai review assistant';
const GROWTH_CLAIM = 'Ai drafts. Customers edit. They choose what to post.';
const HERO_DESCRIPTION = 'Review Likhna Ab Easy Hai — AI Hai Na.';
const HOW_INTRO = 'Bas QR scan karo, Ai se review banao aur Google par share karo.';
const HOW_STEPS = [
  {
    id: 'scan',
    label: 'Step 1',
    title: 'Scan or Tap',
    caption: 'Scan the QR code to get started.',
  },
  {
    id: 'draft',
    label: 'Step 2',
    title: 'Ai Drafts a Review',
    caption: 'Let Ai draft a review you can edit.',
  },
  {
    id: 'publish',
    label: 'Step 3',
    title: 'Copy, Paste & Post',
    caption: 'Copy, paste & post it yourself.',
  },
] as const;

test.describe('marketing site', () => {
  test('uses one homepage with section navigation', async ({ page }) => {
    await page.goto('/');

    const header = page.getByRole('banner');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Review Ai likh dega',
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

  test('shows the video-led hero message and working actions', async ({ page }) => {
    await page.goto('/');

    const hero = page.locator('#home');
    const message = hero.locator('[data-hero-message]');
    await expect(message).toHaveCount(1);
    await expect(message.locator('[data-hero-kicker]')).toHaveText('Aap bas scan karo...');
    await expect(message.getByRole('heading', { level: 1 })).toHaveText('Review Ai likh dega');
    await expect(message.locator('[data-hero-description]')).toHaveText(HERO_DESCRIPTION);
    await expect(hero.getByText('Share your experience.', { exact: true })).toHaveCount(0);
    await expect(hero.getByText('Help others choose us!', { exact: true })).toHaveCount(0);
    await expect(message.locator('[data-hero-flow-step]')).toHaveText([
      'Scan',
      'Ai draft',
      'Copy',
      'Paste',
      'Review',
    ]);
    await expect(hero.locator('[data-hero-trust-line]')).toHaveCount(0);
    await expect(hero.getByText('Real reviews. Real trust. Real growth.')).toHaveCount(0);
    await expect(hero.getByText('More Google reviews. Less awkward asking.')).toHaveCount(0);
    await expect(
      hero.getByText('Customers scan, Ai helps them write, and they choose what gets posted.'),
    ).toHaveCount(0);
    await expect(hero.locator('[data-review-stars="hero"]')).toHaveCount(0);

    const typography = await message.evaluate((element) => {
      const kicker = element.querySelector<HTMLElement>('[data-hero-kicker]')!;
      const headline = element.querySelector<HTMLElement>('h1')!;
      return {
        kicker: Number.parseInt(getComputedStyle(kicker).fontWeight, 10),
        headline: Number.parseInt(getComputedStyle(headline).fontWeight, 10),
      };
    });
    expect(typography.kicker).toBeLessThan(800);
    expect(typography.headline).toBe(700);

    const primaryAction = message.getByRole('link', { name: 'Create your free QR', exact: true });
    await expect(primaryAction).toHaveCount(1);
    await expect(primaryAction).toHaveAttribute('href', '/signup');
    expect((await primaryAction.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await primaryAction.click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('uses a readable shared font and gives the hero room at desktop and narrow mobile sizes', async ({
    page,
  }) => {
    for (const route of ['/', '/login', '/signup']) {
      await page.goto(route);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const fonts = await page.evaluate(() => {
        const primaryFamily = (family: string) => family.split(',')[0]!.replace(/["']/g, '').trim();
        const expected = primaryFamily(
          getComputedStyle(document.documentElement).getPropertyValue('--font-dm-sans'),
        );
        const elements = [
          document.body,
          ...document.querySelectorAll<HTMLElement>('h1, h2, h3, button, input, select, textarea'),
        ];
        return {
          expected,
          families: elements.map((element) => {
            const style = getComputedStyle(element);
            const headingToken =
              element.id === 'review-opportunity-title'
                ? '--font-opportunity-heading'
                : element.id === 'review-video-title'
                  ? '--font-promo-heading'
                  : null;
            const expectedFamily = headingToken
              ? primaryFamily(style.getPropertyValue(headingToken))
              : expected;
            return {
              actual: primaryFamily(style.fontFamily),
              expected: expectedFamily,
              loaded:
                expectedFamily.length > 0 &&
                document.fonts.check(`${style.fontWeight} 16px "${expectedFamily}"`),
            };
          }),
          fontLoaded: expected.length > 0 && document.fonts.check(`16px "${expected}"`),
        };
      });
      expect(fonts.expected).not.toBe('');
      expect(fonts.fontLoaded).toBe(true);
      expect(
        fonts.families.every((family) => family.actual === family.expected && family.loaded),
      ).toBe(true);
    }

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const heading = page.locator('#home h1');
      await expect(heading).toHaveText('Review Ai likh dega');
      const typography = await heading.evaluate((element) => {
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize);
        const box = element.getBoundingClientRect();
        return {
          weight: Number.parseInt(style.fontWeight, 10),
          textTransform: style.textTransform,
          lineHeight: Number.parseFloat(style.lineHeight) / fontSize,
          letterSpacing:
            style.letterSpacing === 'normal'
              ? 0
              : Number.parseFloat(style.letterSpacing) / fontSize,
          left: box.left,
          right: box.right,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          headingWidth: element.clientWidth,
          headingScrollWidth: element.scrollWidth,
        };
      });
      expect(typography.weight).toBe(700);
      expect(typography.textTransform).toBe('none');
      expect(
        await page
          .locator('#home [data-hero-flow-step]')
          .evaluateAll((steps) => steps.map((step) => getComputedStyle(step).textTransform)),
      ).toEqual(['none', 'none', 'none', 'none', 'none']);
      expect(typography.lineHeight).toBeGreaterThanOrEqual(1.08);
      expect(typography.letterSpacing).toBeGreaterThanOrEqual(-0.0451);
      expect(typography.left).toBeGreaterThanOrEqual(0);
      expect(typography.right).toBeLessThanOrEqual(typography.clientWidth);
      expect(typography.scrollWidth).toBeLessThanOrEqual(typography.clientWidth);
      expect(typography.headingScrollWidth).toBeLessThanOrEqual(typography.headingWidth);
    }
  });

  test('uses a restrained solid-color headline with clear word gaps and a readable forced-color fallback', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const words = ['Review', 'Ai', 'likh', 'dega'];
    const wordColors = {
      Review: 'rgb(20, 35, 59)',
      Ai: 'rgb(25, 103, 210)',
      likh: 'rgb(20, 35, 59)',
      dega: 'rgb(20, 35, 59)',
    };
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const message = page.locator('#home [data-hero-message]');
      const heading = message.getByRole('heading', { level: 1 });
      const description = message.locator('[data-hero-description]');
      await expect(description).toHaveCount(1);
      await expect(description).toHaveText(HERO_DESCRIPTION);
      await expect(description).toHaveJSProperty('tagName', 'P');
      await expect(description).toBeVisible();

      for (const word of words) {
        const span = heading.locator('span').filter({ hasText: new RegExp(`^${word}$`) });
        await expect(span).toHaveCount(1);
        const style = await span.evaluate((element) => {
          const computed = getComputedStyle(element);
          return {
            image: computed.backgroundImage,
            color: computed.color,
            shadow: computed.textShadow,
            fill: computed.getPropertyValue('-webkit-text-fill-color'),
            weight: Number.parseInt(computed.fontWeight, 10),
            textTransform: computed.textTransform,
          };
        });
        expect(style.image).toBe('none');
        expect(style.color).toBe(wordColors[word as keyof typeof wordColors]);
        expect(style.shadow).toBe('none');
        expect(style.fill).not.toMatch(/^transparent$|rgba\([^)]*,\s*0\)$/);
        expect(style.weight).toBe(700);
        expect(style.textTransform).toBe('none');
      }

      const geometry = await message.evaluate((element) => {
        const heading = element.querySelector<HTMLElement>('h1')!;
        const description = element.querySelector<HTMLElement>('[data-hero-description]')!;
        const action = element.querySelector<HTMLAnchorElement>('a[href="/signup"]')!;
        const headingBox = heading.getBoundingClientRect();
        const descriptionBox = description.getBoundingClientRect();
        const actionBox = action.getBoundingClientRect();
        const descriptionStyle = getComputedStyle(description);
        const fontSize = Number.parseFloat(descriptionStyle.fontSize);
        const accentStyle = getComputedStyle(element.querySelector<HTMLElement>('[data-hero-ai]')!);
        const words = ['Review', 'Ai', 'likh', 'dega'].map((word) =>
          Array.from(heading.querySelectorAll<HTMLElement>('span'))
            .find((span) => span.textContent?.trim() === word)!
            .getBoundingClientRect(),
        );
        const headingFontSize = Number.parseFloat(getComputedStyle(heading).fontSize);
        return {
          headingFontSize,
          firstWordGap: words[1]!.left - words[0]!.right,
          secondWordGap: words[3]!.left - words[2]!.right,
          accentBackground: accentStyle.backgroundColor,
          accentImage: accentStyle.backgroundImage,
          accentShadow: accentStyle.boxShadow,
          descriptionFontSize: fontSize,
          descriptionWeight: Number.parseInt(descriptionStyle.fontWeight, 10),
          descriptionLineHeight: Number.parseFloat(descriptionStyle.lineHeight) / fontSize,
          immediatelyAfterHeading: heading.nextElementSibling === description,
          descriptionBeforeAction: Boolean(
            description.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
          headingGap: descriptionBox.top - headingBox.bottom,
          actionGap: actionBox.top - descriptionBox.bottom,
          descriptionLeft: descriptionBox.left,
          descriptionRight: descriptionBox.right,
          descriptionWidth: description.clientWidth,
          descriptionScrollWidth: description.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
        };
      });
      if (viewport.width === 1440) expect(geometry.headingFontSize).toBeGreaterThan(72);
      expect(geometry.firstWordGap).toBeGreaterThanOrEqual(geometry.headingFontSize * 0.15);
      expect(geometry.secondWordGap).toBeGreaterThanOrEqual(geometry.headingFontSize * 0.15);
      expect(geometry.accentBackground).toBe('rgba(0, 0, 0, 0)');
      expect(geometry.accentImage).toBe('none');
      expect(geometry.accentShadow).toBe('none');
      expect(geometry.descriptionFontSize).toBeGreaterThanOrEqual(16);
      expect(geometry.descriptionWeight).toBeLessThanOrEqual(500);
      expect(geometry.descriptionLineHeight).toBeGreaterThanOrEqual(
        viewport.width <= 600 ? 1.55 : 1.6,
      );
      expect(geometry.immediatelyAfterHeading).toBe(true);
      expect(geometry.descriptionBeforeAction).toBe(true);
      expect(geometry.headingGap).toBeGreaterThanOrEqual(16);
      expect(geometry.actionGap).toBeGreaterThanOrEqual(16);
      expect(geometry.descriptionLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.descriptionRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.descriptionScrollWidth).toBeLessThanOrEqual(geometry.descriptionWidth);
      expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    }

    await page.emulateMedia({ forcedColors: 'active' });
    const heading = page.locator('#home h1');
    await expect(heading).toBeVisible();
    for (const word of words) {
      const span = heading.locator('span').filter({ hasText: new RegExp(`^${word}$`) });
      const fallback = await span.evaluate((element) => {
        const computed = getComputedStyle(element);
        const probe = document.createElement('span');
        probe.style.color = 'Canvas';
        probe.style.forcedColorAdjust = 'none';
        document.body.append(probe);
        const canvas = getComputedStyle(probe).color;
        probe.remove();
        const fill = computed.getPropertyValue('-webkit-text-fill-color');
        const luminance = (color: string) => {
          const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((channel) => {
            const normalized = Number(channel) / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
        };
        const foreground = luminance(fill);
        const background = luminance(canvas);
        return {
          image: computed.backgroundImage,
          fill,
          contrast:
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        };
      });
      expect(fallback.image).toBe('none');
      expect(fallback.fill).not.toMatch(/^transparent$|rgba\([^)]*,\s*0\)$/);
      expect(fallback.contrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps the icon-led hero process rail readable and the headline on two lines', async ({
    page,
  }) => {
    const labels = ['Scan', 'Ai draft', 'Copy', 'Paste', 'Review'];
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const message = page.locator('#home [data-hero-message]');
      const workflow = message.locator('[data-hero-flow]');
      const steps = workflow.locator('[data-hero-flow-step]');
      await expect(workflow).toHaveRole('list');
      await expect(steps).toHaveCount(5);
      await expect(steps).toHaveText(labels);
      expect((await workflow.innerText()).replace(/\s+/g, ' ').trim()).toBe(labels.join(' '));
      await expect(workflow.getByRole('link')).toHaveCount(0);
      await expect(workflow.getByRole('button')).toHaveCount(0);

      for (const [index, label] of labels.entries()) {
        const step = steps.nth(index);
        await expect(step).toHaveJSProperty('tagName', 'LI');
        await expect(step.getByText(label, { exact: true })).toBeVisible();
        const icon = step.locator('[data-hero-flow-icon]');
        await expect(icon).toHaveCount(1);
        await expect(icon).toHaveAttribute('aria-hidden', 'true');
        await expect(icon.locator('svg')).toHaveCount(1);
        await expect(icon.locator('svg')).toHaveAttribute('fill', 'none');
        expect(await icon.locator('svg').evaluate((svg) => getComputedStyle(svg).stroke)).not.toBe(
          'none',
        );
      }

      const geometry = await message.evaluate((element) => {
        const rail = element.querySelector<HTMLElement>('[data-hero-flow]')!;
        const railBox = rail.getBoundingClientRect();
        const railItems = Array.from(rail.querySelectorAll<HTMLElement>('[data-hero-flow-step]'));
        const itemGeometry = railItems.map((item) => {
          const icon = item.querySelector<HTMLElement>('[data-hero-flow-icon]')!;
          const itemBox = item.getBoundingClientRect();
          const iconBox = icon.getBoundingClientRect();
          const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
          const labelNodes: Text[] = [];
          while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            if (!icon.contains(node) && node.textContent?.trim()) labelNodes.push(node);
          }
          const range = document.createRange();
          range.setStart(labelNodes[0]!, 0);
          const last = labelNodes[labelNodes.length - 1]!;
          range.setEnd(last, last.length);
          const labelBox = range.getBoundingClientRect();
          const inside = (box: DOMRect, parent: DOMRect) =>
            box.left >= parent.left - 0.5 &&
            box.right <= parent.right + 0.5 &&
            box.top >= parent.top - 0.5 &&
            box.bottom <= parent.bottom + 0.5;
          const separated =
            iconBox.right <= labelBox.left ||
            labelBox.right <= iconBox.left ||
            iconBox.bottom <= labelBox.top ||
            labelBox.bottom <= iconBox.top;
          return {
            iconWidth: iconBox.width,
            iconHeight: iconBox.height,
            labelWidth: labelBox.width,
            labelLeft: labelBox.left,
            labelRight: labelBox.right,
            iconInsideItem: inside(iconBox, itemBox),
            labelInsideItem: inside(labelBox, itemBox),
            itemInsideRail: inside(itemBox, railBox),
            iconAndLabelSeparated: separated,
            left: itemBox.left,
            right: itemBox.right,
          };
        });

        const heading = element.querySelector<HTMLElement>('h1')!;
        const wordWalker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        const words: { text: string; top: number; height: number; fragmentCount: number }[] = [];
        while (wordWalker.nextNode()) {
          const node = wordWalker.currentNode as Text;
          if (node.parentElement?.closest('[aria-hidden="true"]')) continue;
          for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            const box = range.getBoundingClientRect();
            words.push({
              text: match[0],
              top: box.top,
              height: box.height,
              fragmentCount: range.getClientRects().length,
            });
          }
        }
        return {
          railLeft: railBox.left,
          railRight: railBox.right,
          railWidth: rail.clientWidth,
          railScrollWidth: rail.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
          items: itemGeometry,
          words,
          lineTolerance: Number.parseFloat(getComputedStyle(heading).fontSize) * 0.2,
        };
      });
      expect(geometry.railLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.railRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.railScrollWidth).toBeLessThanOrEqual(geometry.railWidth);
      expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      for (const [index, item] of geometry.items.entries()) {
        expect(item.iconWidth).toBeGreaterThanOrEqual(32);
        expect(item.iconHeight).toBeGreaterThanOrEqual(32);
        expect(item.iconInsideItem).toBe(true);
        expect(
          item.labelInsideItem,
          `${viewport.width}px ${labels[index]}: ${JSON.stringify(item)}`,
        ).toBe(true);
        expect(item.itemInsideRail).toBe(true);
        expect(item.iconAndLabelSeparated).toBe(true);
        if (index > 0) expect(item.left).toBeGreaterThanOrEqual(geometry.items[index - 1]!.right);
      }
      expect(geometry.words.map((word) => word.text)).toEqual(['Review', 'Ai', 'likh', 'dega']);
      expect(geometry.words.every((word) => word.fragmentCount === 1)).toBe(true);
      expect(Math.abs(geometry.words[0]!.top - geometry.words[1]!.top)).toBeLessThanOrEqual(
        geometry.lineTolerance,
      );
      expect(Math.abs(geometry.words[2]!.top - geometry.words[3]!.top)).toBeLessThanOrEqual(
        geometry.lineTolerance,
      );
      expect(geometry.words[2]!.top - geometry.words[0]!.top).toBeGreaterThan(
        geometry.words[0]!.height * 0.7,
      );
    }
  });

  test('gives the Ai headline accent a click response without forcing motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Keyboard activation is immediate, unlike a click's actionability checks. Wait until the
    // streamed client bundle has arrived before interacting with the server-rendered button.
    await page.goto('/', { waitUntil: 'networkidle' });

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
    await page.reload({ waitUntil: 'networkidle' });
    const reducedAccent = page.locator('[data-hero-ai]');
    await reducedAccent.click();
    expect(
      await reducedAccent
        .locator('span')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
  });

  test('places an icon-led business-type rail without a title or controls between the hero and journey', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const audience = page.locator('[data-business-audience]');
    const track = audience.locator('[data-business-track]');
    const original = audience.locator('[data-business-list]');
    const copy = audience.locator('[data-business-list-copy]');
    await expect(audience).toHaveCount(1);
    await expect(audience).toHaveAccessibleName('Business types');
    await expect(audience.locator('header, h1, h2, h3, h4, h5, h6, button')).toHaveCount(0);
    await expect(audience.locator('[data-business-marquee-control], [data-paused]')).toHaveCount(0);
    await expect(audience).not.toHaveAttribute('data-paused');
    await expect(
      page.locator('main > #home + [data-business-audience] + #review-opportunity + #how-it-works'),
    ).toHaveCount(1);
    await expect(original.locator('li')).toHaveCount(48);
    await expect(original.locator('li svg')).toHaveCount(48);
    await expect(copy.locator('li svg')).toHaveCount(48);
    const names = (await original.locator('li').allTextContents()).map((name) => name.trim());
    expect(names.every((name) => name.length > 0)).toBe(true);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(48);
    await expect(copy).toHaveAttribute('aria-hidden', 'true');
    expect((await copy.locator('li').allTextContents()).map((name) => name.trim())).toEqual(names);
    await expect(copy.locator('a, button, input, select, textarea, [tabindex]')).toHaveCount(0);
    const extraCopy = await audience.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const text = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement?.closest('li') && node.textContent?.trim()) {
          text.push(node.textContent.trim());
        }
      }
      return text;
    });
    expect(extraCopy).toEqual([]);
    expect(await audience.innerText()).not.toMatch(
      /trusted by|our (?:customers|clients)|used by|customer brands|businesses trust us|featured customers/i,
    );

    const seam = await track.evaluate((element) => {
      const original = element.querySelector<HTMLElement>('[data-business-list]')!;
      const copy = element.querySelector<HTMLElement>('[data-business-list-copy]')!;
      const style = getComputedStyle(element);
      const listStyle = getComputedStyle(original);
      const animation = element
        .getAnimations()
        .find((item) => item.effect instanceof KeyframeEffect && item.effect.target === element);
      const keyframes =
        animation?.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [];
      return {
        animationName: style.animationName,
        duration: style.animationDuration,
        timing: style.animationTimingFunction,
        iterations: style.animationIterationCount,
        originalWidth: original.getBoundingClientRect().width,
        copyWidth: copy.getBoundingClientRect().width,
        trackWidth: element.getBoundingClientRect().width,
        itemGap: Number.parseFloat(listStyle.columnGap),
        seamPadding: Number.parseFloat(listStyle.paddingInlineEnd),
        endTransform: keyframes[keyframes.length - 1]?.transform,
      };
    });
    expect(seam.animationName).not.toBe('none');
    expect(seam.duration).toBe('180s');
    expect(seam.timing).toBe('linear');
    expect(seam.iterations).toBe('infinite');
    expect(seam.originalWidth).toBeCloseTo(seam.copyWidth, 1);
    expect(seam.trackWidth).toBeCloseTo(seam.originalWidth * 2, 0);
    expect(seam.itemGap).toBeGreaterThan(0);
    expect(seam.seamPadding).toBeCloseTo(seam.itemGap, 1);
    expect(seam.endTransform).toMatch(/-50%/);
  });

  test('moves the business rail and freezes on hover or native focus then resumes on leave or blur', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const audience = page.locator('[data-business-audience]');
    const marquee = audience.locator('[data-business-marquee]');
    const track = audience.locator('[data-business-track]');
    await audience.scrollIntoViewIfNeeded();
    const releasePointerAndFocus = async () => {
      await page.mouse.move(0, 0);
      await page.getByRole('banner').getByRole('link', { name: 'Home', exact: true }).focus();
    };
    const offset = () =>
      track.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41);
    const frameDelta = () =>
      track.evaluate(
        (element) =>
          new Promise<number>((resolve) => {
            const start = new DOMMatrix(getComputedStyle(element).transform).m41;
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve(Math.abs(new DOMMatrix(getComputedStyle(element).transform).m41 - start)),
              ),
            );
          }),
      );
    await releasePointerAndFocus();
    await expect(audience.locator('button, [data-business-marquee-control]')).toHaveCount(0);
    await expect(marquee).toHaveAttribute('tabindex', '0');
    await expect(marquee).toHaveRole('region');
    await expect
      .poll(() => track.evaluate((element) => getComputedStyle(element).animationPlayState))
      .toBe('running');
    const startedAt = await offset();
    await expect.poll(offset).toBeLessThan(startedAt - 0.1);

    await marquee.hover();
    await expect
      .poll(() => track.evaluate((element) => getComputedStyle(element).animationPlayState))
      .toBe('paused');
    expect(await frameDelta()).toBeLessThan(0.05);
    await page.mouse.move(0, 0);
    await expect
      .poll(() => track.evaluate((element) => getComputedStyle(element).animationPlayState))
      .toBe('running');
    const pointerResumedAt = await offset();
    await expect.poll(offset).toBeLessThan(pointerResumedAt - 0.1);
    await marquee.focus();
    await expect(marquee).toBeFocused();
    await expect
      .poll(() => track.evaluate((element) => getComputedStyle(element).animationPlayState))
      .toBe('paused');
    expect(await frameDelta()).toBeLessThan(0.05);
    await page.keyboard.press('Tab');
    await expect(marquee).not.toBeFocused();
    await expect
      .poll(() => track.evaluate((element) => getComputedStyle(element).animationPlayState))
      .toBe('running');
    const resumedAt = await offset();
    await expect.poll(offset).toBeLessThan(resumedAt - 0.1);
  });

  test('keeps every business type accessible without motion or page overflow at all widths', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/', { waitUntil: 'networkidle' });
      const audience = page.locator('[data-business-audience]');
      const marquee = audience.locator('[data-business-marquee]');
      const track = audience.locator('[data-business-track]');
      const original = audience.locator('[data-business-list]');
      const copy = audience.locator('[data-business-list-copy]');
      await expect(audience.locator('header, h1, h2, h3, h4, h5, h6, button')).toHaveCount(0);
      await expect(audience.locator('[data-business-marquee-control]')).toHaveCount(0);
      const geometry = await audience.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const list = element.querySelector<HTMLElement>('[data-business-list]')!;
        const items = Array.from(list.querySelectorAll('li'));
        const nameStyle = getComputedStyle(items[0]!);
        return {
          left: box.left,
          right: box.right,
          height: box.height,
          viewport: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          fontSize: Number.parseFloat(nameStyle.fontSize),
          fontWeight: nameStyle.fontWeight,
          iconSize: items[0]!.querySelector('svg')!.getBoundingClientRect().width,
          itemGap: Number.parseFloat(getComputedStyle(list).columnGap),
          lineTops: items.map((item) => item.getBoundingClientRect().top),
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.height).toBeLessThanOrEqual(viewport.width <= 600 ? 96 : 112);
      expect(geometry.fontSize).toBe(viewport.width <= 600 ? 17 : 19);
      expect(geometry.fontWeight).toBe('550');
      expect(geometry.iconSize).toBe(viewport.width <= 600 ? 28 : 30);
      expect(geometry.itemGap).toBe(viewport.width <= 600 ? 36 : 48);
      expect(Math.max(...geometry.lineTops) - Math.min(...geometry.lineTops)).toBeLessThan(1);

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await audience.scrollIntoViewIfNeeded();
      await expect(original.locator('li')).toHaveCount(48);
      await expect(copy).toBeHidden();
      await expect(audience.locator('button, [data-business-marquee-control]')).toHaveCount(0);
      expect(await track.evaluate((element) => getComputedStyle(element).animationName)).toBe(
        'none',
      );
      expect(await marquee.evaluate((element) => getComputedStyle(element).overflowX)).toMatch(
        /auto|scroll/,
      );
      await marquee.focus();
      await expect(marquee).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => marquee.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await marquee.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect(original.locator('li').last()).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }

    await page.emulateMedia({ forcedColors: 'active' });
    const contrast = await page.locator('[data-business-list] li').evaluateAll((items) => {
      const probe = document.createElement('span');
      probe.style.color = 'Canvas';
      probe.style.forcedColorAdjust = 'none';
      document.body.append(probe);
      const canvas = getComputedStyle(probe).color;
      probe.remove();
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const background = luminance(canvas);
      return items.map((item) => {
        const foreground = luminance(getComputedStyle(item).color);
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      });
    });
    expect(contrast).toHaveLength(48);
    expect(contrast.every((ratio) => ratio >= 4.5)).toBe(true);
  });

  test('keeps a compact three-step journey after the business rail and review opportunity section', async ({
    page,
  }) => {
    await page.goto('/');

    const journey = page.locator('#how-it-works');
    await expect(journey).toBeVisible();
    expect(
      await page.locator('main').evaluate((main) => {
        const sections = Array.from(main.children);
        return (
          sections[1]?.hasAttribute('data-business-audience') &&
          sections[2]?.id === 'review-opportunity' &&
          sections[3]?.id === 'how-it-works'
        );
      }),
    ).toBe(true);
    await expect(
      journey.getByRole('heading', {
        name: /simple for you\. effortless for customers\./i,
      }),
    ).toHaveCount(0);
    await expect(
      journey.getByRole('heading', { level: 2, name: 'How it works', exact: true }),
    ).toBeVisible();
    await expect(journey.locator('[data-how-intro]')).toHaveText(HOW_INTRO);
    await expect(journey.locator('[data-how-intro]')).toBeVisible();
    await expect(journey).toHaveAttribute('data-how-it-works');
    await expect(journey.locator('ol[data-how-grid]')).toHaveCount(1);
    await expect(journey.getByRole('listitem')).toHaveCount(3);
    await expect(journey.locator('[data-how-step-caption]')).toHaveCount(3);
    await expect(journey.getByText(/^(?:01|02|03)$/)).toHaveCount(0);
    expect(new Set(HOW_STEPS.map((step) => step.title)).size).toBe(3);
    for (const [index, card] of HOW_STEPS.entries()) {
      const renderedCard = journey.locator('[data-how-step]').nth(index);
      await expect(renderedCard.locator('h3[data-how-step-title]')).toHaveText(card.label);
      await expect(renderedCard.locator('[data-how-step-caption]')).toHaveText(card.caption);
      await expect(renderedCard.locator('[data-how-step-caption]')).toBeVisible();
      await expect(
        renderedCard.getByRole('heading', { name: card.title, exact: true }),
      ).toHaveCount(0);
      await expect(renderedCard.locator(`[data-how-clip="${card.id}"]`)).toHaveCount(1);
      await expect(renderedCard.locator('video[data-how-video]')).toHaveAccessibleName(
        `Video explanation: ${card.title}`,
      );
      await expect(renderedCard.locator('video[data-how-video]')).toHaveAccessibleDescription(
        `${card.title}. A short illustrative explanation that plays automatically. Focus the video and press Space or Enter to pause or resume. Your reduced-motion setting keeps the preview static. This demonstration does not generate a real review, access your clipboard or post to Google.`,
      );
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

  test('uses factual customer-controlled draft copy with the Ai review mascot', async ({
    page,
  }) => {
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
      await expect(growth).not.toContainText(/10[×x]|90\s*days?|guarantee/i);
      await expect(robot).toHaveCount(1);
      await expect(robot).toHaveAttribute(
        'alt',
        'Friendly waving Ai robot representing the editable review draft assistant',
      );
      await growth.scrollIntoViewIfNeeded();
      await expect(growth).toBeInViewport();
      await expect
        .poll(() =>
          robot.evaluate(
            (element) =>
              element instanceof HTMLImageElement &&
              element.complete &&
              element.naturalWidth > 0 &&
              element.naturalHeight > 0,
          ),
        )
        .toBe(true);

      const currentSrc = await robot.evaluate((element) =>
        decodeURIComponent((element as HTMLImageElement).currentSrc),
      );
      expect(currentSrc).toContain('/marketing/ai-review-floating-robot-v1.png');
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
        }, 600),
      ).toEqual({
        copyInside: true,
        robotInside: true,
        mobileOrder: true,
        sectionInsideViewport: true,
        directlyBelowPricing: true,
      });
      await expect(pricing).toHaveCount(1);
    }

    await expect(page.locator('#how-it-works img[src*="ai-review-robot-mascot"]')).toHaveCount(0);
    const originalArtwork = await page.evaluate(
      () =>
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error('Floating robot artwork did not load'));
          image.src = '/marketing/ai-review-floating-robot-v1.png';
        }),
    );
    expect(originalArtwork.width).toBeGreaterThanOrEqual(1024);
    expect(originalArtwork.height).toBeGreaterThanOrEqual(1024);
    await expect(page.locator('main > #pricing + #review-growth')).toHaveCount(1);
    expect(
      await page.locator('main').evaluate((main) => {
        const home = main.querySelector('#home')!;
        const how = main.querySelector('#how-it-works')!;
        const growth = main.querySelector('#review-growth')!;
        const pricing = main.querySelector('#pricing')!;
        const before = (first: Element, second: Element) =>
          Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
        return before(home, how) && before(how, pricing) && pricing.nextElementSibling === growth;
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
    ).toHaveCount(0);
    await expect(
      page
        .locator('#how-it-works')
        .getByRole('heading', { level: 2, name: 'How it works', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'How it works', exact: true }),
    ).toHaveAttribute('aria-current', 'location');
  });

  test('removes the teaser blocks while keeping real pricing and customer-controlled reviews', async ({
    page,
  }) => {
    await page.goto('/');

    const body = (await page.locator('body').innerText()).toLowerCase().replace(/\s+/g, ' ');
    expect(body).toContain('₹999');
    expect(body).toContain(
      'customers share what happened in their own words—with ai there to help.',
    );
    expect(body).toContain('nothing posts automatically.');
    expect(body).not.toContain('built for trust, not shortcuts.');
    expect(body).not.toContain('ready to make every visit easier to share?');
    expect(body).not.toContain('simple tools. a more human review experience.');
    expect(body).not.toContain('start free. grow when it makes sense.');
    await expect(page.getByRole('link', { name: 'Explore all features' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Compare plans' })).toHaveCount(0);
    const pricing = page.locator('#pricing');
    await expect(pricing.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
    await expect(pricing.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible();
    await expect(pricing).toContainText('2,000 Ai drafts per year');
    await expect(pricing).not.toContainText(/unlimited/i);
    const freePlan = pricing
      .locator('article')
      .filter({ hasText: 'Try the complete review loop.' });
    await expect(freePlan).toContainText('10 Ai drafts per business');
    await expect(freePlan).not.toContainText(/lifetime/i);
    await expect(pricing).not.toContainText(/lifetime/i);
  });

  test('shows truthful benefits alongside a real business photo with working actions', async ({
    page,
  }) => {
    const featureLabels = [
      'Branded QR',
      'Service-based drafts',
      'Editable words',
      'Private feedback',
    ];
    const stepDescriptions = [
      'Customers scan your QR and choose the service(s) they actually used.',
      'Ai helps turn their selections into an editable draft they can make their own.',
      'They can copy and post their review on Google or send private feedback. Nothing posts automatically.',
    ];

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 1024, height: 900 },
      { width: 768, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const benefits = page.locator('#why-ai-review[data-review-benefits]');
      await benefits.scrollIntoViewIfNeeded();
      await expect(benefits).toHaveCount(1);
      await expect(benefits).toHaveAttribute('aria-labelledby', 'review-benefits-title');
      await expect(
        benefits.getByRole('heading', {
          name: 'A simpler path from visit to review.',
          exact: true,
        }),
      ).toBeVisible();
      await expect(benefits).toContainText(
        'Customers share what happened in their own words—with Ai there to help.',
      );
      await expect(
        benefits.getByRole('list', { name: 'Ai Review features' }).locator('li'),
      ).toHaveText(featureLabels);
      const steps = benefits.locator('[data-review-benefit]');
      await expect(steps).toHaveCount(3);
      await expect(steps.locator('h3')).toHaveText([
        'Start with a scan',
        'Shape a personal draft',
        'Customer decides',
      ]);
      await expect(steps.locator('[data-benefit-description]')).toHaveText(stepDescriptions, {
        useInnerText: true,
      });
      await expect(benefits.getByText('Example draft', { exact: true }).first()).toBeVisible();
      await expect(
        benefits.getByText('Illustrative draft preview, not a customer result.', { exact: true }),
      ).toBeVisible();
      const photo = benefits.getByRole('img', {
        name: 'Two people talking across a local shop counter',
      });
      await expect(photo).toBeVisible();
      await expect
        .poll(() =>
          photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      await expect(benefits).not.toContainText(
        /10[×x]|review boost|guarantee|trusted by|customers served|reviews posted|posted successfully/i,
      );

      const geometry = await benefits.evaluate((element) => {
        const grid = element.querySelector<HTMLElement>('[data-benefits-grid]')!;
        const [content, media] = Array.from(grid.children) as HTMLElement[];
        const items = Array.from(element.querySelectorAll<HTMLElement>('[data-review-benefit]'));
        const sectionBox = element.getBoundingClientRect();
        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          content: content!.getBoundingClientRect().toJSON(),
          media: media!.getBoundingClientRect().toJSON(),
          items: items.map((item) => {
            const box = item.getBoundingClientRect();
            const description = item.querySelector<HTMLElement>('[data-benefit-description]')!;
            const descriptionBox = description.getBoundingClientRect();
            return {
              top: box.top,
              left: box.left,
              right: box.right,
              bottom: box.bottom,
              descriptionRight: descriptionBox.right,
            };
          }),
          sectionLeft: sectionBox.left,
          sectionRight: sectionBox.right,
          viewportWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          hasClippedText: items.some((item) =>
            Array.from(item.querySelectorAll<HTMLElement>('h3, [data-benefit-description]')).some(
              (text) => text.scrollWidth > text.clientWidth,
            ),
          ),
        };
      });
      expect(geometry.columns).toBe(viewport.width > 900 ? 2 : 1);
      expect(geometry.sectionLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.sectionRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.hasClippedText).toBe(false);
      if (viewport.width > 900) {
        expect(geometry.content.right).toBeLessThanOrEqual(geometry.media.left + 1);
      } else {
        expect(geometry.media.top).toBeGreaterThanOrEqual(geometry.content.bottom);
      }
      for (const [index, item] of geometry.items.entries()) {
        if (index > 0) expect(item.top).toBeGreaterThanOrEqual(geometry.items[index - 1]!.bottom);
        expect(item.descriptionRight).toBeLessThanOrEqual(item.right);
      }

      const signup = benefits.getByRole('link', { name: 'Create your free QR', exact: true });
      const howItWorks = benefits.getByRole('link', { name: 'See how it works', exact: true });
      await expect(signup).toHaveAttribute('href', '/signup');
      await expect(howItWorks).toHaveAttribute('href', '#how-it-works');
      expect((await signup.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await howItWorks.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await howItWorks.click();
      await expect(page).toHaveURL(/\/#how-it-works$/);
      await expect(page.locator('#how-it-works')).toBeInViewport();
      await signup.click();
      await expect(page).toHaveURL(/\/signup$/);
    }
  });

  test('lets visitors edit the clearly labeled example draft locally without generating or posting a review', async ({
    page,
  }) => {
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.method() !== 'HEAD') mutations.push(request.url());
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    const benefits = page.locator('#why-ai-review');
    const example = benefits.getByRole('textbox', { name: 'Edit the example review draft' });
    const edit = benefits.getByRole('button', { name: 'Edit the example draft', exact: true });
    await benefits.scrollIntoViewIfNeeded();
    await expect(example).toHaveValue('The team explained everything clearly.');
    await expect(example).toHaveAttribute('readonly', '');
    await expect(example).toHaveAttribute('tabindex', '-1');
    await expect(edit).toHaveAttribute('aria-pressed', 'false');
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(example).toBeFocused();
    await expect(example).not.toHaveAttribute('readonly');
    await expect(example).toHaveAttribute('tabindex', '0');
    await example.fill('My own words in this illustrative draft.');
    const done = benefits.getByRole('button', { name: 'Finish editing the example draft' });
    await done.click();
    await expect(edit).toHaveAttribute('aria-pressed', 'false');
    await expect(example).toHaveAttribute('readonly', '');
    await expect(example).toHaveValue('My own words in this illustrative draft.');
    await expect(benefits).toContainText('Illustrative draft preview, not a customer result.');
    expect(mutations).toEqual([]);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(example).toHaveValue('The team explained everything clearly.');
  });

  test('keeps the brand colors with open, understated columns for the three steps', async ({
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
    const cards = page.locator('#how-it-works [data-how-step]');
    await expect(cards).toHaveCount(3);
    expect(
      await cards.evaluateAll((elements) =>
        elements.map((card) => {
          const style = getComputedStyle(card);
          return {
            topBorder: style.borderTopWidth,
            topBorderColor: style.borderTopColor,
            sideBorder: style.borderLeftWidth,
            shadow: style.boxShadow,
            background: style.backgroundImage,
          };
        }),
      ),
    ).toEqual(
      ['rgb(169, 201, 247)', 'rgb(243, 194, 188)', 'rgb(188, 229, 201)'].map((color) => ({
        topBorder: '1px',
        topBorderColor: color,
        sideBorder: '0px',
        shadow: 'none',
        background: 'none',
      })),
    );
    expect(
      await cards.evaluateAll((elements) =>
        elements.map((card) => getComputedStyle(card).transform),
      ),
    ).toEqual(['none', 'none', 'none']);
    await expect(cards.locator('[aria-hidden="true"]')).toHaveCount(0);
  });

  test('loads three V5 explanation clips and automatically decodes changing native frames', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-how-video]')).toHaveCount(3);
    const assetPaths = new Set<string>();
    for (const step of HOW_STEPS) {
      const clip = page.locator(`[data-how-clip="${step.id}"]`);
      const video = clip.locator('video[data-how-video]');
      const base = `/marketing/how-it-works/${step.id}-v5`;
      const poster = `${base}-poster.webp`;
      await clip.scrollIntoViewIfNeeded();
      await expect(clip).toBeInViewport();
      await expect(clip.locator('button, [data-how-video-control]')).toHaveCount(0);
      await expect(video).toHaveAttribute('poster', poster);
      await expect(video).toHaveJSProperty('controls', false);
      await expect(video).not.toHaveAttribute('controls');
      await expect(video).toHaveJSProperty('muted', true);
      await expect(video).toHaveJSProperty('playsInline', true);
      await expect(video).toHaveJSProperty('loop', true);
      await expect(video).toHaveJSProperty('paused', false);
      await expect(video.locator('source')).toHaveCount(2);
      expect(
        await video.locator('source').evaluateAll((sources) =>
          sources.map((source) => ({
            src: source.getAttribute('src'),
            type: source.getAttribute('type'),
          })),
        ),
      ).toEqual([
        { src: `${base}.mp4`, type: 'video/mp4' },
        { src: `${base}.webm`, type: 'video/webm' },
      ]);
      for (const [path, type] of [
        [`${base}.mp4`, 'video/mp4'],
        [`${base}.webm`, 'video/webm'],
        [poster, 'image/webp'],
      ]) {
        assetPaths.add(path!);
        const response = await page.request.head(path!);
        expect(response.ok(), path).toBe(true);
        expect(response.headers()['content-type']).toContain(type);
        expect(Number(response.headers()['content-length'])).toBeGreaterThan(100);
      }
      const posterSize = await video.evaluate(
        (element: HTMLVideoElement) =>
          new Promise<{ width: number; height: number }>((resolve, reject) => {
            const image = new Image();
            image.onload = () =>
              resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => reject(new Error('Explanation poster could not decode'));
            image.src = element.poster;
          }),
      );
      expect(posterSize).toEqual({ width: 480, height: 900 });
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
        .toBeGreaterThanOrEqual(2);
      expect(
        await video.evaluate((element: HTMLVideoElement) => ({
          width: element.videoWidth,
          height: element.videoHeight,
          duration: element.duration,
        })),
      ).toEqual({ width: 480, height: 900, duration: expect.closeTo(9, 1) });
      const frame = await video.evaluate(
        (element: HTMLVideoElement) =>
          new Promise<{ width: number; height: number }>((resolve) => {
            element.requestVideoFrameCallback((_now, metadata) =>
              resolve({ width: metadata.width, height: metadata.height }),
            );
          }),
      );
      expect(frame).toEqual({ width: 480, height: 900 });
      const startedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
        .toBeGreaterThan(startedAt + 0.1);
      await page.locator('#pricing').scrollIntoViewIfNeeded();
      await expect(video).toHaveJSProperty('paused', true);
      const decodedFrames: string[] = [];
      for (const time of [0.4, 7.4]) {
        decodedFrames.push(
          await video.evaluate(
            (element: HTMLVideoElement, target) =>
              new Promise<string>((resolve) => {
                element.addEventListener(
                  'seeked',
                  () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 32;
                    canvas.height = 60;
                    const context = canvas.getContext('2d')!;
                    context.drawImage(element, 0, 0, canvas.width, canvas.height);
                    resolve(
                      Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data).join(
                        ',',
                      ),
                    );
                  },
                  { once: true },
                );
                element.currentTime = target;
              }),
            time,
          ),
        );
        expect(
          await video.evaluate((element: HTMLVideoElement) => element.currentTime),
        ).toBeCloseTo(time, 1);
      }
      expect(decodedFrames[0], `${step.id} should contain a changing explanation`).not.toBe(
        decodedFrames[1],
      );
      expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull();
      await expect(clip).toHaveAttribute('data-media-error', 'false');
    }
    expect(assetPaths.size).toBe(9);
  });

  test('automatically plays all four visible muted demo videos together without playback buttons', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 3600 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const videos = page.locator(DEMO_VIDEOS);
    await expect(videos).toHaveCount(4);
    await expect(page.locator('[data-how-video-control], [data-hero-video-control]')).toHaveCount(
      0,
    );
    await expect(page.locator('#review-journey [data-story-sound]')).toHaveCount(0);
    await expect
      .poll(() =>
        videos.evaluateAll((elements) =>
          elements.every((element) => !(element as HTMLVideoElement).paused),
        ),
      )
      .toBe(true);
    expect(
      await videos.evaluateAll((elements) =>
        elements.map((element) => {
          const video = element as HTMLVideoElement;
          return {
            muted: video.muted,
            loop: video.loop,
            inline: video.playsInline,
            controls: video.controls,
            buttons: video.parentElement!.querySelectorAll('button').length,
          };
        }),
      ),
    ).toEqual([
      ...Array.from({ length: 4 }, () => ({
        muted: true,
        loop: true,
        inline: true,
        controls: false,
        buttons: 0,
      })),
    ]);
    const startedAt = await videos.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLVideoElement).currentTime),
    );
    await expect
      .poll(() =>
        videos.evaluateAll(
          (elements, times) =>
            elements.every(
              (element, index) =>
                Math.abs((element as HTMLVideoElement).currentTime - times[index]!) > 0.1,
            ),
          startedAt,
        ),
      )
      .toBe(true);
    for (const video of await videos.all()) {
      await expect(video).toHaveAttribute('tabindex', '0');
      await video.focus();
      await expect(video).toBeFocused();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await page.keyboard.down('Space');
      await expect(video).toHaveJSProperty('paused', true);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        await page.keyboard.down('Space');
        const scrollAfterRepeat = await page.evaluate(
          () =>
            new Promise<number>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY))),
            ),
        );
        expect(scrollAfterRepeat).toBeCloseTo(scrollBefore, 1);
        await expect(video).toHaveJSProperty('paused', true);
      }
      await page.keyboard.up('Space');
      const pausedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
      const pausedAfterTwoFrames = await video.evaluate(
        (element: HTMLVideoElement) =>
          new Promise<number>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(element.currentTime))),
          ),
      );
      expect(pausedAfterTwoFrames).toBeCloseTo(pausedAt, 2);
      await page.keyboard.press('Enter');
      await expect(video).toHaveJSProperty('paused', false);
    }
  });

  test('pauses and resumes automatic clips with visibility and keeps all four demo previews static with reduced motion', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const journey = page.locator('#how-it-works');
    const clips = journey.locator('[data-how-video]');
    await journey.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        clips.evaluateAll((videos) => videos.every((video) => !(video as HTMLVideoElement).paused)),
      )
      .toBe(true);

    const manuallyPaused = journey.locator('[data-how-clip="scan"] video');
    await manuallyPaused.focus();
    await page.keyboard.press('Space');
    await expect(manuallyPaused).toHaveJSProperty('paused', true);
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await journey.scrollIntoViewIfNeeded();
    await expect(manuallyPaused).toHaveJSProperty('paused', true);
    await manuallyPaused.focus();
    await page.keyboard.press('Enter');
    await expect(manuallyPaused).toHaveJSProperty('paused', false);
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        clips.evaluateAll((videos) => videos.every((video) => (video as HTMLVideoElement).paused)),
      )
      .toBe(true);
    await journey.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        clips.evaluateAll((videos) => videos.every((video) => !(video as HTMLVideoElement).paused)),
      )
      .toBe(true);

    // Headless Chrome keeps all tabs "visible"; mock only this browser signal, not app state.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect
      .poll(() =>
        page
          .locator(DEMO_VIDEOS)
          .evaluateAll((videos) => videos.every((video) => (video as HTMLVideoElement).paused)),
      )
      .toBe(true);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect
      .poll(() =>
        clips.evaluateAll((videos) => videos.every((video) => !(video as HTMLVideoElement).paused)),
      )
      .toBe(true);

    await page.setViewportSize({ width: 1440, height: 3600 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const reducedVideos = page.locator(DEMO_VIDEOS);
    await expect(reducedVideos).toHaveCount(4);
    await expect
      .poll(() =>
        reducedVideos.evaluateAll((videos) =>
          videos.every((video) => (video as HTMLVideoElement).paused),
        ),
      )
      .toBe(true);
    await expect(
      page.locator('[data-how-clip] button, [data-hero-media] button, #review-journey button'),
    ).toHaveCount(0);
    expect(
      await reducedVideos.evaluateAll((elements) =>
        elements.every((element) => {
          const video = element as HTMLVideoElement;
          const style = getComputedStyle(video);
          return (
            !video.controls &&
            !!video.poster &&
            (style.visibility === 'hidden' || style.opacity === '0' || style.display === 'none') &&
            getComputedStyle(video.parentElement!).backgroundImage.includes(
              video.poster.split('/').at(-1)!,
            )
          );
        }),
      ),
    ).toBe(true);
    const frozen = await reducedVideos.evaluateAll((videos) =>
      videos.map((video) => (video as HTMLVideoElement).currentTime),
    );
    const afterTwoFrames = await reducedVideos.evaluateAll(
      (videos) =>
        new Promise<number[]>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(videos.map((video) => (video as HTMLVideoElement).currentTime)),
            ),
          ),
        ),
    );
    expect(afterTwoFrames).toEqual(frozen);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect
      .poll(() =>
        reducedVideos.evaluateAll((videos) =>
          videos.every((video) => !(video as HTMLVideoElement).paused),
        ),
      )
      .toBe(true);
  });

  test('automatically falls back to explanation WebM and retries failed media after returning to view', async ({
    page,
  }) => {
    const mp4 = '**/marketing/how-it-works/publish-v5.mp4';
    const allSources = /\/marketing\/how-it-works\/publish-v5\.(?:mp4|webm)(?:\?.*)?$/;
    await page.route(mp4, (route) => route.abort('failed'));
    await page.goto('/', { waitUntil: 'networkidle' });
    let clip = page.locator('[data-how-clip="publish"]');
    let video = clip.locator('[data-how-video]');
    await clip.scrollIntoViewIfNeeded();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentSrc))
      .toContain('/publish-v5.webm');
    await expect(video).toHaveJSProperty('paused', false);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    expect(
      await video.evaluate((element: HTMLVideoElement) => ({
        width: element.videoWidth,
        height: element.videoHeight,
      })),
    ).toEqual({ width: 480, height: 900 });
    await expect(clip).toHaveAttribute('data-media-error', 'false');
    await page.unroute(mp4);
    await page.route(allSources, (route) => route.abort('failed'));
    await page.goto('/', { waitUntil: 'networkidle' });
    clip = page.locator('[data-how-clip="publish"]');
    video = clip.locator('[data-how-video]');
    await clip.scrollIntoViewIfNeeded();
    await expect(clip).toHaveAttribute('data-media-error', 'true');
    await expect(video).toBeHidden();
    await expect(clip.locator('button, [data-how-video-control]')).toHaveCount(0);
    await expect(clip.getByRole('status')).toContainText(/preview/i);
    expect(await clip.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain(
      '/marketing/how-it-works/publish-v5-poster.webp',
    );
    await page.unroute(allSources);
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await clip.scrollIntoViewIfNeeded();
    await expect(clip).toHaveAttribute('data-media-error', 'false');
    await expect(video).toBeVisible();
    await expect(video).toHaveJSProperty('paused', false);
    const restartedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(restartedAt + 0.1);
  });

  test('keeps three compact steps with short captions and complete centered phones readable in the responsive layout', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const grid = page.locator('[data-how-grid]');
      await expect(grid.locator('[data-how-step]')).toHaveCount(3);
      await expect(grid.locator('[data-how-step-caption]')).toHaveText(
        HOW_STEPS.map((step) => step.caption),
      );
      const geometry = await grid.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const cards = Array.from(element.querySelectorAll<HTMLElement>('[data-how-step]'));
        const inside = (child: DOMRect, parent: DOMRect) =>
          child.left >= parent.left - 0.5 &&
          child.right <= parent.right + 0.5 &&
          child.top >= parent.top - 0.5 &&
          child.bottom <= parent.bottom + 0.5;
        return {
          left: rect.left,
          right: rect.right,
          viewport: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
          tops: cards.map(
            (card) =>
              card.getBoundingClientRect().top -
              new DOMMatrix(getComputedStyle(card).transform).m42,
          ),
          cards: cards.map((card) => {
            const cardBox = card.getBoundingClientRect();
            const translation = new DOMMatrix(getComputedStyle(card).transform).m42;
            const layoutCardBox = new DOMRect(
              cardBox.left,
              cardBox.top - translation,
              cardBox.width,
              cardBox.height,
            );
            const title = card.querySelector<HTMLElement>('[data-how-step-title]')!;
            const caption = card.querySelector<HTMLElement>('[data-how-step-caption]')!;
            const copy = title.parentElement!;
            const copyBox = copy.getBoundingClientRect();
            const captionBox = caption.getBoundingClientRect();
            const figure = card.querySelector<HTMLElement>('[data-how-clip]')!;
            const video = figure.querySelector<HTMLVideoElement>('video')!;
            const figureBox = figure.getBoundingClientRect();
            const titleStyle = getComputedStyle(title);
            const cardStyle = getComputedStyle(card);
            const contentWidth =
              card.clientWidth -
              Number.parseFloat(cardStyle.paddingLeft) -
              Number.parseFloat(cardStyle.paddingRight);
            const expectedMediaWidth = Math.min(
              window.innerWidth <= 820 ? contentWidth : contentWidth - 32,
              window.innerWidth <= 360
                ? 136
                : window.innerWidth <= 600
                  ? Math.min(150, Math.max(112, window.innerWidth * 0.35))
                  : window.innerWidth <= 680
                    ? 132
                    : window.innerWidth <= 820
                      ? 210
                      : Math.min(
                          284,
                          Math.max(
                            170,
                            window.innerHeight * 0.5 -
                              194 +
                              Math.max(0, window.innerWidth * 0.1 - 144),
                          ),
                        ),
            );
            return {
              cardInside: inside(layoutCardBox, rect),
              translation,
              allContentInside: [copy, title, caption, figure].every((child) =>
                inside(child.getBoundingClientRect(), cardBox),
              ),
              noTextOverflow: [title, caption].every(
                (element) => element.scrollWidth <= element.clientWidth,
              ),
              textAlignmentMatchesLayout: [title, caption].every(
                (element) =>
                  getComputedStyle(element).textAlign ===
                  (window.innerWidth <= 360 || window.innerWidth > 600 ? 'center' : 'left'),
              ),
              captionBelowCopy: captionBox.top >= copyBox.bottom,
              figurePlacementMatchesLayout:
                window.innerWidth <= 360
                  ? figureBox.top - captionBox.bottom >= 13.5
                  : window.innerWidth <= 600
                    ? figureBox.left >= Math.max(copyBox.right, captionBox.right)
                    : figureBox.top - captionBox.bottom >= 13.5,
              videoInside: inside(video.getBoundingClientRect(), figureBox),
              objectFit: getComputedStyle(video).objectFit,
              posterSize: getComputedStyle(figure).backgroundSize,
              controlCount: figure.querySelectorAll('button, [data-how-video-control]').length,
              figureAspect: figureBox.width / figureBox.height,
              mediaMatchesCompactSlot: Math.abs(figureBox.width - expectedMediaWidth) <= 1,
              mediaCentered:
                window.innerWidth > 360 && window.innerWidth <= 600
                  ? Math.abs(
                      figureBox.top + figureBox.height / 2 - (cardBox.top + cardBox.height / 2),
                    ) <= 0.5
                  : Math.abs(
                      figureBox.left + figureBox.width / 2 - (cardBox.left + cardBox.width / 2),
                    ) <= 0.5,
              titleSize: Number.parseFloat(titleStyle.fontSize),
              titleWeight: Number.parseInt(titleStyle.fontWeight, 10),
              titleSingleLine:
                title.getBoundingClientRect().height <=
                Number.parseFloat(titleStyle.fontSize) * 1.31,
              titleLeading:
                Number.parseFloat(titleStyle.lineHeight) / Number.parseFloat(titleStyle.fontSize),
            };
          }),
        };
      });
      const columns = viewport.width <= 680 ? 1 : 3;
      expect(geometry.columns).toBe(columns);
      expect(new Set(geometry.tops.map((top) => Math.round(top))).size).toBe(3 / columns);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
      for (const card of geometry.cards) {
        expect(card.translation).toBe(0);
        expect(card.cardInside).toBe(true);
        expect(card.allContentInside).toBe(true);
        expect(card.noTextOverflow).toBe(true);
        expect(card.textAlignmentMatchesLayout).toBe(true);
        expect(card.captionBelowCopy).toBe(true);
        expect(card.figurePlacementMatchesLayout).toBe(true);
        expect(card.videoInside).toBe(true);
        expect(card.objectFit).toBe('contain');
        expect(card.posterSize).toBe('contain');
        expect(card.controlCount).toBe(0);
        expect(card.figureAspect).toBeCloseTo(8 / 15, 2);
        expect(card.mediaMatchesCompactSlot).toBe(true);
        expect(card.mediaCentered).toBe(true);
        expect(card.titleSize).toBe(20);
        expect(card.titleWeight).toBe(700);
        expect(card.titleSingleLine).toBe(true);
        expect(card.titleLeading).toBeCloseTo(1.3, 2);
      }
    }
  });

  test('fits the entire three-step section below desktop navigation at 100 percent zoom', async ({
    page,
  }, testInfo) => {
    for (const viewport of [
      { width: 1366, height: 649 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page
        .getByRole('banner')
        .getByRole('link', { name: 'How it works', exact: true })
        .click();
      await expect(page).toHaveURL(/\/#how-it-works$/);
      const section = page.locator('#how-it-works');
      await expect
        .poll(() =>
          section.evaluate((element) => {
            const expectedTop = Number.parseFloat(getComputedStyle(element).scrollMarginTop);
            return Math.abs(element.getBoundingClientRect().top - expectedTop);
          }),
        )
        .toBeLessThanOrEqual(1);
      const fit = await section.evaluate((element) => {
        const header = document.querySelector<HTMLElement>(
          '[role="banner"], body > header, header',
        )!;
        const headerBottom = header.getBoundingClientRect().bottom;
        const rect = element.getBoundingClientRect();
        const fullyVisible = (target: Element) => {
          const box = target.getBoundingClientRect();
          return (
            box.top >= headerBottom - 0.5 &&
            box.bottom <= window.innerHeight + 0.5 &&
            box.left >= -0.5 &&
            box.right <= document.documentElement.clientWidth + 0.5
          );
        };
        const cards = Array.from(element.querySelectorAll('[data-how-step]'));
        const media = Array.from(element.querySelectorAll('[data-how-clip]'));
        return {
          scale: window.visualViewport?.scale,
          zoom: getComputedStyle(document.documentElement).zoom,
          viewportWidth: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          sectionFullyVisible: fullyVisible(element),
          headingFullyVisible: fullyVisible(element.querySelector('h2')!),
          introFullyVisible: fullyVisible(element.querySelector('[data-how-intro]')!),
          cardCount: cards.length,
          mediaCount: media.length,
          allCardsFullyVisible: cards.every(fullyVisible),
          allMediaFullyVisible: media.every(fullyVisible),
          sectionHeight: rect.height,
          availableHeight: window.innerHeight - rect.top,
        };
      });
      expect(fit.scale).toBe(1);
      expect(fit.zoom).toBe('1');
      expect(fit.viewportWidth).toBe(viewport.width);
      expect(fit.pageWidth).toBeLessThanOrEqual(viewport.width);
      expect(fit.cardCount).toBe(3);
      expect(fit.mediaCount).toBe(3);
      expect(fit.sectionFullyVisible).toBe(true);
      expect(fit.headingFullyVisible).toBe(true);
      expect(fit.introFullyVisible).toBe(true);
      expect(fit.allCardsFullyVisible).toBe(true);
      expect(fit.allMediaFullyVisible).toBe(true);
      expect(fit.sectionHeight).toBeLessThanOrEqual(fit.availableHeight + 0.5);
      await page.screenshot({
        path: testInfo.outputPath(`how-fit-${viewport.width}x${viewport.height}.png`),
      });
    }
  });

  test('loads the real hero walkthrough video with captions and no demo footer', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const hero = page.locator('#home');
    const media = hero.locator('[data-hero-media="video"]');
    const video = media.locator('video[data-hero-video]');

    await expect(media).toHaveCount(1);
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAccessibleName('Animated review walkthrough');
    await expect(video).toHaveAccessibleDescription(
      /^A friendly Ai robot illustrates the review journey:.*The customer opens Google, pastes the review and posts it themselves.*does not post a real Google review automatically/i,
    );
    const caption = media.locator('figcaption');
    await expect(caption).toHaveCount(1);
    await expect(caption).toContainText('A friendly Ai robot illustrates the review journey:');
    await expect(video).toHaveAttribute('aria-describedby', (await caption.getAttribute('id'))!);
    await expect(video).toHaveAttribute(
      'poster',
      '/marketing/hero-review-walkthrough-v3-poster.png',
    );
    await expect(video).toHaveJSProperty('muted', true);
    await expect(video).toHaveJSProperty('playsInline', true);
    await expect(video).toHaveJSProperty('loop', true);
    await expect(video.locator('source')).toHaveCount(2);
    expect(
      await video
        .locator('source')
        .evaluateAll((sources) => sources.map((source) => source.getAttribute('src'))),
    ).toEqual([
      '/marketing/hero-review-walkthrough-v3.mp4',
      '/marketing/hero-review-walkthrough-v3.webm',
    ]);
    expect(
      await video
        .locator('source')
        .evaluateAll((sources) => sources.map((source) => source.getAttribute('type'))),
    ).toEqual(['video/mp4', 'video/webm']);
    await expect(video.locator('track[kind="captions"]')).toHaveAttribute(
      'src',
      '/marketing/hero-review-walkthrough-v3.vtt',
    );
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(1);
    expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(960);
    expect(await video.evaluate((element: HTMLVideoElement) => element.videoHeight)).toBe(960);
    expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBeCloseTo(
      30,
      0,
    );
    expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull();
    expect((await page.request.get('/marketing/hero-review-walkthrough-v3-poster.png')).ok()).toBe(
      true,
    );
    expect((await page.request.get('/marketing/hero-review-walkthrough-v3.vtt')).ok()).toBe(true);

    await expect(hero.locator('[data-hero-media="image"]')).toHaveCount(0);
    await expect(hero.locator('[data-review-stars="hero"]')).toHaveCount(0);
    await expect(media.locator('[data-hero-flow-step],[data-hero-trust-line]')).toHaveCount(0);
    await expect(hero.locator('[data-hero-qr]')).toHaveCount(0);
    await expect(hero.getByRole('link', { name: 'Open live demo', exact: true })).toHaveCount(0);
    await expect(page.locator('main video')).toHaveCount(5);
    await expect(page.locator('#review-journey video')).toHaveCount(0);
  });

  test('automatically decodes the six-step hero with keyboard pause and static reduced motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const media = page.locator('#home [data-hero-media="video"]');
    const video = media.locator('video[data-hero-video]');
    await media.scrollIntoViewIfNeeded();
    await expect(video).toHaveJSProperty('paused', false);
    await expect(media.locator('button, [data-hero-video-control]')).toHaveCount(0);
    await expect(video).toHaveAttribute('tabindex', '0');
    await expect(video).toHaveJSProperty('controls', false);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    const frame = await video.evaluate(
      (element: HTMLVideoElement) =>
        new Promise<{ mediaTime: number; frames: number }>((resolve) => {
          element.requestVideoFrameCallback((_now, metadata) =>
            resolve({ mediaTime: metadata.mediaTime, frames: metadata.presentedFrames }),
          );
        }),
    );
    expect(frame.frames).toBeGreaterThan(0);
    const startedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(startedAt + 0.1);

    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(video).toHaveJSProperty('paused', true);
    await media.scrollIntoViewIfNeeded();
    await expect(video).toHaveJSProperty('paused', false);
    await video.focus();
    await expect(video).toBeFocused();
    await page.keyboard.press('Space');
    await expect(video).toHaveJSProperty('paused', true);
    const pausedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await media.scrollIntoViewIfNeeded();
    await expect(video).toHaveJSProperty('paused', true);
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
      pausedAt,
      1,
    );
    await video.focus();
    await page.keyboard.press('Enter');
    await expect(video).toHaveJSProperty('paused', false);
    await page.keyboard.press('Space');
    await expect(video).toHaveJSProperty('paused', true);

    for (const chapter of [
      { time: 0.2, step: 'scan' },
      { time: 5.2, step: 'generate' },
      { time: 10.2, step: 'shuffle' },
      { time: 15.2, step: 'copy' },
      { time: 19.2, step: 'post' },
      { time: 25.2, step: 'celebrate' },
    ]) {
      await video.evaluate(
        (element: HTMLVideoElement, time) =>
          new Promise<void>((resolve) => {
            element.addEventListener('seeked', () => resolve(), { once: true });
            element.currentTime = time;
          }),
        chapter.time,
      );
      await expect(media).toHaveAttribute('data-active-step', chapter.step);
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
        .toBeGreaterThanOrEqual(2);
      expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
        chapter.time,
        1,
      );
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'networkidle' });
    const reducedMedia = page.locator('#home [data-hero-media="video"]');
    const reducedVideo = reducedMedia.locator('video[data-hero-video]');
    await reducedMedia.scrollIntoViewIfNeeded();
    await expect(reducedVideo).toHaveJSProperty('paused', true);
    await expect(reducedVideo).toBeHidden();
    await expect(reducedMedia.locator('button, [data-hero-video-control]')).toHaveCount(0);
    expect(
      await reducedMedia.evaluate((element) => getComputedStyle(element).backgroundImage),
    ).toContain('hero-review-walkthrough-v3-poster.png');
  });

  test('decodes the WebM fallback when the hero MP4 cannot load', async ({ page }) => {
    await page.route('**/marketing/hero-review-walkthrough-v3.mp4', (route) =>
      route.abort('failed'),
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const media = page.locator('#home [data-hero-media="video"]');
    const video = media.locator('video[data-hero-video]');
    await media.scrollIntoViewIfNeeded();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentSrc))
      .toContain('/marketing/hero-review-walkthrough-v3.webm');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(960);
    expect(await video.evaluate((element: HTMLVideoElement) => element.videoHeight)).toBe(960);
    expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull();
    await expect(media).toHaveAttribute('data-media-error', 'false');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(false);
    const startedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(startedAt + 0.1);
  });

  test('keeps the hero poster and automatically retries failed sources on a fresh viewport return', async ({
    page,
  }) => {
    const sources = [
      '**/marketing/hero-review-walkthrough-v3.mp4',
      '**/marketing/hero-review-walkthrough-v3.webm',
    ];
    for (const source of sources) await page.route(source, (route) => route.abort('failed'));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const media = page.locator('#home [data-hero-media="video"]');
    const video = media.locator('video[data-hero-video]');
    await media.scrollIntoViewIfNeeded();
    await expect(media).toHaveAttribute('data-media-error', 'true');
    await expect(media).toBeVisible();
    await expect(video).toBeHidden();
    expect(await media.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain(
      'hero-review-walkthrough-v3-poster.png',
    );
    await expect(media.locator('button, [data-hero-video-control]')).toHaveCount(0);

    for (const source of sources) await page.unroute(source);
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await media.scrollIntoViewIfNeeded();
    await expect(media).toHaveAttribute('data-media-error', 'false');
    await expect(video).toBeVisible();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(false);
    const restartedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(restartedAt + 0.1);
  });

  test('keeps the unverified promotional story off the homepage without stale navigation', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.locator('#review-journey, [data-story-media], [data-story-video]'),
    ).toHaveCount(0);
    await expect(page.locator('a[href$="#review-journey"]')).toHaveCount(0);
    await expect(page.locator('main video')).toHaveCount(5);
    await expect(page.locator('[data-hero-video]')).toHaveCount(1);
    await expect(page.locator('[data-how-video]')).toHaveCount(3);
    await expect(page.locator('[data-promo-video]')).toHaveCount(1);
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
        if (viewport.width <= 600) await revealMarketingNavigation(page);
        await expect(signIn).toBeVisible();
        expect((await signIn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        if (viewport.width <= 600) await page.keyboard.press('Escape');

        const hero = page.locator('#home');
        const heroMedia = hero.locator('[data-hero-media="video"]');
        const heroVideo = heroMedia.locator('video[data-hero-video]');
        const heroAction = hero.getByRole('link', { name: 'Create your free QR' });
        await expect(hero.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(heroMedia).toBeVisible();
        await expect(heroVideo).toBeVisible();
        await expect
          .poll(() => heroVideo.evaluate((element: HTMLVideoElement) => element.readyState))
          .toBeGreaterThanOrEqual(1);
        await expect(heroAction).toBeVisible();
        await expect(hero.locator('[data-hero-qr]')).toHaveCount(0);
        await expect(hero.getByRole('link', { name: 'Open live demo', exact: true })).toHaveCount(
          0,
        );
        await expect(hero.locator('[data-hero-flow-step]')).toHaveCount(5);
        await expect(hero.locator('[data-hero-trust-line]')).toHaveCount(0);
        expect((await heroAction.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(
          await hero.evaluate((section, viewportWidth) => {
            const copy = section.querySelector<HTMLElement>('[data-hero-message]')!;
            const frame = section.querySelector<HTMLElement>('[data-hero-visual]')!;
            const media = section.querySelector<HTMLElement>('[data-hero-media="video"]')!;
            const video = media.querySelector<HTMLVideoElement>('video')!;
            const action = Array.from(section.querySelectorAll<HTMLAnchorElement>('a')).find(
              (link) => link.textContent?.includes('Create your free QR'),
            )!;
            const sectionBox = section.getBoundingClientRect();
            const copyBox = copy.getBoundingClientRect();
            const frameBox = frame.getBoundingClientRect();
            const mediaBox = media.getBoundingClientRect();
            const videoBox = video.getBoundingClientRect();
            const actionBox = action.getBoundingClientRect();
            const flowBox = section
              .querySelector<HTMLElement>('[data-hero-flow]')!
              .getBoundingClientRect();

            return {
              mediaInsideFrame:
                mediaBox.left >= frameBox.left &&
                mediaBox.right <= frameBox.right &&
                mediaBox.top >= frameBox.top &&
                mediaBox.bottom <= frameBox.bottom,
              videoFillsMediaContent:
                Math.abs(videoBox.left - mediaBox.left) <= 1 &&
                Math.abs(videoBox.right - mediaBox.right) <= 1 &&
                Math.abs(videoBox.top - mediaBox.top) <= 1 &&
                Math.abs(videoBox.bottom - mediaBox.bottom) <= 1,
              mediaHasSize: mediaBox.width > 0 && mediaBox.height > 0,
              videoHasMetadata:
                video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0,
              objectFit: getComputedStyle(video).objectFit,
              mediaOverflow: getComputedStyle(media).overflow,
              controlCount: media.querySelectorAll('button, [data-hero-video-control]').length,
              actionInsideViewport: actionBox.left >= 0 && actionBox.right <= viewportWidth,
              sectionContainsChildren:
                sectionBox.bottom >= Math.max(copyBox.bottom, frameBox.bottom, flowBox.bottom),
              layoutOrder:
                viewportWidth <= 600
                  ? actionBox.bottom <= flowBox.top && flowBox.bottom <= frameBox.top
                  : viewportWidth > 820
                    ? copyBox.right <= frameBox.left
                    : copyBox.bottom <= frameBox.top,
              desktopCenterAlignment:
                viewportWidth <= 820 ||
                Math.abs(copyBox.top + copyBox.height / 2 - (frameBox.top + frameBox.height / 2)) <=
                  1,
              squareFrame: Math.abs(mediaBox.width - mediaBox.height) <= 1,
              mediaShadow: getComputedStyle(media).boxShadow,
            };
          }, viewport.width),
        ).toEqual({
          mediaInsideFrame: true,
          videoFillsMediaContent: true,
          mediaHasSize: true,
          videoHasMetadata: true,
          objectFit: 'contain',
          mediaOverflow: 'hidden',
          controlCount: 0,
          actionInsideViewport: true,
          sectionContainsChildren: true,
          layoutOrder: true,
          desktopCenterAlignment: true,
          squareFrame: true,
          mediaShadow: 'none',
        });

        for (const item of NAVIGATION.slice(1)) {
          await revealMarketingNavigation(page);
          const navLink = page
            .locator('#marketing-navigation')
            .getByRole('link', { name: item.label, exact: true, includeHidden: true });
          expect((await navLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await navLink.click();
          await expect(page).toHaveURL(new RegExp(`/#${item.target}$`));
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

  test('removes the demo QR card and live-demo link while keeping the hero video at every size', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      const hero = page.locator('#home');
      await expect(page.locator('[data-hero-qr]')).toHaveCount(0);
      await expect(page.locator('figure[aria-label^="QR card"]')).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Live review demo', exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole('link', { name: 'Open live demo', exact: true })).toHaveCount(0);
      await expect(hero.locator('[data-qr-card-part]')).toHaveCount(0);
      const media = hero.locator('[data-hero-media="video"]');
      const video = media.locator('video[data-hero-video]');
      await expect(media).toBeVisible();
      await expect(video).toHaveCount(1);
      await expect(video).toBeHidden();
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
        .toBe(true);
      expect(
        await media.evaluate((element) => getComputedStyle(element).backgroundImage),
      ).toContain('/marketing/hero-review-walkthrough-v3-poster.png');
      await expect(
        hero.getByRole('link', { name: 'Create your free QR', exact: true }),
      ).toHaveAttribute('href', '/signup');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
  });
});
