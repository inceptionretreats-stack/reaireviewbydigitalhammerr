import { spawnSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { closeDb, demoBusinessId, resetDemoEntitlement } from './support/db';
import { E2E_ADMIN_TOTP_SECRET, signInAdmin } from './support/totp';

/**
 * ADMIN-01/02/04 and RBAC rules 4 and 5, driven the way an operator uses them.
 *
 * The one thing this suite exists to prove: a business gets onto Pro through a screen, with a
 * reason, and the record of it is written — not through SQL. Before this, the only path was
 * a hand-typed UPDATE, which is how the first hundred businesses would have been "onboarded".
 */

const ADMIN = { email: 'demo-admin@example.com', password: 'demo-admin-Password1!' };
const OWNER = { email: 'demo-owner@example.com', password: 'demo-owner-Password1!' };

/**
 * AMENDMENT-027: an admin passes the MFA challenge after the password; an owner does not have
 * one. The admin's authenticator is armed by create-admin below with a secret the suite knows.
 */
async function signIn(page: Page, who: { email: string; password: string }): Promise<void> {
  if (who.email === ADMIN.email) {
    await signInAdmin(page, { ...who, totpSecret: E2E_ADMIN_TOTP_SECRET });
    return;
  }
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => /\/(admin|app)/.test(url.pathname));
}

test.describe('platform admin', () => {
  test.beforeAll(() => {
    // The seed gives the admin an unusable password; `pnpm admin:create` is the operator's
    // tool, and running it here is how a fresh database gets an admin the suite can use.
    const created = spawnSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/create-admin.mjs',
        '--email',
        ADMIN.email,
        '--password',
        ADMIN.password,
        '--name',
        'Demo Admin',
        '--reason',
        'E2E suite',
        '--totp-secret',
        E2E_ADMIN_TOTP_SECRET,
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } },
    );
    if (created.status !== 0) throw new Error(`create-admin failed: ${created.stderr}`);
  });

  test.beforeEach(async () => {
    await resetDemoEntitlement();
  });

  test.afterAll(async () => {
    await resetDemoEntitlement();
    await closeDb();
  });

  test('an admin lands on /admin and is kept out of the owner workspace', async ({ page }) => {
    await signIn(page, ADMIN);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: /platform overview/i })).toBeVisible();

    await page.goto('/app');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('admin navigation stays usable on a narrow phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, ADMIN);

    const navigation = page.getByRole('navigation', { name: 'Admin' });
    const menu = navigation.getByRole('button', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await navigation.getByRole('link', { name: 'Businesses' }).click();
    await expect(page).toHaveURL(/\/admin\/businesses$/);
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('heading', { name: /businesses/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );

    if (process.env.RESPONSIVE_QA_SCREENSHOT) {
      await page.screenshot({ path: process.env.RESPONSIVE_QA_SCREENSHOT });
    }
  });

  test('admin pages do not overflow phone or tablet viewports', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 320, height: 740 });
    await signIn(page, ADMIN);

    const routes = [
      '/admin',
      '/admin/businesses',
      '/admin/payments',
      '/admin/activity',
      '/admin/ai',
      '/admin/settings',
      '/admin/team',
      '/admin/audit',
    ];
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 740 });
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator('#admin-content')).toBeVisible();
        const layout = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          overflowingElements: [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 8)
            .map((element) => ({
              tag: element.tagName,
              className: element.className,
              right: Math.round(element.getBoundingClientRect().right),
            })),
        }));
        expect(
          layout.documentWidth,
          `${route} at ${width}px: ${JSON.stringify(layout.overflowingElements)}`,
        ).toBeLessThanOrEqual(width);
      }
    }
  });

  test('an owner is refused by the admin area and API', async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/app$/);

    const refused = await page.request.get('/api/v1/admin/businesses');
    expect(refused.status()).toBe(403);
  });

  test('activates Pro for a business with a reason, audited, and the plan flips live', async ({
    page,
  }) => {
    const businessId = await demoBusinessId();
    await signIn(page, ADMIN);

    await page.goto('/admin/businesses?q=demo-south-cafe');
    const demoLink = page.locator(`a[href="/admin/businesses/${businessId}"]`);
    await expect(demoLink).toHaveText('Digital Hammerr');
    await demoLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/businesses/${businessId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Free');

    await page.getByRole('button', { name: /activate or extend pro/i }).click();
    const confirm = page.getByRole('button', { name: /^activate pro$/i });
    // RBAC rule 5: no reason, no action. The button is disabled, not merely validated after.
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/^reason/i).fill('Launch partner — first year comped');
    await page.getByLabel(/note for the record/i).fill('Agreed on a call');
    await confirm.click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    // Visually distinct from a paid year (19_Admin_Panel_Spec); the audit row is on the Audit
    // tab and the grant note on Subscription & payments (the page is tabbed since WP8).
    await expect(page.getByText('Pro — granted by admin').first()).toBeVisible();
    await page.getByRole('link', { name: 'Subscription & payments', exact: true }).click();
    await expect(page.getByText(/agreed on a call/i).first()).toBeVisible();
    await page.getByRole('link', { name: 'Audit', exact: true }).click();
    await expect(page.getByText('business.entitlement.adjust').first()).toBeVisible();
    await expect(page.getByText(/first year comped/).first()).toBeVisible();

    // The change is real to the quota engine, not just to the admin's screen: a customer
    // generation is now counted against the Pro allowance.
    const generated = await page.request.post('/api/v1/public/review/generate', {
      data: { slug: 'demo-south-cafe', selected_services: ['Website development'] },
    });
    expect(generated.status()).toBe(200);
    await page.getByRole('link', { name: 'Subscription & payments', exact: true }).click();
    await expect(page.getByText(/1 of 2000 this year/)).toBeVisible();
  });

  test('refuses an admin action without a reason at the API', async ({ page }) => {
    const businessId = await demoBusinessId();
    await signIn(page, ADMIN);
    const response = await page.request.patch(`/api/v1/admin/businesses/${businessId}`, {
      data: { action: 'suspend', reason: '' },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(response.status()).toBe(422);
    expect((await response.json()).error.code).toBe('ADMIN_REASON_REQUIRED');
  });

  /**
   * ADMIN-03 / ADR-006: the writing rules are data. Clone the active version, change a rule,
   * activate — the next generation is written by the new version, and rolling back is one
   * more activation. No deploy, no restart, no SQL.
   */
  test('edits the writing rules as a new prompt version, activates it, and rolls back', async ({
    page,
  }) => {
    await signIn(page, ADMIN);
    await page.goto('/admin/ai');
    const activeRow = page.getByRole('row').filter({ hasText: 'ACTIVE' }).first();
    const activeVersion = (await activeRow.getByRole('link').first().innerText()).trim();
    await activeRow.getByRole('link').first().click();
    await expect(page.getByLabel(/^model$/i)).toHaveAttribute('readonly', '');

    const newVersion = `9.${Date.now() % 100000}.0`;
    await page.getByRole('button', { name: /new draft from this version/i }).click();
    await page.getByLabel(/new version number/i).fill(newVersion);
    await page.getByRole('button', { name: /^create draft$/i }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(newVersion);

    const rules = page.getByLabel(/hinglish rules/i);
    await rules.fill((await rules.inputValue()) + '\n- E2E test rule.');
    await page.getByRole('button', { name: /save draft/i }).click();
    await expect(page.getByRole('status')).toHaveText(/draft saved/i);

    await page.getByRole('button', { name: /^activate$/i }).click();
    await page
      .getByRole('dialog')
      .getByLabel(/^reason/i)
      .fill('E2E: activate edited rules');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^activate$/i })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    const generated = await page.request.post('/api/v1/public/review/generate', {
      data: { slug: 'demo-south-cafe', selected_services: ['Website development'] },
    });
    expect(generated.status()).toBe(200);
    expect(((await generated.json()) as { prompt_version: string }).prompt_version).toBe(
      newVersion,
    );

    // Roll back through the same screen, and the next generation follows.
    await page.goto('/admin/ai');
    await page.getByRole('link', { name: activeVersion, exact: true }).click();
    await page.getByRole('button', { name: /roll back to this version/i }).click();
    await page
      .getByRole('dialog')
      .getByLabel(/^reason/i)
      .fill('E2E: roll back');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^activate$/i })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const after = await page.request.post('/api/v1/public/review/generate', {
      data: { slug: 'demo-south-cafe', selected_services: ['Website development'] },
    });
    expect(((await after.json()) as { prompt_version: string }).prompt_version).toBe(activeVersion);
  });

  test('platform settings are versioned and audited', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/admin/settings');
    const free = page.getByLabel(/free ai drafts per new business/i);
    await expect(free).toHaveValue('10');

    await free.fill('12');
    await page.getByLabel(/reason for this change/i).fill('E2E: launch allowance');
    await page.getByRole('button', { name: /save settings/i }).click();
    await expect(page.getByRole('status')).toHaveText(/saved/i);

    await page.goto('/admin/audit');
    await expect(page.getByText('platform_settings.update').first()).toBeVisible();
    await expect(page.getByText(/E2E: launch allowance/).first()).toBeVisible();

    // Back to the spec default, through the same screen, so the next run starts clean.
    await page.goto('/admin/settings');
    await page.getByLabel(/free ai drafts per new business/i).fill('10');
    await page.getByLabel(/reason for this change/i).fill('E2E: restore default');
    await page.getByRole('button', { name: /save settings/i }).click();
    await expect(page.getByRole('status')).toHaveText(/saved/i);
  });
});
