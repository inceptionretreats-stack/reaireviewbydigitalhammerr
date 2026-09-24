import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  arrangeDemoPaidYear,
  closeDb,
  demoSubscriptionStatus,
  removeDemoPayments,
  resetDemoEntitlement,
  setDemoSubscriptionStatus,
} from '../support/db';

/**
 * SUB-01 and the paid path's boundary (E10, AC-015, AC-016).
 *
 * The dev server this suite runs against has no Razorpay keys, which is a real deployment
 * state — admin activation exists, so online payment is optional. What can be proved here is
 * therefore: the five screen states from the spec, the button doing the honest thing when
 * payment is not set up, and the two public-facing endpoints refusing to activate anything
 * for a request that does not verify. The configured path — order, signature, webhook,
 * redelivery — is proved against the real schema in
 * packages/core/src/__tests__/integration/checkout-service.test.ts.
 */

const OWNER = { email: 'demo-owner@example.com', password: 'demo-owner-Password1!' };

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test.describe('subscription', () => {
  test.beforeEach(async () => {
    await resetDemoEntitlement();
    await removeDemoPayments();
  });

  test.afterAll(async () => {
    await resetDemoEntitlement();
    await removeDemoPayments();
    await closeDb();
  });

  test('free state: the plan, the allowance, and an upgrade that says what it can do', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Subscription' }).click();
    await expect(page).toHaveURL(/\/app\/subscription$/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your plan');
    // The badge is a glyph plus the word, so the word is matched at the end of the badge text.
    await expect(page.locator('dd').getByText(/^\W?Free$/)).toBeVisible();
    await expect(page.getByText(/0 of 10 used · 10 left/)).toBeVisible();
    await expect(page.getByText('No payments yet')).toBeVisible();

    // Without keys the button is still there — the owner should not have to guess whether Pro
    // exists — and pressing it says plainly what to do instead of failing.
    const upgrade = page.getByRole('button', { name: /Upgrade — ₹999\/year/ });
    await expect(upgrade).toBeVisible();
    await upgrade.click();
    await expect(page.getByRole('status').filter({ hasText: /not set up/i })).toBeVisible();
    expect(await demoSubscriptionStatus()).toBe('FREE');
  });

  test('the dashboard card points at the subscription screen', async ({ page }) => {
    await signIn(page);
    await page.goto('/app');
    await page.getByRole('link', { name: /upgrade to pro/i }).click();
    await expect(page).toHaveURL(/\/app\/subscription$/);
  });

  test('paid state: expiry, days left, renewal inside the window, and a receipt', async ({
    page,
  }) => {
    const paymentId = await arrangeDemoPaidYear(20);
    await signIn(page);
    await page.goto('/app/subscription');

    await expect(page.locator('dd').getByText(/^\W?Pro$/)).toBeVisible();
    await expect(page.getByText(/20 days left/)).toBeVisible();
    await expect(page.getByText(/0 of 2,000 used/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Renew — ₹999\/year/ })).toBeVisible();

    // The captured payment is in the history with its receipt.
    await expect(page.getByText('pay_E2EFixture0001')).toBeVisible();
    await page.getByRole('link', { name: /download receipt/i }).click();
    await expect(page).toHaveURL(new RegExp(`/app/subscription/receipts/${paymentId}$`));
    await expect(page.getByRole('heading', { name: /payment receipt/i })).toBeVisible();
    await expect(page.getByText('₹999').first()).toBeVisible();
    await expect(page.getByText('pay_E2EFixture0001')).toBeVisible();
    await expect(page.getByText(/Ai Review Pro — one year/)).toBeVisible();
    await expect(page.getByRole('button', { name: /download or print/i })).toBeVisible();

    // A receipt id that is not this tenant's is not found, not someone else's invoice.
    const other = await page.request.get(
      '/app/subscription/receipts/00000000-0000-4000-8000-000000000000',
    );
    expect(other.status()).toBe(404);
  });

  test('paid state outside the renewal window offers no button and says when it opens', async ({
    page,
  }) => {
    await arrangeDemoPaidYear(200);
    await signIn(page);
    await page.goto('/app/subscription');
    await expect(page.getByText(/200 days left/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Renew/ })).toHaveCount(0);
    await expect(page.getByText(/Renewal opens 30 days before/)).toBeVisible();
  });

  test('expired state falls back to the free allowance and offers the upgrade again', async ({
    page,
  }) => {
    await arrangeDemoPaidYear(-3);
    // The quota engine reverts an ended year to EXPIRED on its next read; the screen must not
    // wait for that to say the right thing, so arrange the status the engine would write.
    await setDemoSubscriptionStatus('EXPIRED');

    await signIn(page);
    await page.goto('/app/subscription');
    await expect(page.locator('dd').getByText(/^\W?Expired$/)).toBeVisible();
    await expect(page.getByText(/Your Pro year has ended/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Upgrade — ₹999\/year/ })).toBeVisible();
  });

  test('a forged verification or webhook activates nothing (AC-016)', async ({ page }) => {
    await signIn(page);
    const origin = new URL(page.url()).origin;

    // The checkout callback with a signature computed with a secret that is not the key secret.
    const forgedSignature = createHmac('sha256', 'not-the-secret')
      .update('order_Forged00001|pay_Forged00001')
      .digest('hex');
    const verify = await page.request.post('/api/v1/subscription/verify', {
      headers: { origin },
      data: {
        razorpay_order_id: 'order_Forged00001',
        razorpay_payment_id: 'pay_Forged00001',
        razorpay_signature: forgedSignature,
      },
    });
    expect(verify.ok()).toBe(false);
    expect([400, 503]).toContain(verify.status());

    // A webhook with a made-up signature, and one with none at all.
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_Forged00001',
            order_id: 'order_Forged00001',
            amount: 99900,
            status: 'captured',
          },
        },
      },
    });
    for (const signature of ['ab'.repeat(32), null]) {
      const webhook = await page.request.post('/api/v1/webhooks/razorpay', {
        headers: {
          'content-type': 'application/json',
          ...(signature ? { 'x-razorpay-signature': signature } : {}),
        },
        data: body,
      });
      expect(webhook.ok()).toBe(false);
    }

    expect(await demoSubscriptionStatus()).toBe('FREE');
    await page.goto('/app/subscription');
    await expect(page.getByText('No payments yet')).toBeVisible();
  });
});
