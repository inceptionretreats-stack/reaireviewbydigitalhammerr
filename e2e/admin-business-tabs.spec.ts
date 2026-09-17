import { expect, test } from '@playwright/test';
import {
  clearDemoAiControls,
  closeDb,
  demoBusinessId,
  demoQrCode,
  resetFreeQuota,
} from './support/db';
import { E2E_ADMIN_TOTP_SECRET, signInAdmin } from './support/totp';

/**
 * 19_Admin_Panel_Spec L56-66 and AMENDMENT-030: the business page as eleven tabs, and the
 * abuse controls — suspend Ai keeps the customer's page and Google button working with a safe
 * notice; restore brings drafting back; each step audited with its reason.
 */
const ADMIN = { email: 'demo-admin@example.com', password: 'demo-admin-Password1!' };

test.describe('admin business tabs and abuse controls', () => {
  test.afterEach(async () => {
    await clearDemoAiControls();
    await resetFreeQuota();
  });
  test.afterAll(async () => {
    await closeDb();
  });

  test('every tab renders its own content, and the URL is the tab', async ({ page }) => {
    const id = await demoBusinessId();
    await signInAdmin(page, { ...ADMIN, totpSecret: E2E_ADMIN_TOTP_SECRET });
    await page.goto(`/admin/businesses/${id}`);
    const nav = page.getByRole('navigation', { name: 'Business sections' });
    await expect(nav.getByRole('link')).toHaveCount(11);
    await expect(page.getByText('Ai drafts, 24 h').first()).toBeVisible();

    const expectations: Array<[string, RegExp | string]> = [
      ['Owner & account', 'Owner account'],
      ['Public profile', 'Slug history'],
      ['Ai context & modes', 'Review modes'],
      ['QR sources', 'QR sources'],
      ['Analytics', '30-day funnel'],
      ['Subscription & payments', 'Payments'],
      ['Domain', 'Custom domains'],
      ['Usage & abuse', 'Ai controls'],
      ['Activity', 'Owner activity'],
      ['Audit', 'Audit history'],
    ];
    for (const [label, marker] of expectations) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByText(marker).first()).toBeVisible();
    }
    expect(page.url()).toContain('tab=audit');
    // An unknown tab falls back to the overview rather than a blank page.
    await page.goto(`/admin/businesses/${id}?tab=nonsense`);
    await expect(page.getByText('Ai drafts, 24 h').first()).toBeVisible();
  });

  test('suspending Ai shows the customer a safe notice with the Google button; restoring brings drafting back', async ({
    page,
    browser,
  }) => {
    const id = await demoBusinessId();
    const qr = await demoQrCode();
    await resetFreeQuota();
    await signInAdmin(page, { ...ADMIN, totpSecret: E2E_ADMIN_TOTP_SECRET });
    await page.goto(`/admin/businesses/${id}?tab=usage`);

    await page.getByRole('button', { name: 'Suspend Ai' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Suspend Ai' })).toBeDisabled();
    await dialog.getByLabel(/reason/i).fill('E2E: incentive terms in the context');
    await dialog.getByRole('button', { name: 'Suspend Ai' }).click();
    await expect(page.getByRole('status').filter({ hasText: /suspend ai: done/i })).toBeVisible();
    await expect(page.getByText('suspended').first()).toBeVisible();

    // The customer: page loads, no draft, the safe notice, and the Google link intact.
    const customer = await (await browser.newContext()).newPage();
    await customer.goto(`/r/${qr}`);
    await expect(
      customer.getByRole('heading', { name: 'Digital Hammerr', exact: true }),
    ).toBeVisible();
    const notice = customer.getByRole('alert').filter({ hasText: /writing assistant/i });
    await expect(notice).toContainText(/writing assistant is unavailable/i, { timeout: 30_000 });
    await expect(notice).not.toContainText(/suspend|admin|abuse/i);
    await expect(
      customer.getByRole('link', { name: /write your own review on google/i }),
    ).toBeVisible();
    const refused = await customer.request.post('/api/v1/public/review/generate', {
      data: { slug: 'demo-south-cafe' },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('AI_SUSPENDED');
    await customer.context().close();

    // Restore, and the audit tab shows both actions with their reasons.
    await page.getByRole('button', { name: 'Restore Ai' }).click();
    await page
      .getByRole('dialog')
      .getByLabel(/reason/i)
      .fill('E2E: owner fixed the context');
    await page.getByRole('dialog').getByRole('button', { name: 'Restore Ai' }).click();
    await expect(page.getByRole('status').filter({ hasText: /restore ai: done/i })).toBeVisible();
    const back = await page.request.post('/api/v1/public/review/generate', {
      data: { slug: 'demo-south-cafe' },
    });
    expect(back.status()).toBe(200);

    await page.goto(`/admin/businesses/${id}?tab=audit`);
    await expect(page.getByText('business.ai.suspend').first()).toBeVisible();
    await expect(page.getByText('business.ai.restore').first()).toBeVisible();
    await expect(page.getByText(/incentive terms in the context/).first()).toBeVisible();

    // A viewer-style refusal: the action without a reason is refused at the API.
    const noReason = await page.request.patch(`/api/v1/admin/businesses/${id}`, {
      headers: { origin: new URL(page.url()).origin },
      data: { action: 'suspend_ai', reason: '' },
    });
    expect(noReason.status()).toBe(422);
    await resetFreeQuota();
  });

  test('a throttle limits drafts per hour and is lifted', async ({ page }) => {
    const id = await demoBusinessId();
    await resetFreeQuota();
    await signInAdmin(page, { ...ADMIN, totpSecret: E2E_ADMIN_TOTP_SECRET });
    const origin = new URL(page.url()).origin;
    const throttled = await page.request.patch(`/api/v1/admin/businesses/${id}`, {
      headers: { origin },
      data: { action: 'throttle', reason: 'E2E: throttle to two an hour', per_hour: 2, hours: 1 },
    });
    expect(throttled.status()).toBe(200);
    // Each generation is a fresh anonymous session, so only the per-business ceiling bites.
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const ctx = await page.context().browser()!.newContext();
      const r = await ctx.request.post('/api/v1/public/review/generate', {
        data: { slug: 'demo-south-cafe' },
      });
      statuses.push(r.status());
      await ctx.close();
    }
    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    expect(statuses[2]).toBe(429);

    const lifted = await page.request.patch(`/api/v1/admin/businesses/${id}`, {
      headers: { origin },
      data: { action: 'unthrottle', reason: 'E2E: lift' },
    });
    expect(lifted.status()).toBe(200);
    await page.goto(`/admin/businesses/${id}?tab=usage`);
    await expect(page.getByText('none', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Throttle' })).toBeVisible();
    await resetFreeQuota();
  });
});
