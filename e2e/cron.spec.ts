import { expect, test } from '@playwright/test';
import {
  arrangeDemoPaidYear,
  clearDemoReminders,
  closeDb,
  demoReminders,
  demoSubscriptionStatus,
  demoSystemAudit,
  removeDemoPayments,
  resetDemoEntitlement,
} from './support/db';

/**
 * AMENDMENT-029 — the daily sweep behind /api/cron/subscriptions: the bearer, a lapsed year
 * becoming EXPIRED with a system audit row, a reminder queued once, and idempotency.
 */
const OWNER = { email: 'demo-owner@example.com', password: 'demo-owner-Password1!' };
const SECRET = process.env.CRON_SECRET;

test.describe('subscription cron', () => {
  test.skip(!SECRET, 'CRON_SECRET is not set in the suite environment');

  test.afterEach(async () => {
    await clearDemoReminders();
    await removeDemoPayments();
    await resetDemoEntitlement();
  });
  test.afterAll(async () => {
    await closeDb();
  });

  test('refuses without the bearer, expires a lapsed year exactly once, queues a reminder once', async ({
    page,
  }) => {
    const auth = { Authorization: `Bearer ${SECRET}` };
    expect((await page.request.get('/api/cron/subscriptions')).status()).toBe(401);
    expect(
      (
        await page.request.get('/api/cron/subscriptions', {
          headers: { Authorization: 'Bearer wrong' },
        })
      ).status(),
    ).toBe(401);

    // A year that ended yesterday.
    await arrangeDemoPaidYear(-1);
    const before = await demoSystemAudit('subscription.expire');
    const run = await page.request.get('/api/cron/subscriptions', { headers: auth });
    expect(run.status()).toBe(200);
    const summary = (await run.json()) as { expired: number; mail: string };
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(await demoSubscriptionStatus()).toBe('EXPIRED');
    expect(await demoSystemAudit('subscription.expire')).toBe(before + 1);
    expect((await demoReminders()).map((r) => r.kind)).toEqual(['EXPIRED']);

    // Running again changes nothing.
    await page.request.get('/api/cron/subscriptions', { headers: auth });
    expect(await demoSystemAudit('subscription.expire')).toBe(before + 1);
    expect((await demoReminders()).map((r) => r.kind)).toEqual(['EXPIRED']);

    // The owner sees the free allowance and the upgrade again.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(OWNER.email);
    await page.getByLabel(/password/i).fill(OWNER.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/subscription');
    await expect(page.getByText(/Your Pro year has ended/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Upgrade — ₹999\/year/ })).toBeVisible();

    // A year with six days left queues exactly one T7, twice over.
    await clearDemoReminders();
    await removeDemoPayments();
    await arrangeDemoPaidYear(6);
    await page.request.get('/api/cron/subscriptions', { headers: auth });
    await page.request.get('/api/cron/subscriptions', { headers: auth });
    expect((await demoReminders()).map((r) => r.kind)).toEqual(['T7']);
    expect(await demoSubscriptionStatus()).toBe('PRO_ACTIVE');
  });
});
