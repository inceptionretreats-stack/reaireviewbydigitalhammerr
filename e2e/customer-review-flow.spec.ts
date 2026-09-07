import { expect, test } from '@playwright/test';
import { closeDb, demoQrCode, resetFreeQuota } from './support/db';

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
    await page.goto(`/r/${QR_CODE}`);

    await expect(page.getByRole('heading', { name: /demo south cafe/i })).toBeVisible();

    // D-008: no questionnaire, and now no tap either — the scan was the intent, so the draft is
    // written on arrival. Nothing is asked of the customer before they have something to react to.
    await expect(page.getByRole('textbox', { name: /your review/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('form input[type="text"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /generate my review/i })).toHaveCount(0);
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

    // REV-02-03: the customer can freely edit before copying.
    await draft.fill(`${text} Edited by the customer.`);
    await expect(draft).toHaveValue(/Edited by the customer\.$/);
  });

  /**
   * AC-008 and ADR-008 — the hinge of the entire product.
   *
   * V1 asks the customer nothing, so the draft is a machine's suggestion until a real person
   * affirms it is true. Copy stays disabled until they do.
   */
  test('keeps Copy disabled until genuine experience is confirmed', async ({ page }) => {
    await page.goto(`/r/${QR_CODE}`);
    await expect(page.getByRole('textbox', { name: /your review/i })).toBeVisible({
      timeout: 30_000,
    });

    // Before confirmation the control is a genuinely disabled button — not a link with a
    // disabled *look*, which would still navigate on a click or an Enter key.
    await expect(page.getByRole('button', { name: /copy .* open/i })).toBeDisabled();
    await expect(page.getByRole('link', { name: /copy .* open/i })).toHaveCount(0);

    const confirm = page.getByRole('checkbox', { name: /genuine experience/i });
    await expect(confirm).toBeVisible();
    await confirm.check();

    // Only now does it become something that can be followed.
    await expect(page.getByRole('link', { name: /copy .* open/i })).toBeVisible();
  });

  test('regenerating produces a different draft and re-arms the confirmation', async ({ page }) => {
    await page.goto(`/r/${QR_CODE}`);

    const draft = page.getByRole('textbox', { name: /your review/i });
    await expect(draft).toBeVisible({ timeout: 30_000 });
    const first = await draft.inputValue();

    await page.getByRole('checkbox', { name: /genuine experience/i }).check();
    await page.getByRole('button', { name: /new review/i }).click();

    await expect(draft).not.toHaveValue(first);

    // A regenerated draft is text the customer has not read yet, so an earlier confirmation
    // cannot carry over to it — and the control drops back to a disabled button, not a live link.
    await expect(page.getByRole('checkbox', { name: /genuine experience/i })).not.toBeChecked();
    await expect(page.getByRole('button', { name: /copy .* open/i })).toBeDisabled();
    await expect(page.getByRole('link', { name: /copy .* open/i })).toHaveCount(0);
  });

  /**
   * AC-025 and D-028. The platform can only observe that Google was opened. Nothing anywhere in
   * the customer flow may say or imply the review was posted.
   */
  test('never claims the review was submitted', async ({ page }) => {
    await page.goto(`/r/${QR_CODE}`);
    await expect(page.getByRole('textbox', { name: /your review/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('checkbox', { name: /genuine experience/i }).check();

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toMatch(/review submitted|submitted your review|posted your review/);

    // The furthest the product goes is opening the destination. Asserted by reading the link
    // rather than following it: clicking leaves for an external site, and a test that navigates
    // off the product is asserting Google's page, not ours.
    const copy = page.getByRole('link', { name: /copy .* open/i });
    await expect(copy).toHaveAttribute('href', /^https?:\/\//);
    await expect(copy).toHaveAttribute('target', '_blank');
    // noopener, so the destination cannot reach back into this tab via window.opener.
    await expect(copy).toHaveAttribute('rel', /noopener/);
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
