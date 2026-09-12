import { expect, test, type Page } from '@playwright/test';
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

async function expectOnboardingChrome(page: Page, step: number): Promise<void> {
  await expect(page.locator('.onboarding-shell')).toBeVisible();
  await expect(page.locator('.onboarding-panel')).toBeVisible();
  await expect(page.getByText(new RegExp(`Step\\s*${step}\\s*of\\s*5`, 'i')).first()).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

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
  await expectOnboardingChrome(page, 1);
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
  await expectOnboardingChrome(page, 2);

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
  await expectOnboardingChrome(page, 3);

  // --- ONB-03: optional contact links --------------------------------------------------------
  // Skipping must genuinely skip: publish does not require these, and an earlier defect made the
  // resume link send owners back here forever because nothing was written.
  await page.getByRole('button', { name: /skip/i }).click();
  await expect(page).toHaveURL(/\/ai/, { timeout: 30_000 });
  await expectOnboardingChrome(page, 4);

  // --- ONB-04: AI context --------------------------------------------------------------------
  const aiBody = (await page.locator('body').innerText()).toLowerCase();
  // D-025 and AC-010: nothing may present merchant terms as words required in every review.
  expect(aiBody).not.toMatch(/mandatory keyword|required keyword|must appear in every review/);
  expect(aiBody).toMatch(/hint|may not appear|context/);
  // CHANGE-003: a new business is Hinglish unless the owner says otherwise.
  await expect(page.getByLabel(/draft language/i)).toHaveValue('hinglish');

  await page.getByRole('button', { name: /^continue$/i }).click();
  await expect(page).toHaveURL(/\/finish/, { timeout: 30_000 });
  await expectOnboardingChrome(page, 5);

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

  // The owner should be able to SEE the code they just created, not only download it. This is the
  // artefact the whole product turns on, and it used to be visible nowhere in the owner's UI.
  const finishCard = page.locator('figure[aria-label^="QR card"]').first();
  const finishQr = finishCard.getByRole('img', { name: /qr code/i });
  await expect(finishQr).toBeVisible({ timeout: 30_000 });
  await expect(finishQr).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  await expect(finishCard.locator('[data-qr-card-part]')).toHaveCount(3);
  expect(
    await finishCard.evaluate((element) =>
      (element as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
    ),
  ).toBe(`${BUSINESS.name} Ai Review by Digital Hammerr`);

  // ONB-05-02: the canonical route works immediately, not after a cache expires.
  const publicPage = await page.request.get(`/${BUSINESS.slug}`);
  expect(publicPage.status()).toBe(200);

  // CHANGE-003, end to end for a business that did not exist a minute ago: the default language
  // this owner never touched reaches the generator. One free generation of the ten; the route
  // tolerates a caller with no anonymous cookie.
  const generated = await page.request.post('/api/v1/public/review/generate', {
    data: { slug: BUSINESS.slug },
  });
  expect(generated.status()).toBe(200);
  const generatedBody = (await generated.json()) as { review_text: string };
  expect(generatedBody.review_text).toMatch(/\b(?:tha|thi|aur|hai|raha|bahut|kaafi|accha|acha)\b/i);

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

  // And it resolves against the address this deployment is actually reachable at.
  //
  // This is the assertion whose absence let a QR ship encoding http://localhost:3000 — a payload
  // that is correct on the machine that generated it and blank on every phone that scans it.
  // Compared against the configured APP_BASE_URL rather than a literal, because a literal would
  // have passed then too.
  const configuredBase = process.env.APP_BASE_URL;
  expect(
    configuredBase,
    'APP_BASE_URL must be set for this assertion to mean anything',
  ).toBeTruthy();
  const base = configuredBase!.endsWith('/') ? configuredBase!.slice(0, -1) : configuredBase!;
  expect(first.resolve_url).toBe(`${base}/r/${first.code}`);

  // The dashboard names the one remaining task, which happens away from the screen: get the code
  // printed and in front of a customer. Asserted before the scan below, because that scan is
  // exactly the event that retires this guidance.
  await page.goto('/app');
  await expect(page.getByText(/one thing left/i)).toBeVisible({ timeout: 30_000 });
  const dashboardCard = page.locator('figure[aria-label^="QR card"]').first();
  await expect(dashboardCard.getByRole('img', { name: /qr code/i })).toBeVisible();
  await expect(dashboardCard.locator('[data-qr-card-part]')).toHaveCount(3);

  // The QR screen shows each source as the symbol itself, so an owner with several standees can
  // tell which row is which without downloading every one of them.
  await page.goto('/app/qr');
  await expect(page.getByRole('img', { name: new RegExp(`QR code ${first.code}`) })).toBeVisible();
  const sourceCard = page.locator(`figure[aria-label*="${first.code}"]`).first();
  await expect(sourceCard.locator('[data-qr-card-part]')).toHaveCount(3);

  // And the printed code actually resolves for a customer.
  const scan = await page.request.get(`/r/${first.code}`);
  expect(scan.status()).toBe(200);

  // Guidance, not furniture: the first scan is proof the code has reached the world, so the card
  // retires itself rather than sitting on the dashboard of an established business forever.
  await page.goto('/app');
  await expect(page.getByText(/one thing left/i)).toHaveCount(0);
});
