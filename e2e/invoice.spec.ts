import { expect, test } from '@playwright/test';
import {
  arrangeDemoPaidYear,
  closeDb,
  demoBillingDetails,
  demoBusinessId,
  removeDemoPayments,
  resetDemoEntitlement,
  restoreDemoBillingDetails,
  stampDemoInvoice,
  type DemoBillingDetails,
} from './support/db';
import { E2E_ADMIN_TOTP_SECRET, signInAdmin } from './support/totp';

/**
 * AMENDMENT-029 — GST invoices. The owner gives their billing details; a settled payment
 * carries a numbered invoice with the tax split; the owner and the admin both see the same
 * document. Settling itself needs Razorpay and is proved by the integration suite; here the
 * invoice is stamped onto a fixture payment exactly as settle writes it.
 */
const OWNER = { email: 'demo-owner@example.com', password: 'demo-owner-Password1!' };
const ADMIN = { email: 'demo-admin@example.com', password: 'demo-admin-Password1!' };

async function signInOwner(page: Parameters<typeof signInAdmin>[0]) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test.describe('GST invoices', () => {
  let billingBefore: DemoBillingDetails;

  test.beforeAll(async () => {
    billingBefore = await demoBillingDetails();
  });

  test.afterEach(async () => {
    await removeDemoPayments();
    await resetDemoEntitlement();
  });

  test.afterAll(async () => {
    await restoreDemoBillingDetails(billingBefore);
    await closeDb();
  });

  test('the owner saves billing details, and a bad GSTIN is refused by the field', async ({
    page,
  }) => {
    await signInOwner(page);
    await page.goto('/app/settings');
    await page.waitForLoadState('networkidle');

    const legalName = page.getByLabel(/legal name for invoices/i);
    await legalName.fill('Digital Hammerr Cafe Pvt Ltd');
    await page.getByLabel(/^GSTIN/i).fill('not-a-gstin');
    await page.getByLabel(/GST state code/i).fill('29');
    await page.getByRole('button', { name: /save invoice details/i }).click();
    await expect(page.getByText(/15-character GSTIN/i)).toBeVisible();

    await page.getByLabel(/^GSTIN/i).fill('29aaaaa0000a1z5');
    await page.getByRole('button', { name: /save invoice details/i }).click();
    await expect(page.getByRole('status').filter({ hasText: /saved/i }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/legal name for invoices/i)).toHaveValue(
      'Digital Hammerr Cafe Pvt Ltd',
    );
    // Stored upper-cased, as a GSTIN is written.
    await expect(page.getByLabel(/^GSTIN/i)).toHaveValue('29AAAAA0000A1Z5');
    expect(await demoBillingDetails()).toMatchObject({ gstin: '29AAAAA0000A1Z5' });
  });

  test('a settled payment shows a numbered tax invoice to the owner and the admin', async ({
    page,
    browser,
  }) => {
    const paymentId = await arrangeDemoPaidYear(200);
    await stampDemoInvoice(paymentId);

    await signInOwner(page);
    await page.goto('/app/subscription');
    await page.getByRole('link', { name: 'DH/2026-27/000042' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/subscription/receipts/${paymentId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Invoice DH\/2026-27\/000042/);
    await expect(page.getByRole('heading', { name: 'Tax invoice' })).toBeVisible();
    const doc = page.getByRole('article', { name: /tax invoice/i });
    await expect(doc.getByText('29ABCDE1234F1Z5')).toBeVisible();
    await expect(doc.getByText('Digital Hammerr Cafe Pvt Ltd')).toBeVisible();
    await expect(doc.getByText('29AAAAA0000A1Z5')).toBeVisible();
    await expect(doc.getByText('CGST @ 9%')).toBeVisible();
    await expect(doc.getByText('SGST @ 9%')).toBeVisible();
    await expect(doc.getByText('₹76.19')).toBeVisible();
    await expect(doc.getByText('₹76.20')).toBeVisible();
    await expect(doc.getByText('₹846.61')).toBeVisible();
    await expect(doc.getByText('₹999.00').first()).toBeVisible();
    await expect(doc.getByText('998314')).toBeVisible();

    // The admin sees the same document, and the business page links to it.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signInAdmin(admin, { ...ADMIN, totpSecret: E2E_ADMIN_TOTP_SECRET });
    await admin.goto(`/admin/businesses/${await demoBusinessId()}?tab=billing`);
    await admin.getByRole('link', { name: 'DH/2026-27/000042' }).click();
    await expect(admin).toHaveURL(new RegExp(`/admin/payments/${paymentId}/invoice$`));
    await expect(admin.getByRole('heading', { name: 'Tax invoice' })).toBeVisible();
    await expect(admin.getByText('₹846.61')).toBeVisible();
    await expect(admin.getByText('₹999.00').first()).toBeVisible();
    await adminContext.close();
  });

  test('the seller settings screen carries the invoice fields, and refuses a bad GSTIN', async ({
    page,
  }) => {
    await signInAdmin(page, { ...ADMIN, totpSecret: E2E_ADMIN_TOTP_SECRET });
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Invoices and GST' })).toBeVisible();
    await expect(page.getByLabel(/invoice number prefix/i)).toHaveValue('DH');
    await expect(page.getByLabel(/^GST rate/i)).toHaveValue('18');
    await expect(page.getByLabel(/SAC code/i)).toHaveValue('998314');

    const refused = await page.request.patch('/api/v1/admin/settings', {
      headers: { origin: new URL(page.url()).origin },
      data: { reason: 'e2e: a malformed GSTIN', seller_gstin: 'nope' },
    });
    // 422 for the shape, or 403 asking for a fresh code — either way, nothing was written.
    expect([403, 422]).toContain(refused.status());
  });
});
