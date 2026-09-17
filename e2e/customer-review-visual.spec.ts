import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

/**
 * Backend-safe visual coverage, deliberately separate from the real customer-flow suite.
 *
 * /r/{code} and /{slug}/feedback record analytics during SERVER rendering. Do not visit them.
 * This slug review route only reads its published configuration; all browser writes below are
 * fulfilled locally before navigation. No provider, quota, analytics, feedback or OS clipboard
 * writes are exercised. Native destination popups are also served locally, never by Google.
 * Run this scoped file with a Temp output directory and the installed-Chrome Playwright runtime.
 */
const ORIGIN = 'http://127.0.0.1:3000';
const SLUG = 'demo-south-cafe';
const REVIEW_ROUTE = `${ORIGIN}/${SLUG}/review`;
const REVIEW =
  'A helpful team for website and app development. Clear communication and thoughtful graphic design.';
const OTHER_REVIEW =
  'Thoughtful website design and practical app development advice. The team explained the process clearly.';
const GENERATION_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
] as const;

declare global {
  interface Window {
    __customerReviewFixtureClipboard: string[];
  }
}

type ClipboardMode = 'success' | 'blocked' | 'absent';
interface GenerationRequest {
  slug?: string;
  qr_code?: string;
  previous_generation_id?: string;
}
interface TrackedEvent {
  name: string;
  slug?: string;
  properties: Record<string, unknown>;
}
interface GenerationReply {
  status: number;
  body: Record<string, unknown>;
}
interface MockHarness {
  generationRequests: GenerationRequest[];
  events: TrackedEvent[];
  externalNavigations: string[];
  clipboardMode: ClipboardMode;
  answerGeneration: (
    index: number,
    request: GenerationRequest,
  ) => GenerationReply | Promise<GenerationReply>;
}

function success(index = 0): GenerationReply {
  return {
    status: 200,
    body: {
      generation_id: GENERATION_IDS[Math.min(index, 1)],
      review_text: index === 0 ? REVIEW : OTHER_REVIEW,
      prompt_version: 'local-ui-fixture',
      requires_experience_confirmation: true,
    },
  };
}

function unavailable(): GenerationReply {
  return {
    status: 503,
    body: {
      error: {
        code: 'AI_PROVIDER_UNAVAILABLE',
        message:
          'The writing assistant is unavailable right now. You can still write your own review.',
        request_id: 'local-ui-fixture',
      },
    },
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const test = base.extend<{ mocked: MockHarness }>({
  mocked: async ({ page, context }, use) => {
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];
    const consoleErrors: string[] = [];
    const expectedHttpErrors = new Set<string>();
    const mocked: MockHarness = {
      generationRequests: [],
      events: [],
      externalNavigations: [],
      clipboardMode: 'success',
      answerGeneration: (index) => success(index),
    };

    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // A deliberately mocked 503 can produce Chrome's native resource error, not an app error.
      if (
        expectedHttpErrors.has(message.location().url) &&
        /Failed to load resource.*503/.test(message.text())
      ) {
        return;
      }
      consoleErrors.push(message.text());
    });

    await context.addInitScript(() => {
      window.__customerReviewFixtureClipboard = [];
      // Resolved/rejected promises mirror the actual asynchronous Clipboard API without writing
      // the computer's clipboard. Tests can replace the mode before navigation below.
    });

    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.origin !== ORIGIN) {
        if (request.isNavigationRequest()) mocked.externalNavigations.push(request.url());
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>Local review destination fixture</title><p>No external request or review posting occurred.</p>',
        });
        return;
      }

      // Guard accidental navigation or future prefetches to server-side write surfaces too.
      if (/^\/r(?:\/|$)|\/feedback(?:\/|$)/.test(url.pathname)) {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: 'Blocked fixture route.',
        });
        return;
      }

      if (request.method() === 'POST' && url.pathname === '/api/v1/public/review/generate') {
        const payload = request.postDataJSON() as GenerationRequest;
        const index = mocked.generationRequests.push(payload) - 1;
        const reply = await mocked.answerGeneration(index, payload);
        if (reply.status >= 400) expectedHttpErrors.add(request.url());
        await route.fulfill({
          status: reply.status,
          contentType: 'application/json',
          body: JSON.stringify(reply.body),
        });
        return;
      }

      if (request.method() === 'POST' && url.pathname === '/api/v1/public/events') {
        mocked.events.push(request.postDataJSON() as TrackedEvent);
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({ accepted: false }),
        });
        return;
      }

      if (!['GET', 'HEAD'].includes(request.method())) {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        await route.abort('blockedbyclient');
        return;
      }

      await route.continue();
    });

    await use(mocked);
    expect(
      unexpectedRequests,
      'No backend writes or server-write routes may escape the fixture',
    ).toEqual([]);
    expect(runtimeErrors, 'No application runtime errors').toEqual([]);
    expect(consoleErrors, 'No unexpected console errors').toEqual([]);
  },
});

test.use({ baseURL: ORIGIN, colorScheme: 'dark', viewport: { width: 390, height: 844 } });

async function prepareClipboard(context: BrowserContext, mode: ClipboardMode) {
  await context.addInitScript((clipboardMode) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value:
        clipboardMode === 'absent'
          ? undefined
          : {
              writeText(text: string) {
                window.__customerReviewFixtureClipboard.push(text);
                return clipboardMode === 'blocked'
                  ? Promise.reject(new DOMException('Local fixture only', 'NotAllowedError'))
                  : Promise.resolve();
              },
            },
    });
  }, mode);
}

async function arrive(page: Page, context: BrowserContext, mocked: MockHarness) {
  await prepareClipboard(context, mocked.clipboardMode);
  const response = await page.goto(REVIEW_ROUTE, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(REVIEW_ROUTE);
  await expect(page).toHaveTitle('Ai Review by Digital Hammerr');
  const flow = page.locator('article[data-customer-review-flow]');
  await expect(flow).toBeVisible();
  await expect(flow.getByRole('heading', { name: 'Digital Hammerr', exact: true })).toBeVisible();
  await expect(flow.getByRole('link', { name: /private feedback/i })).toHaveAttribute(
    'href',
    `/${SLUG}/feedback`,
  );
  await expect(
    page.getByRole('dialog').filter({ hasText: /Runtime Error|Build Error|Unhandled Error/ }),
  ).toHaveCount(0);
  return flow;
}

async function ready(page: Page, context: BrowserContext, mocked: MockHarness) {
  const flow = await arrive(page, context, mocked);
  await expect(flow.getByRole('textbox', { name: /your review/i })).toHaveValue(REVIEW);
  return flow;
}

async function evidence(page: Page, testInfo: TestInfo, name: string) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-review-customer-editor-'));
  const imagePath = join(directory, `${name}.png`);
  await page.screenshot({ path: imagePath, fullPage: true });
  await testInfo.attach(name, { path: imagePath, contentType: 'image/png' });
}

async function expectFullSelection(page: Page) {
  const editor = page.locator('#review-draft');
  const length = (await editor.inputValue()).length;
  await expect
    .poll(() =>
      editor.evaluate((element: HTMLTextAreaElement) => ({
        focused: document.activeElement === element,
        start: element.selectionStart,
        end: element.selectionEnd,
      })),
    )
    .toEqual({ focused: true, start: 0, end: length });
}

test.describe('backend-safe customer review editor', () => {
  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 1000 },
  ]) {
    test(`stays light, readable and contained in dark OS mode on ${viewport.name}`, async ({
      page,
      context,
      mocked,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const flow = await ready(page, context, mocked);
      const layout = await flow.evaluate((element) => {
        const article = element as HTMLElement;
        const main = article.closest('main')!;
        const editor = article.querySelector<HTMLTextAreaElement>('#review-draft')!;
        const editorStyle = getComputedStyle(editor);
        const surfaceBackground = (surface: Element) => {
          for (let current: Element | null = surface; current; current = current.parentElement) {
            const background = getComputedStyle(current).backgroundColor;
            if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent')
              return background;
          }
          return 'transparent';
        };
        return {
          darkOS: matchMedia('(prefers-color-scheme: dark)').matches,
          viewportWidth: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          mainBackground: surfaceBackground(main),
          articleBackground: surfaceBackground(article),
          editorBackground: surfaceBackground(editor),
          editorSize: Number.parseFloat(editorStyle.fontSize),
          editorLeading: Number.parseFloat(editorStyle.lineHeight),
          controls: Array.from(
            article.querySelectorAll<HTMLElement>('textarea, input, button, a'),
          ).map((control) => {
            const rectangle = control.getBoundingClientRect();
            return {
              left: rectangle.left,
              right: rectangle.right,
              height: rectangle.height,
              tag: control.tagName,
            };
          }),
        };
      });
      expect(layout.darkOS).toBe(true);
      expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
      for (const background of [
        layout.mainBackground,
        layout.articleBackground,
        layout.editorBackground,
      ]) {
        const rgb = background.match(/[\d.]+/g)?.map(Number);
        expect(rgb, `Opaque light surface, received ${background}`).toBeDefined();
        expect(
          Math.min(...rgb!.slice(0, 3)),
          `Light surface, received ${background}`,
        ).toBeGreaterThanOrEqual(220);
      }
      expect(layout.editorSize).toBeGreaterThanOrEqual(16);
      expect(layout.editorLeading).toBeGreaterThanOrEqual(layout.editorSize * 1.5);
      for (const control of layout.controls) {
        expect(control.left).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(layout.viewportWidth);
        if (control.tag !== 'INPUT') expect(control.height).toBeGreaterThanOrEqual(44);
      }
      await expect(flow.locator('#review-draft')).toHaveAttribute('id', 'review-draft');
      await expect(flow.locator('#genuine-experience')).not.toBeChecked();
      await expect(flow.getByRole('button', { name: 'Copy & open Google' })).toBeDisabled();
      await expect(flow.getByRole('link', { name: 'Copy & open Google' })).toHaveCount(0);
      await expect(flow.locator('[type="radio"], [role="radiogroup"]')).toHaveCount(0);
      await expect(flow.locator('form input[type="text"]')).toHaveCount(0);
      await expect(flow.getByText(/written with Ai assistance/)).toBeVisible();
      expect(await flow.innerText()).not.toMatch(
        /review submitted|submitted your review|posted your review/i,
      );
      expect(mocked.generationRequests).toEqual([{ slug: SLUG }]);
      expect(mocked.externalNavigations).toEqual([]);
      await evidence(page, testInfo, `customer-editor-${viewport.name}`);
    });
  }

  test('announces a pending generation and transitions into the editable draft once', async ({
    page,
    context,
    mocked,
  }) => {
    const pending = gate();
    mocked.answerGeneration = async () => {
      await pending.promise;
      return success();
    };
    const flow = await arrive(page, context, mocked);
    try {
      await expect.poll(() => mocked.generationRequests.length).toBe(1);
      await expect(flow.locator('[aria-busy="true"]')).toBeVisible();
      await expect(flow.locator('[aria-live="polite"]')).not.toHaveCount(0);
      await expect(flow.locator('#review-draft')).toHaveCount(0);
    } finally {
      pending.release();
    }
    await expect(flow.locator('#review-draft')).toHaveValue(REVIEW);
    await expect(flow.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(flow.getByRole('button', { name: 'Copy & open Google' })).toBeDisabled();
    expect(mocked.generationRequests).toEqual([{ slug: SLUG }]);
  });

  test('counts edits, confirms genuine experience and copies into a locally served native popup', async ({
    page,
    context,
    mocked,
  }) => {
    const flow = await ready(page, context, mocked);
    const edited = `${REVIEW} Edited by the customer.`;
    await flow.getByRole('textbox', { name: /your review/i }).fill(edited);
    await expect(
      flow.getByText(`${edited.length} / 1200 characters`, { exact: true }),
    ).toBeVisible();
    await expect(flow.getByRole('button', { name: 'Copy & open Google' })).toBeDisabled();
    await flow.getByRole('checkbox', { name: /genuine experience/i }).check();
    const copy = flow.getByRole('link', { name: 'Copy & open Google' });
    await expect(copy).toHaveAttribute('target', '_blank');
    await expect(copy).toHaveAttribute('rel', /noopener/);
    await expect(copy).toHaveAttribute('href', /^https?:\/\//);
    await expect(flow.getByRole('button', { name: 'Copy & open Google' })).toHaveCount(0);
    const destination = (await copy.getAttribute('href'))!;
    const [popup] = await Promise.all([context.waitForEvent('page'), copy.click()]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup).toHaveURL(destination);
    await expect(popup).toHaveTitle('Local review destination fixture');
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await expect(flow.getByText(/^Copied\./)).toBeVisible();
    expect(await page.evaluate(() => window.__customerReviewFixtureClipboard)).toEqual([edited]);
    await expect
      .poll(() => mocked.events.map((event) => event.name))
      .toEqual(
        expect.arrayContaining([
          'review_edit',
          'experience_confirmed',
          'review_copy',
          'google_open',
        ]),
      );
    expect(mocked.events.find((event) => event.name === 'review_copy')?.properties).toMatchObject({
      generation_id: GENERATION_IDS[0],
      was_edited: true,
    });
    expect(mocked.externalNavigations).toEqual([destination]);
    expect(await flow.innerText()).not.toMatch(
      /review submitted|submitted your review|posted your review/i,
    );
    await expect(flow.getByRole('link', { name: /private feedback/i })).toHaveAttribute(
      'href',
      `/${SLUG}/feedback`,
    );
  });

  test('requests a fresh draft with its parent ID and resets genuine confirmation', async ({
    page,
    context,
    mocked,
  }) => {
    const flow = await ready(page, context, mocked);
    await flow.getByRole('checkbox', { name: /genuine experience/i }).check();
    await expect(flow.getByRole('link', { name: 'Copy & open Google' })).toBeVisible();
    await flow.getByRole('button', { name: 'New review' }).click();
    await expect(flow.locator('#review-draft')).toHaveValue(OTHER_REVIEW);
    expect(mocked.generationRequests).toEqual([
      { slug: SLUG },
      { slug: SLUG, previous_generation_id: GENERATION_IDS[0] },
    ]);
    await expect(flow.getByRole('checkbox', { name: /genuine experience/i })).not.toBeChecked();
    await expect(flow.getByRole('button', { name: 'Copy & open Google' })).toBeDisabled();
    await expect(flow.getByRole('link', { name: 'Copy & open Google' })).toHaveCount(0);
    await expect(
      flow.getByText(`${OTHER_REVIEW.length} / 1200 characters`, { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => mocked.events.map((event) => event.name))
      .toContain('ai_regenerate_click');
    expect(mocked.externalNavigations).toEqual([]);
  });

  test('selects the complete draft after a refused clipboard write without claiming Copied', async ({
    page,
    context,
    mocked,
  }, testInfo) => {
    mocked.clipboardMode = 'blocked';
    const flow = await ready(page, context, mocked);
    await flow.getByRole('checkbox', { name: /genuine experience/i }).check();
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      flow.getByRole('link', { name: 'Copy & open Google' }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await popup.close();
    await expect(flow.getByRole('alert')).toContainText(/could not copy automatically/i);
    await expect(flow.getByText(/^Copied\./)).toHaveCount(0);
    await expectFullSelection(page);
    const manual = flow.getByRole('link', { name: 'Open Google', exact: true });
    await expect(manual).toBeVisible();
    await expect(manual).toHaveAttribute('target', '_blank');
    expect(mocked.events.map((event) => event.name)).not.toContain('review_copy');
    expect(await page.evaluate(() => window.__customerReviewFixtureClipboard)).toEqual([REVIEW]);
    await evidence(page, testInfo, 'customer-editor-clipboard-fallback');
  });

  test('keeps the visitor here with manual copying when Clipboard API is unavailable', async ({
    page,
    context,
    mocked,
  }) => {
    mocked.clipboardMode = 'absent';
    const flow = await ready(page, context, mocked);
    await flow.getByRole('checkbox', { name: /genuine experience/i }).check();
    await flow.getByRole('link', { name: 'Copy & open Google' }).click();
    await expect(flow.getByRole('alert')).toContainText(/could not copy automatically/i);
    await expectFullSelection(page);
    await expect(page).toHaveURL(REVIEW_ROUTE);
    await expect(flow.getByText(/^Copied\./)).toHaveCount(0);
    await expect(flow.getByRole('link', { name: 'Open Google', exact: true })).toBeVisible();
    expect(context.pages()).toHaveLength(1);
    expect(mocked.externalNavigations).toEqual([]);
    expect(mocked.events.map((event) => event.name)).not.toContain('google_open');
    expect(mocked.events.map((event) => event.name)).not.toContain('review_copy');
    expect(await page.evaluate(() => window.__customerReviewFixtureClipboard)).toEqual([]);
  });

  test('keeps loading through one controlled 503 retry then restores a healthy draft', async ({
    page,
    context,
    mocked,
  }) => {
    const second = gate();
    mocked.answerGeneration = async (index) => {
      if (index === 0) return unavailable();
      await second.promise;
      return success();
    };
    const flow = await arrive(page, context, mocked);
    try {
      await expect.poll(() => mocked.generationRequests.length).toBe(2);
      await expect(flow.locator('[aria-busy="true"]')).toBeVisible();
      await expect(flow.locator('#review-draft')).toHaveCount(0);
      await expect(flow.getByRole('alert')).toHaveCount(0);
    } finally {
      second.release();
    }
    await expect(flow.locator('#review-draft')).toHaveValue(REVIEW);
    await expect(flow.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(flow.getByRole('alert')).toHaveCount(0);
    await expect(flow.getByRole('button', { name: 'Copy & open Google' })).toBeDisabled();
    expect(mocked.generationRequests).toEqual([{ slug: SLUG }, { slug: SLUG }]);
    expect(mocked.externalNavigations).toEqual([]);
  });

  test('preserves direct review and private-feedback links after both 503 attempts fail', async ({
    page,
    context,
    mocked,
  }) => {
    mocked.answerGeneration = () => unavailable();
    const flow = await arrive(page, context, mocked);
    await expect(flow.getByRole('alert')).toContainText(/writing assistant is unavailable/i);
    expect(mocked.generationRequests).toEqual([{ slug: SLUG }, { slug: SLUG }]);
    await expect(flow.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(flow.locator('#review-draft')).toHaveCount(0);
    const direct = flow.getByRole('link', { name: /write your own review on Google/i });
    await expect(direct).toHaveAttribute('href', /^https?:\/\//);
    await expect(direct).toHaveAttribute('target', '_blank');
    await expect(direct).toHaveAttribute('rel', /noopener/);
    await expect(flow.getByRole('link', { name: /private feedback/i })).toHaveAttribute(
      'href',
      `/${SLUG}/feedback`,
    );
    expect(mocked.externalNavigations).toEqual([]);
  });

  test('uses the real draft length and prevents blank or over-limit text from copying', async ({
    page,
    context,
    mocked,
  }) => {
    const flow = await ready(page, context, mocked);
    const editor = flow.locator('#review-draft');
    await expect(
      flow.getByText(`${REVIEW.length} / 1200 characters`, { exact: true }),
    ).toBeVisible();
    await flow.getByRole('checkbox', { name: /genuine experience/i }).check();
    for (const value of ['', '   ', 'x'.repeat(1201)]) {
      await editor.fill(value);
      await expect(editor).toHaveValue(value);
      await expect(flow.getByText(new RegExp(`^${value.length} / 1200 characters`))).toBeVisible();
      await expect(flow.getByRole('button', { name: 'Copy & open Google' })).toBeDisabled();
      await expect(flow.getByRole('link', { name: 'Copy & open Google' })).toHaveCount(0);
    }
    await expect(flow.getByText(/please shorten before copying/i)).toBeVisible();
    await editor.fill('x'.repeat(1200));
    await expect(flow.getByRole('link', { name: 'Copy & open Google' })).toBeVisible();
    expect(mocked.externalNavigations).toEqual([]);
    expect(await page.evaluate(() => window.__customerReviewFixtureClipboard)).toEqual([]);
  });
});
