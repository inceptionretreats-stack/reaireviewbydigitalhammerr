import { expect, test } from '@playwright/test';
import { closeDb, demoQrCode, eventCountForQrSession, resetFreeQuota } from './support/db';

/**
 * The customer journey, end to end: Flow C, screens REV-01 through REV-03.
 *
 * This is the product. Everything else exists so that a person standing at a counter can scan a
 * code and end up on Google with words they are willing to put their name to. The assertions
 * below are as much about what must NOT be on the page as what must.
 */

const SLUG = process.env.E2E_SLUG ?? 'demo-south-cafe';

// Resolved from the database rather than hard-coded: the seed generates fresh codes, and a stale
// literal fails as a 404 that looks like a broken route.
let QR_CODE = '';

test.beforeAll(async () => {
  QR_CODE = await demoQrCode();
});

test.afterAll(async () => {
  await closeDb();
});

/**
 * Every generation consumes one of ten free generations, so an unreset suite exhausts the tenant
 * partway through and every later test fails on a quota message rather than on its own subject.
 * The first run of this file did exactly that.
 */
test.beforeEach(async () => {
  await resetFreeQuota();
});

test.describe('customer review flow', () => {
  test('scanning a QR lands directly on the review page with no questionnaire', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto(`/r/${QR_CODE}`);

    await expect(page.getByRole('heading', { name: 'Digital Hammerr', exact: true })).toBeVisible();

    // D-008: no questionnaire, and now no tap either — the scan was the intent, so the draft is
    // written on arrival. Nothing is asked of the customer before they have something to react to.
    await expect(page.getByRole('textbox', { name: /your review/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/written with Ai assistance/)).toBeVisible();
    await expect(page.getByText(/written with AI assistance/)).toHaveCount(0);
    await expect(page.locator('form input[type="text"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /generate my review/i })).toHaveCount(0);

    const anonymousCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'dh_anon',
    );
    expect(anonymousCookie).toMatchObject({ httpOnly: true, path: '/', sameSite: 'Lax' });
    await expect
      .poll(() => eventCountForQrSession('qr_scan', QR_CODE, anonymousCookie!.value))
      .toBe(1);
    await expect
      .poll(() => eventCountForQrSession('review_page_view', QR_CODE, anonymousCookie!.value))
      .toBe(1);
  });

  /**
   * AC-006 and D-009, the compliance assertion that matters most.
   *
   * No star rating is collected anywhere before Google. With nothing to rate there is no way to
   * route happy customers one way and unhappy ones elsewhere, which is the practice Google's
   * fake-engagement policy exists to stop.
   */
  test('never asks for a star rating', async ({ page }) => {
    await page.goto(`/r/${QR_CODE}`);

    await expect(page.locator('[type="radio"]')).toHaveCount(0);
    await expect(page.getByRole('radiogroup')).toHaveCount(0);

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toMatch(/\b(star rating|rate us|how many stars|[1-5] stars?)\b/);
  });

  test('generates an editable draft', async ({ page }) => {
    await page.goto(`/r/${QR_CODE}`);

    const draft = page.getByRole('textbox', { name: /your review/i });
    await expect(draft).toBeVisible({ timeout: 30_000 });

    const text = await draft.inputValue();
    expect(text.length).toBeGreaterThan(60);
    // CHANGE-003: the demo tenant is Hinglish by default and the stub honours the setting, so
    // a draft here is written in Hinglish. The marker is a literal copy of HINGLISH_MARKER in
    // packages/core — Playwright must not import that package.
    expect(text).toMatch(/\b(?:tha|thi|aur|hai|raha|bahut|kaafi|accha|acha)\b/i);
    const anonymousCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'dh_anon',
    );
    expect(anonymousCookie).toBeDefined();

    // REV-02-03: the customer can freely edit before copying.
    await draft.fill(`${text} Edited by the customer.`);
    await expect(draft).toHaveValue(/Edited by the customer\.$/);
    await expect
      .poll(() => eventCountForQrSession('review_edit', QR_CODE, anonymousCookie!.value))
      .toBe(1);
  });

  /**
   * AC-008 and ADR-008 — the hinge of the entire product.
   *
   * V1 asks the customer nothing, so the draft is a machine's suggestion until a real person
   * affirms it is true. Copy stays disabled until they do.
   */
  test('keeps Copy disabled until genuine experience is confirmed', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/r/${QR_CODE}`);
    const draft = page.getByRole('textbox', { name: /your review/i });
    await expect(draft).toBeVisible({
      timeout: 30_000,
    });
    const expectedDraft = await draft.inputValue();
    const anonymousCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'dh_anon',
    );
    expect(anonymousCookie).toBeDefined();

    // Before confirmation the control is a genuinely disabled button — not a link with a
    // disabled *look*, which would still navigate on a click or an Enter key.
    await expect(page.getByRole('button', { name: 'Copy & open Google' })).toBeDisabled();
    await expect(page.getByRole('link', { name: /copy & open google/i })).toHaveCount(0);

    const confirm = page.getByRole('checkbox', { name: /genuine experience/i });
    await expect(confirm).toBeVisible();
    await confirm.check();
    await expect
      .poll(() => eventCountForQrSession('experience_confirmed', QR_CODE, anonymousCookie!.value))
      .toBe(1);

    // Confirmation turns the control into the real link: copy and open are one tap
    // (AMENDMENT-022). Followed in a new tab, so this page — and its clipboard — stay put.
    const copy = page.getByRole('link', { name: 'Copy & open Google' });
    await expect(copy).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy & open Google' })).toHaveCount(0);
    const [opened] = await Promise.all([page.context().waitForEvent('page'), copy.click()]);
    await opened.close();
    await expect(page.getByText(/^Copied\./)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedDraft);
    await expect
      .poll(() => eventCountForQrSession('review_copy', QR_CODE, anonymousCookie!.value))
      .toBe(1);
  });

  test('selects the full draft and stays truthful when automatic copying is blocked', async ({
    page,
  }) => {
    const copyEvents: string[] = [];
    page.on('request', (request) => {
      if (!request.url().endsWith('/api/v1/public/events')) return;
      try {
        const payload = request.postDataJSON() as { name?: string };
        if (payload.name) copyEvents.push(payload.name);
      } catch {
        // An unrelated malformed analytics request is not the subject of this assertion.
      }
    });

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new DOMException('Blocked for test', 'NotAllowedError')),
        },
      });
    });

    await page.goto(`/r/${QR_CODE}`);
    const draft = page.getByRole('textbox', { name: /your review/i });
    await expect(draft).toBeVisible({ timeout: 30_000 });
    const draftLength = (await draft.inputValue()).length;
    const anonymousCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'dh_anon',
    );
    expect(anonymousCookie).toBeDefined();
    await page.getByRole('checkbox', { name: /genuine experience/i }).check();
    // The write is attempted and refused after the tab has already left, so the tap still opens
    // the destination — what must not happen is this page claiming the text was copied.
    const [opened] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: 'Copy & open Google' }).click(),
    ]);
    await opened.close();

    await expect(page.getByRole('alert').filter({ hasText: /could not copy/i })).toContainText(
      /could not copy automatically/i,
    );
    await expect(page.getByText(/^Copied\./)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^open google$/i })).toBeVisible();
    await expect
      .poll(() =>
        draft.evaluate((element) => {
          const editor = element as HTMLTextAreaElement;
          return {
            focused: document.activeElement === editor,
            start: editor.selectionStart,
            end: editor.selectionEnd,
            length: editor.value.length,
          };
        }),
      )
      .toEqual({
        focused: true,
        start: 0,
        end: draftLength,
        length: draftLength,
      });
    expect(copyEvents).not.toContain('review_copy');
    expect(await eventCountForQrSession('review_copy', QR_CODE, anonymousCookie!.value)).toBe(0);
  });

  /**
   * On a plain-HTTP origin `navigator.clipboard` does not exist. That is known before the tap
   * does anything, so the customer is kept here with the draft selected and the destination
   * offered as a plain link — rather than sent to Google with nothing to paste.
   */
  test('keeps the customer on the page when there is no clipboard to write to', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    });

    await page.goto(`/r/${QR_CODE}`);
    const draft = page.getByRole('textbox', { name: /your review/i });
    await expect(draft).toBeVisible({ timeout: 30_000 });
    await page.getByRole('checkbox', { name: /genuine experience/i }).check();

    let pagesOpened = 0;
    page.context().on('page', () => (pagesOpened += 1));
    await page.getByRole('link', { name: 'Copy & open Google' }).click();

    await expect(page.getByRole('alert').filter({ hasText: /could not copy/i })).toContainText(
      /could not copy automatically/i,
    );
    await expect(page.getByText(/^Copied\./)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/r/${QR_CODE}`));
    expect(pagesOpened).toBe(0);
    await expect(draft).toBeFocused();

    // The manual path: a plain link to the same destination, once they have copied by hand.
    const manual = page.getByRole('link', { name: /^open google$/i });
    await expect(manual).toBeVisible();
    await expect(manual).toHaveAttribute('href', /^https?:\/\//);
    await expect(manual).toHaveAttribute('target', '_blank');
  });

  test('regenerating produces a different draft and re-arms the confirmation', async ({ page }) => {
    await page.goto(`/r/${QR_CODE}`);

    const draft = page.getByRole('textbox', { name: /your review/i });
    await expect(draft).toBeVisible({ timeout: 30_000 });
    const first = await draft.inputValue();
    const anonymousCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'dh_anon',
    );
    expect(anonymousCookie).toBeDefined();

    await page.getByRole('checkbox', { name: /genuine experience/i }).check();
    await page.getByRole('button', { name: /new review/i }).click();

    await expect(draft).not.toHaveValue(first);
    await expect
      .poll(() => eventCountForQrSession('ai_regenerate_click', QR_CODE, anonymousCookie!.value))
      .toBe(1);

    // A regenerated draft is text the customer has not read yet, so an earlier confirmation
    // cannot carry over to it — and the control drops back to a disabled button, not a live link.
    await expect(page.getByRole('checkbox', { name: /genuine experience/i })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Copy & open Google' })).toBeDisabled();
    await expect(page.getByRole('link', { name: /copy & open google/i })).toHaveCount(0);
  });

  /**
   * AC-025 and D-028. The platform can only observe that Google was opened. Nothing anywhere in
   * the customer flow may say or imply the review was posted.
   */
  test('never claims the review was submitted', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/r/${QR_CODE}`);
    await expect(page.getByRole('textbox', { name: /your review/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('checkbox', { name: /genuine experience/i }).check();

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toMatch(/review submitted|submitted your review|posted your review/);

    const anonymousCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'dh_anon',
    );
    expect(anonymousCookie).toBeDefined();

    // The furthest the product goes is opening the destination. Asserted by reading the link
    // rather than following it: clicking leaves for an external site, and a test that navigates
    // off the product is asserting Google's page, not ours.
    const destination = page.getByRole('link', { name: 'Copy & open Google' });
    await expect(destination).toHaveAttribute('href', /^https?:\/\//);
    await expect(destination).toHaveAttribute('target', '_blank');
    // noopener, so the destination cannot reach back into this tab via window.opener.
    await expect(destination).toHaveAttribute('rel', /noopener/);

    // Keep this assertion inside our app while still exercising the real click handler. The
    // destination itself is external and not part of this product's test surface.
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        (event) => {
          if (event.target instanceof Element && event.target.closest('a[target="_blank"]')) {
            event.preventDefault();
          }
        },
        { capture: true, once: true },
      );
    });
    await destination.click();
    await expect(page.getByText(/^Copied\./)).toBeVisible();
    await expect
      .poll(() => eventCountForQrSession('google_open', QR_CODE, anonymousCookie!.value))
      .toBe(1);
  });

  /** D-010, AC-024: private feedback is offered to every visitor, not only unhappy ones. */
  test('offers private feedback without asking for sentiment first', async ({ page }) => {
    await page.goto(`/r/${QR_CODE}`);
    await page.getByRole('link', { name: /private feedback/i }).click();

    await expect(page).toHaveURL(new RegExp(`/${SLUG}/feedback`));
    await expect(page.getByRole('textbox', { name: /like the business to know/i })).toBeVisible();
    await expect(page.locator('[type="radio"]')).toHaveCount(0);
  });
});
