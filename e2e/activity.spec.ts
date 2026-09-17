import { expect, test } from '@playwright/test';
import {
  closeDb,
  demoBusinessId,
  demoOwnerDetails,
  restoreDemoOwnerDetails,
  type DemoOwnerDetails,
} from './support/db';
import { E2E_ADMIN_TOTP_SECRET, signInAdmin } from './support/totp';

/**
 * AMENDMENT-028 — "every user action is tracked": an owner signs in, edits their name and
 * downloads a QR; the admin then sees each of those on the activity explorer and on the
 * business page, with the owner's email shown and only a hash where the address would be.
 */
const OWNER = { email: 'demo-owner@example.com', password: 'demo-owner-Password1!' };
const ADMIN = { email: 'demo-admin@example.com', password: 'demo-admin-Password1!' };

test.describe('activity log', () => {
  let before: DemoOwnerDetails;

  test.beforeAll(async () => {
    before = await demoOwnerDetails();
  });

  test.afterAll(async () => {
    await restoreDemoOwnerDetails(before);
    await closeDb();
  });

  test('what the owner does shows up for the admin', async ({ page, browser }) => {
    const stamp = Date.now().toString(36);

    // — the owner, in their own browser context —
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await owner.goto('/login');
    await owner.getByLabel(/email/i).fill(OWNER.email);
    await owner.getByLabel(/password/i).fill(OWNER.password);
    await owner.getByRole('button', { name: /sign in/i }).click();
    await owner.waitForURL(/\/app/);

    // A profile edit and a QR download, through the same API the screens use.
    const origin = new URL(owner.url()).origin;
    const details = await owner.request.patch('/api/v1/account', {
      headers: { origin },
      data: { full_name: `Demo Owner ${stamp}`, email: OWNER.email, mobile: '9876543210' },
    });
    expect(details.status()).toBe(200);
    const qr = (await (await owner.request.get('/api/v1/qr')).json()) as {
      sources: Array<{ id: string }>;
    };
    expect(qr.sources.length).toBeGreaterThan(0);
    const download = await owner.request.get(`/api/v1/qr/${qr.sources[0]!.id}/download?format=svg`);
    expect(download.status()).toBe(200);
    await ownerContext.close();

    // — the admin —
    await signInAdmin(page, { ...ADMIN, totpSecret: E2E_ADMIN_TOTP_SECRET });
    const businessId = await demoBusinessId();

    // The explorer, filtered to this person. Recording is fire-and-forget after the response,
    // so the assertions poll rather than expect the rows on the first paint.
    await expect
      .poll(
        async () => {
          await page.goto(`/admin/activity?email=${encodeURIComponent(OWNER.email)}`);
          const table = page.getByRole('table', { name: 'Activity' });
          const text = await table.innerText();
          return ['account.update', 'qr.download', 'auth.login'].every((a) => text.includes(a));
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Activity');
    const table = page.getByRole('table', { name: 'Activity' });
    await expect(table.getByText(OWNER.email).first()).toBeVisible();
    // Only the hashed network address is ever rendered.
    const pageText = await page.locator('body').innerText();
    expect(pageText).not.toMatch(/\b127\.0\.0\.1\b|\b::1\b/);
    expect(pageText).toMatch(/[0-9a-f]{10}…/);

    // The same rows on the business page, scoped to that business.
    await page.goto(`/admin/businesses/${businessId}?tab=activity`);
    const owned = page.getByRole('table', { name: 'Owner activity' });
    await expect(owned.getByRole('row').filter({ hasText: 'qr.download' }).first()).toBeVisible();
    await expect(
      owned.getByRole('row').filter({ hasText: 'account.update' }).first(),
    ).toBeVisible();

    // And through the JSON API, with a prefix filter and the hash, never the address.
    const api = await page.request.get(`/api/v1/admin/activity?business=${businessId}&action=qr.`);
    expect(api.status()).toBe(200);
    const body = (await api.json()) as {
      entries: Array<{ action: string; user_email: string | null; ip_hash: string | null }>;
    };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.action.startsWith('qr.'))).toBe(true);
    expect(body.entries[0]!.user_email).toBe(OWNER.email);
    expect(body.entries[0]!.ip_hash).toMatch(/^[0-9a-f]{64}$/);

    // Bad filters are refused, not silently ignored.
    const bad = await page.request.get('/api/v1/admin/activity?outcome=MAYBE');
    expect(bad.status()).toBe(422);
  });
});
