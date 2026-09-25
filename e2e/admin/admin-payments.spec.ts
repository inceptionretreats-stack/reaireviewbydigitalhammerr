import { expect, test } from '@playwright/test';
import {
  arrangeDemoOpenCheckout,
  arrangeDemoPaidYear,
  closeDb,
  paymentAudit,
  removeDemoPayments,
  resetDemoEntitlement,
  stampDemoInvoice,
} from '../support/db';
import { E2E_ADMIN_TOTP_SECRET, signInAdmin } from '../support/totp';

/**
 * AMENDMENT-029 — payment control. Razorpay keys are absent in the suite, so a refund is
 * refused as PAYMENTS_NOT_CONFIGURED before anything is recorded; the actions that need no
 * gateway — mark failed, resend receipt — run and are audited.
 */
const ADMIN = { email: 'demo-admin@example.com', password: 'demo-admin-Password1!' };

test.describe('admin payments', () => {
  test.afterEach(async () => {
    await removeDemoPayments();
    await resetDemoEntitlement();
  });
  test.afterAll(async () => {
    await closeDb();
  });

  test('lists across tenants, filters, opens the drawer, and marks an abandoned checkout failed', async ({
    page,
  }) => {
    const paid = await arrangeDemoPaidYear(100);
    await stampDemoInvoice(paid, 'DH/2026-27/000077');
    const open = await arrangeDemoOpenCheckout();

    await signInAdmin(page, { ...ADMIN, totpSecret: E2E_ADMIN_TOTP_SECRET });
    await page.goto('/admin/payments');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Payments');
    const table = page.getByRole('table', { name: 'Payments' });
    await expect(table.getByRole('row').filter({ hasText: 'CAPTURED' }).first()).toBeVisible();
    await expect(table.getByRole('link', { name: 'DH/2026-27/000077' })).toBeVisible();

    // Filter to open checkouts only.
    await page.goto('/admin/payments?status=CREATED');
    await expect(table.getByRole('row').filter({ hasText: 'CREATED' })).toHaveCount(1);
    await expect(table.getByRole('row').filter({ hasText: 'CAPTURED' })).toHaveCount(0);

    // The drawer for the open one, and "mark failed" with a reason.
    await table.getByRole('button', { name: 'Open' }).first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('order_E2EOpen0001')).toBeVisible();
    await drawer.getByRole('button', { name: 'Mark failed' }).click();
    const modal = page.getByRole('dialog', { name: /mark this checkout failed/i });
    await modal.getByLabel(/reason/i).fill('E2E: abandoned checkout');
    await modal.getByRole('button', { name: 'Mark failed' }).click();
    await expect(drawer.getByRole('status')).toHaveText(/marked failed/i);
    expect(await paymentAudit(open)).toEqual(['payment.mark_failed']);

    // Marking it failed again is refused at the API — the state has moved on.
    const again = await page.request.post(`/api/v1/admin/payments/${open}/actions`, {
      headers: { origin: new URL(page.url()).origin },
      data: { action: 'mark_failed', reason: 'again' },
    });
    expect(again.status()).toBe(409);
  });

  test('a refund without Razorpay keys is refused before anything is written; the JSON API agrees', async ({
    page,
  }) => {
    const paid = await arrangeDemoPaidYear(100);
    await signInAdmin(page, { ...ADMIN, totpSecret: E2E_ADMIN_TOTP_SECRET });
    const origin = new URL(page.url()).origin;

    const refund = await page.request.post(`/api/v1/admin/payments/${paid}/refund`, {
      headers: { origin },
      data: { reason: 'E2E: refund attempt', amount_paise: 10000 },
    });
    // Step-up is fresh right after sign-in, so the answer is the missing gateway.
    expect(refund.status()).toBe(503);
    expect(((await refund.json()) as { error: { code: string } }).error.code).toBe(
      'PAYMENTS_NOT_CONFIGURED',
    );
    expect(await paymentAudit(paid)).toEqual([]);

    const noReason = await page.request.post(`/api/v1/admin/payments/${paid}/refund`, {
      headers: { origin },
      data: { reason: '' },
    });
    expect(noReason.status()).toBe(422);

    const detail = await page.request.get(`/api/v1/admin/payments/${paid}`);
    expect(detail.status()).toBe(200);
    const body = (await detail.json()) as {
      payment: { status: string; amount_paise: number };
      funds_current_period: boolean;
      refunds: unknown[];
    };
    expect(body.payment).toMatchObject({ status: 'CAPTURED', amount_paise: 99900 });
    expect(body.refunds).toEqual([]);

    const list = await page.request.get('/api/v1/admin/payments?status=CAPTURED');
    expect(list.status()).toBe(200);
    const ledger = await page.request.get('/api/v1/admin/payments/webhooks');
    expect(ledger.status()).toBe(200);
    const bad = await page.request.get('/api/v1/admin/payments?status=MAYBE');
    expect(bad.status()).toBe(422);

    // The webhook ledger tab renders.
    await page.goto('/admin/payments?tab=webhooks');
    await expect(page.getByRole('table', { name: 'Webhook deliveries' })).toBeVisible();
  });
});
