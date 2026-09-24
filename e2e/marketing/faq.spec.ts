import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';

// Browser plugin not available. These read-only homepage checks use the repository's
// installed Chrome/Playwright workflow and never exercise database-backed actions.
const FAQ_ITEMS = [
  { id: 'qr', question: 'How do I get started with my QR?', image: 'qr-counter-scene-v1.webp' },
  { id: 'edit', question: 'Can customers edit the Ai review?', image: 'edit-review.webp' },
  {
    id: 'google',
    question: 'Does it post reviews to Google automatically?',
    image: 'google-handoff.webp',
  },
  {
    id: 'location',
    question: 'Can I change my Google Maps location later?',
    image: 'change-location.webp',
  },
  { id: 'plans', question: 'What is included in Free and Pro?', image: 'plans.webp' },
  {
    id: 'no-app',
    question: 'Do customers need to download an app?',
    image: 'edit-review.webp',
  },
] as const;

async function openFaq(page: Page, viewport = { width: 1280, height: 900 }) {
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
  await expect(page.getByRole('heading', { level: 1, name: 'Review Ai likh dega' })).toBeVisible();
  await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);

  const faq = page.locator('#faq[data-marketing-faq]');
  await expect(faq).toBeVisible();
  // A real scroll ends initial-page LCP measurement before inspecting these below-fold images.
  await page.mouse.wheel(0, (await faq.boundingBox())!.y);
  await faq.scrollIntoViewIfNeeded();
  return { faq, runtimeProblems };
}

async function expectOpenQuestion(faq: Locator, activeId: string | null) {
  for (const item of FAQ_ITEMS) {
    const isOpen = item.id === activeId;
    const question = faq.getByRole('button', { name: item.question, exact: true });
    const answer = faq.locator(`#faq-answer-${item.id}`);
    await expect(question).toHaveAttribute('id', `faq-question-${item.id}`);
    await expect(question).toHaveAttribute('aria-controls', `faq-answer-${item.id}`);
    await expect(question).toHaveAttribute('aria-expanded', String(isOpen));
    await expect(answer).toHaveAttribute('role', 'region');
    await expect(answer).toHaveAttribute('aria-labelledby', `faq-question-${item.id}`);
    await expect(answer).toHaveAttribute('aria-hidden', String(!isOpen));
    await expect(answer).toHaveJSProperty('inert', !isOpen);
    if (isOpen) {
      await expect(answer).toBeVisible();
      await expect(answer).not.toHaveText('');
      if (item.id === 'no-app') {
        await expect(answer.locator('p')).toHaveText(
          'No app or Ai Review account is needed. Customers scan your QR with their phone camera and open the review page in their browser. They only need to sign in to Google when they choose to post.',
        );
      }
    } else {
      await expect(answer).toBeHidden();
    }
  }
  await expect(faq.locator('button[aria-expanded="true"]')).toHaveCount(activeId ? 1 : 0);
  await expect(faq.getByRole('region')).toHaveCount(activeId ? 1 : 0);
}

async function expectImageLoaded(image: Locator, item: (typeof FAQ_ITEMS)[number]) {
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('alt', /\S/);
  const isPhone = image.page().viewportSize()!.width <= 600;
  await expect(image).toHaveCSS('object-fit', item.id === 'qr' && !isPhone ? 'cover' : 'contain');
  await expect(image).toHaveAttribute(
    'alt',
    item.id === 'qr' ? 'Illustrative QR counter display' : /^Example product screen: /,
  );
  const figure = image.locator('xpath=ancestor::figure');
  await expect(figure).toHaveAttribute('data-faq-preview-for', item.id);
  await expect(image).toHaveAttribute('src', `/marketing/faq/${item.image}`);
  const fullScreenshot = figure.getByRole('link', {
    name:
      item.id === 'qr'
        ? 'View illustrative QR counter display'
        : `View full screenshot: ${item.question}`,
    exact: true,
  });
  await expect(fullScreenshot).toHaveAttribute('href', `/marketing/faq/${item.image}`);
  await expect(fullScreenshot).toHaveAttribute('target', '_blank');
  await expect(fullScreenshot).toHaveAttribute('rel', 'noopener noreferrer');
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => ({
        complete: element.complete,
        width: element.naturalWidth,
        height: element.naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: expect.any(Number), height: expect.any(Number) });
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(
    0,
  );
  expect(
    await image.evaluate((element: HTMLImageElement) => element.naturalHeight),
  ).toBeGreaterThan(0);
}

async function expectNoOverflow(page: Page, faq: Locator) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  for (const element of await faq
    .locator('h2, button, [role="region"]:visible, img:visible')
    .all()) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
}

async function expectBalancedColumns(faq: Locator) {
  const columns = await faq.evaluate((section) => {
    const firstQuestion = section.querySelector('button[aria-controls]')!;
    const questions = firstQuestion.closest('h3')!.parentElement!.parentElement!;
    const preview = Array.from(section.querySelectorAll('[data-faq-preview]')).at(-1)!;
    const left = questions.getBoundingClientRect();
    const right = preview.getBoundingClientRect();
    return {
      leftHeight: left.height,
      rightHeight: right.height,
      topDelta: Math.abs(left.top - right.top),
      bottomDelta: Math.abs(left.bottom - right.bottom),
    };
  });
  expect(columns.topDelta).toBeLessThanOrEqual(1);
  expect(columns.bottomDelta).toBeLessThanOrEqual(columns.rightHeight * 0.1);
  return columns;
}

async function captureFaq(faq: Locator, filename: string) {
  if (process.env.FAQ_SCREENSHOT_DIR) {
    const page = faq.page();
    const viewport = page.viewportSize()!;
    // Fit the whole section into a capture canvas, preserving the tested responsive width.
    await page.setViewportSize({
      width: viewport.width,
      height: Math.max(viewport.height, Math.ceil((await faq.boundingBox())!.height) + 160),
    });
    try {
      await faq.evaluate((section) =>
        section.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
      await faq.screenshot({
        path: path.join(process.env.FAQ_SCREENSHOT_DIR, filename),
        animations: 'disabled',
        // Keep a viewport-fixed header/dev indicator out of a section-height evidence capture.
        style:
          'header:has(a[aria-label="Ai Review home"]), nextjs-portal { visibility: hidden !important; }',
      });
    } finally {
      await page.setViewportSize(viewport);
    }
  }
}

test.describe('homepage FAQ', () => {
  test('follows the review-growth band with six accessible questions and the first answer open', async ({
    page,
  }) => {
    const { faq, runtimeProblems } = await openFaq(page);
    await expect(faq).toHaveAttribute('aria-labelledby', 'faq-title');
    await expect(faq.locator('#faq-title')).toBeVisible();
    await expect(faq.locator('figcaption')).toHaveCount(0);
    await expect(faq.getByText('Product screenshot · Example data', { exact: true })).toHaveCount(
      0,
    );
    await expect(faq.getByText('View full screenshot', { exact: true })).toHaveCount(0);
    await expect(faq.getByRole('button')).toHaveText(FAQ_ITEMS.map((item) => item.question));
    expect(
      await faq.evaluate((section) => ({
        immediatelyAfterGrowth: section.previousElementSibling?.id === 'review-growth',
        beforeFooter: Boolean(
          section.compareDocumentPosition(document.querySelector('footer')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      })),
    ).toEqual({ immediatelyAfterGrowth: true, beforeFooter: true });
    await expectOpenQuestion(faq, 'qr');

    const preview = faq.locator('[data-faq-preview]').last();
    const image = preview.locator('img[data-faq-screenshot]');
    await expect(preview).toBeVisible();
    await expectImageLoaded(image, FAQ_ITEMS[0]);
    expect((await preview.boundingBox())!.x).toBeGreaterThanOrEqual(
      (await faq.getByRole('button').first().boundingBox())!.x +
        (await faq.getByRole('button').first().boundingBox())!.width,
    );
    await expect(faq.locator('[role="region"] img:visible')).toHaveCount(0);
    await expectBalancedColumns(faq);
    await expectNoOverflow(page, faq);
    await captureFaq(faq, 'faq-final-desktop.png');
    expect(runtimeProblems).toEqual([]);
  });

  test('changes the answer and real preview for every question and supports Enter, Space and collapse', async ({
    page,
  }) => {
    const { faq, runtimeProblems } = await openFaq(page);
    const preview = faq.locator('[data-faq-preview]').last();
    const image = preview.locator('img[data-faq-screenshot]');
    const sources = new Set<string>();
    let initialFrameSize: { width: number; height: number } | undefined;
    for (const item of FAQ_ITEMS) {
      const question = faq.getByRole('button', { name: item.question, exact: true });
      if (item.id !== 'qr') await question.click();
      await expectOpenQuestion(faq, item.id);
      await expectImageLoaded(image, item);
      await expectBalancedColumns(faq);
      const frame = (await preview.boundingBox())!;
      const frameSize = { width: frame.width, height: frame.height };
      initialFrameSize ??= frameSize;
      expect(frameSize).toEqual(initialFrameSize);
      sources.add(await image.evaluate((element: HTMLImageElement) => element.currentSrc));
      await captureFaq(faq, `faq-final-desktop-${item.id}.png`);
    }
    expect(sources.size).toBe(new Set(FAQ_ITEMS.map((item) => item.image)).size);

    const lastItem = FAQ_ITEMS.at(-1)!;
    const lastQuestion = faq.getByRole('button', { name: lastItem.question, exact: true });
    await lastQuestion.click();
    await expectOpenQuestion(faq, null);
    await expect(lastQuestion).toBeFocused();
    await page.keyboard.press('Enter');
    await expectOpenQuestion(faq, lastItem.id);
    await expect(lastQuestion).toBeFocused();
    await page.keyboard.press('Space');
    await expectOpenQuestion(faq, null);

    const firstQuestion = faq.getByRole('button', { name: FAQ_ITEMS[0].question, exact: true });
    await firstQuestion.focus();
    await page.keyboard.press('Enter');
    await expectOpenQuestion(faq, 'qr');
    await page.keyboard.press('Tab');
    const secondQuestion = faq.getByRole('button', { name: FAQ_ITEMS[1].question, exact: true });
    await expect(secondQuestion).toBeFocused();
    await page.keyboard.press('Space');
    await expectOpenQuestion(faq, 'edit');
    await expect(secondQuestion).toBeFocused();
    await expectImageLoaded(image, FAQ_ITEMS[1]);
    expect(runtimeProblems).toEqual([]);
  });

  test('animates answer changes and removes motion when the user prefers reduced motion', async ({
    page,
  }) => {
    const { faq, runtimeProblems } = await openFaq(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const answer = faq.locator('#faq-answer-edit');
    const question = faq.getByRole('button', { name: FAQ_ITEMS[1].question, exact: true });
    const [transitionStarted] = await Promise.all([
      answer.evaluate(
        (element) =>
          new Promise<boolean>((resolve) => {
            const finish = (started: boolean) => {
              element.removeEventListener('transitionrun', onTransition);
              clearTimeout(timeout);
              resolve(started);
            };
            const onTransition = (event: Event) => {
              if ((event as TransitionEvent).propertyName === 'grid-template-rows') finish(true);
            };
            const timeout = setTimeout(() => finish(false), 2_000);
            element.addEventListener('transitionrun', onTransition);
          }),
      ),
      question.click(),
    ]);
    expect(transitionStarted).toBe(true);
    await expectOpenQuestion(faq, 'edit');
    const frame = faq.locator('[data-faq-preview]').last().locator('a').locator('..');
    expect(await frame.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
      'none',
    );
    await expect.poll(() => answer.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expectNoOverflow(page, faq);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(answer).toHaveCSS('transition-duration', '0s');
    await expect(frame).toHaveCSS('animation-name', 'none');
    await question.click();
    await expectOpenQuestion(faq, null);
    expect(runtimeProblems).toEqual([]);
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    test(`keeps all answers and their inline screenshots readable at ${viewport.width}px`, async ({
      page,
    }) => {
      const { faq, runtimeProblems } = await openFaq(page, viewport);
      await expect(faq.locator('[data-faq-preview]').last()).toBeHidden();
      let initialFrameSize: { width: number; height: number } | undefined;
      for (const item of FAQ_ITEMS) {
        const question = faq.getByRole('button', { name: item.question, exact: true });
        if (item.id !== 'qr') await question.click();
        await expectOpenQuestion(faq, item.id);
        const image = faq.locator(`#faq-answer-${item.id} img[data-faq-screenshot]`);
        await expectImageLoaded(image, item);
        const frame = (await image.locator('xpath=ancestor::figure').boundingBox())!;
        const frameSize = { width: frame.width, height: frame.height };
        initialFrameSize ??= frameSize;
        expect(frameSize).toEqual(initialFrameSize);
        await expect(faq.locator('img[data-faq-screenshot]:visible')).toHaveCount(1);
        expect((await question.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expectNoOverflow(page, faq);
        await captureFaq(faq, `faq-final-${viewport.width}-${item.id}.png`);
        if (viewport.width === 390 && item.id === 'qr') {
          await captureFaq(faq, 'faq-final-mobile.png');
        }
      }
      await faq.getByRole('button', { name: FAQ_ITEMS.at(-1)!.question, exact: true }).click();
      await expectOpenQuestion(faq, null);
      await expect(faq.locator('img[data-faq-screenshot]:visible')).toHaveCount(0);
      expect(runtimeProblems).toEqual([]);
    });
  }
});
