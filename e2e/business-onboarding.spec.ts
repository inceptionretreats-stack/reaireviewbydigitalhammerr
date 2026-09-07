import { expect, test } from '@playwright/test';
import { closeDb } from './support/db';

/**
 * The full business journey in one continuous session: Flow A, AUTH-01 and ONB-01 to ONB-05,
 * ending at a published page and a working QR.
 *
 * Deliberately ONE test rather than six. 12_QA_Acceptance_Criteria.md asks for exactly this path
 * end to end, onboarding is one-way so the steps cannot be reordered or run independently, and
 * Playwright gives each test its own browser context — which would drop the session between
 * steps and test the login redirect five times instead of the wizard.
 *
 * A fresh account each run: a tenant that has published cannot be walked back through setup, so
 * reusing the seeded demo tenant would exercise the resume path rather than a new customer's.
 */

const RUN = Date.now().toString(36);
const OWNER = {
  name: 'Asha Sharma',
  email: `e2e-owner-${RUN}@example.test`,
  mobile: '9876543210',
  password: 'e2e-Owner-Password-1!',
};
const BUSINESS = {
  name: `E2E Test Kitchen ${RUN}`,
  city: 'Udaipur',
  state: 'Rajasthan',
  slug: `e2e-kitchen-${RUN}`,
};

test.afterAll(async () => {
  await closeDb();
});

test('a new business signs up, completes setup and publishes', async ({ page }) => {
  test.setTimeout(180_000);

  // --- AUTH-01 -------------------------------------------------------------------------------
  await page.goto('/signup');
  await page.getByLabel(/your name/i).fill(OWNER.name);
  await page.getByLabel(/^email/i).fill(OWNER.email);
  await page.getByLabel(/mobile number/i).fill(OWNER.mobile);
  await page.getByLabel(/^password/i).fill(OWNER.password);
  await page.getByRole('checkbox', { name: /accept the terms/i }).check();
  await page.getByRole('button', { name: /create account/i }).click();

  // AUTH-01-01: signup creates the owner and a pending tenant, then drops them into setup
  // rather than an empty dashboard.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });

  // --- ONB-01: identity and the public address -----------------------------------------------
  await page.goto('/onboarding/business');
  await page.getByLabel(/business name/i).fill(BUSINESS.name);

  const category = page.getByLabel(/category/i);
  await category.selectOption({ index: 1 });

  await page.getByLabel(/^city/i).fill(BUSINESS.city);
  await page.getByLabel(/^state/i).fill(BUSINESS.state);
  await page.getByLabel(/page address/i).fill(BUSINESS.slug);

  // The address is checked live; the verdict must actually surface, since it is the only signal
  // that a name is still free.
  await expect(page.getByText(/available/i).first()).toBeVisible({ timeout: 20_000 });

  await page
    .getByRole('button', { name: /continue|got it/i })
    .first()
    .click();
  await expect(page).toHaveURL(/review-link/, { timeout: 30_000 });

  // --- ONB-02: the Google destination --------------------------------------------------------
  const reviewUrl = page.getByLabel(/google review|review link|review url/i);

  // ONB-02-02 restricts the host set. This one field redirects every future customer, so a wrong
  // paste has to be caught here rather than discovered by someone landing nowhere.
  await reviewUrl.fill('https://facebook.com/not-google');
  await page.getByRole('button', { name: /^continue$/i }).click();
  await expect(page.getByText(/google link|not a google|unsupported/i).first()).toBeVisible();

  await reviewUrl.fill('https://g.page/r/E2ETestKitchen/review');
  await page.getByRole('button', { name: /^continue$/i }).click();
  await expect(page).toHaveURL(/\/links/, { timeout: 30_000 });

  // --- ONB-03: optional contact links --------------------------------------------------------
  // Skipping must genuinely skip: publish does not require these, and an earlier defect made the
  // resume link send owners back here forever because nothing was written.
  await page.getByRole('button', { name: /skip/i }).click();
  await expect(page).toHaveURL(/\/ai/, { timeout: 30_000 });

  // --- ONB-04: AI context --------------------------------------------------------------------
  const aiBody = (await page.locator('body').innerText()).toLowerCase();
  // D-025 and AC-010: nothing may present merchant terms as words required in every review.
  expect(aiBody).not.toMatch(/mandatory keyword|required keyword|must appear in every review/);
  expect(aiBody).toMatch(/hint|may not appear|context/);

  await page.getByRole('button', { name: /^continue$/i }).click();
  await expect(page).toHaveURL(/\/finish/, { timeout: 30_000 });

  // --- ONB-05: publish -----------------------------------------------------------------------
  await page.getByRole('button', { name: /publish/i }).click();

  // The address is a read-only field plus an "Open my page" link, not prose. Both are asserted:
  // the field is what the owner copies, the link is what they click.
  const addressField = page.getByLabel(/public page address/i);
  await expect(addressField).toHaveValue(new RegExp(BUSINESS.slug), { timeout: 30_000 });

  await expect(page.getByRole('link', { name: /open my page/i })).toHaveAttribute(
    'href',
    new RegExp(BUSINESS.slug),
  );
  await expect(page.getByText(/live/i).first()).toBeVisible();

  // ONB-05-02: the canonical route works immediately, not after a cache expires.
  const publicPage = await page.request.get(`/${BUSINESS.slug}`);
  expect(publicPage.status()).toBe(200);

  // ONB-05-01: publishing creates the first QR source, so the owner leaves setup with something
  // printable rather than a to-do.
  const qrList = await page.request.get('/api/v1/qr');
  expect(qrList.status()).toBe(200);
  const qrBody = (await qrList.json()) as {
    sources: Array<{ code: string; source_label: string; resolve_url: string }>;
  };
  expect(qrBody.sources.length).toBeGreaterThan(0);

  // ADR-002 and D-026: the printed code resolves through the platform, never straight to Google
  // and never through the slug — that is what lets the address change without a reprint.
  const first = qrBody.sources[0]!;
  expect(first.resolve_url).toContain(`/r/${first.code}`);
  expect(first.resolve_url).not.toContain(BUSINESS.slug);

  // And the printed code actually resolves for a customer.
  const scan = await page.request.get(`/r/${first.code}`);
  expect(scan.status()).toBe(200);
});
