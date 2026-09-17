import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { CheckoutError, CheckoutService } from '../../billing/checkout-service';
import { RazorpayClient, signCheckout, signWebhookBody } from '../../billing/razorpay';
import { PlatformSettingsService } from '../../platform/settings';

/**
 * The paid path onto Pro against the real schema (AC-015, AC-016). Razorpay itself is a fake
 * Orders endpoint; the signatures are computed locally with the same secrets the service is
 * given, which is exactly what Razorpay does on its side.
 */
describe('CheckoutService', () => {
  let pool: Pool;
  let db: Database;
  let ownerId: string;
  let businessId: string;
  let orderCounter = 0;

  const secrets = { keySecret: 'ks_' + randomUUID(), webhookSecret: 'ws_' + randomUUID() };

  const fakeRazorpay = () =>
    new RazorpayClient({
      keyId: 'rzp_test_fake',
      keySecret: secrets.keySecret,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body ?? '{}') as { amount: number; currency: string };
        orderCounter += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: `order_fake_${orderCounter}_${randomUUID().slice(0, 8)}`,
              amount: body.amount,
              currency: body.currency,
              status: 'created',
            }),
        };
      },
    });

  const capturedWebhook = (orderId: string, paymentId: string, amount: number, eventId: string) => {
    const rawBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } },
      },
    });
    return {
      rawBody,
      signature: signWebhookBody(rawBody, secrets.webhookSecret),
      eventId,
      secrets,
    };
  };

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 8 });
    db = createDatabase({ connectionString, poolMax: 8 });
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM payments WHERE business_id IN
         (SELECT id FROM businesses WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1))`,
      ['checkout-%@example.test'],
    );
    await pool.query(
      `DELETE FROM payment_webhook_events WHERE provider_event_id LIKE 'evt_checkout_test_%'`,
    );
    // The invoice test writes platform-settings audit rows as the fixture owner.
    await pool.query(
      `DELETE FROM admin_audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE $1)
         OR business_id IN (SELECT id FROM businesses WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1))`,
      ['checkout-%@example.test'],
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['checkout-%@example.test']);
    await pool.end();
  });

  beforeEach(async () => {
    ownerId = randomUUID();
    businessId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, 'Checkout Owner', 'x', 'BUSINESS_OWNER')`,
      [ownerId, `checkout-owner-${ownerId}@example.test`],
    );
    await pool.query(
      `INSERT INTO businesses (id, owner_user_id, name, category, status)
       VALUES ($1, $2, 'Checkout Co', 'Cafe', 'ACTIVE')`,
      [businessId, ownerId],
    );
    await pool.query(
      `INSERT INTO subscriptions (business_id, status, free_generation_limit, free_generations_used)
       VALUES ($1, 'FREE', 10, 10)`,
      [businessId],
    );
  });

  async function subscription() {
    const { rows } = await pool.query(
      `SELECT status, entitlement_source, entitlement_note, starts_at, expires_at, pro_generations_used
         FROM subscriptions WHERE business_id = $1`,
      [businessId],
    );
    return rows[0] as {
      status: string;
      entitlement_source: string;
      entitlement_note: string | null;
      starts_at: Date | null;
      expires_at: Date | null;
      pro_generations_used: number;
    };
  }

  it('starts a checkout as a CREATED payment for the platform price, touching nothing else', async () => {
    const service = new CheckoutService(db);
    const started = await service.startCheckout({
      businessId,
      client: fakeRazorpay(),
      amountPaise: 99900,
    });

    expect(started.orderId).toMatch(/^order_fake_/);
    expect(started.amountPaise).toBe(99900);
    const [row] = await service.history(businessId);
    expect(row).toMatchObject({
      id: started.paymentId,
      providerOrderId: started.orderId,
      status: 'CREATED',
      amountPaise: 99900,
      providerPaymentId: null,
      paidAt: null,
    });
    expect((await subscription()).status).toBe('FREE');
  });

  it('activates Pro exactly once across the browser callback and a redelivered webhook', async () => {
    const service = new CheckoutService(db);
    const started = await service.startCheckout({
      businessId,
      client: fakeRazorpay(),
      amountPaise: 99900,
    });
    const razorpayPaymentId = `pay_${randomUUID().slice(0, 12)}`;

    // 1. The browser callback, verified by the checkout signature.
    const completed = await service.completeCheckout({
      businessId,
      orderId: started.orderId,
      paymentId: razorpayPaymentId,
      signature: signCheckout(started.orderId, razorpayPaymentId, secrets.keySecret),
      secrets,
    });
    expect(completed.activated).toBe(true);
    expect(completed.payment.status).toBe('CAPTURED');
    expect(completed.payment.providerPaymentId).toBe(razorpayPaymentId);

    const afterCallback = await subscription();
    expect(afterCallback.status).toBe('PRO_ACTIVE');
    expect(afterCallback.entitlement_source).toBe('PAYMENT');
    expect(afterCallback.entitlement_note).toBe(`payment:${started.paymentId}`);
    const firstExpiry = afterCallback.expires_at!.getTime();

    // 2. Razorpay's own notification for the same payment arrives afterwards.
    const eventId = `evt_checkout_test_${randomUUID()}`;
    const webhook = capturedWebhook(started.orderId, razorpayPaymentId, 99900, eventId);
    const first = await service.handleWebhook(webhook);
    expect(first).toMatchObject({
      status: 'processed',
      event: 'payment.captured',
      activated: false,
      businessId,
    });

    // 3. And is redelivered — the ledger stops it before it reads anything.
    const second = await service.handleWebhook(webhook);
    expect(second).toEqual({ status: 'duplicate', event: 'payment.captured', activated: false });

    const afterWebhooks = await subscription();
    expect(afterWebhooks.expires_at!.getTime()).toBe(firstExpiry);
    const { rows } = await pool.query(
      `SELECT processed_at, processing_error FROM payment_webhook_events WHERE provider_event_id = $1`,
      [eventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].processed_at).not.toBeNull();
    expect(rows[0].processing_error).toBeNull();
  });

  it('activates from the webhook alone when the browser never calls back', async () => {
    const service = new CheckoutService(db);
    const started = await service.startCheckout({
      businessId,
      client: fakeRazorpay(),
      amountPaise: 99900,
    });
    const razorpayPaymentId = `pay_${randomUUID().slice(0, 12)}`;

    const outcome = await service.handleWebhook(
      capturedWebhook(
        started.orderId,
        razorpayPaymentId,
        99900,
        `evt_checkout_test_${randomUUID()}`,
      ),
    );
    expect(outcome).toMatchObject({
      status: 'processed',
      event: 'payment.captured',
      activated: true,
      businessId,
    });
    const [row] = await service.history(businessId);
    expect(row).toMatchObject({ status: 'CAPTURED', providerPaymentId: razorpayPaymentId });
    expect((await subscription()).status).toBe('PRO_ACTIVE');
  });

  it('refuses a forged or mismatched callback without touching the entitlement', async () => {
    const service = new CheckoutService(db);
    const started = await service.startCheckout({
      businessId,
      client: fakeRazorpay(),
      amountPaise: 99900,
    });

    await expect(
      service.completeCheckout({
        businessId,
        orderId: started.orderId,
        paymentId: 'pay_forged',
        signature: signCheckout(started.orderId, 'pay_forged', 'not the key secret'),
        secrets,
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_VERIFICATION_FAILED' });

    // A valid signature for an order that belongs to someone else.
    await expect(
      service.completeCheckout({
        businessId: randomUUID(),
        orderId: started.orderId,
        paymentId: 'pay_theirs',
        signature: signCheckout(started.orderId, 'pay_theirs', secrets.keySecret),
        secrets,
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_MISMATCH' });

    // An order this platform never created.
    await expect(
      service.completeCheckout({
        businessId,
        orderId: 'order_unknown',
        paymentId: 'pay_x',
        signature: signCheckout('order_unknown', 'pay_x', secrets.keySecret),
        secrets,
      }),
    ).rejects.toBeInstanceOf(CheckoutError);

    expect((await subscription()).status).toBe('FREE');
    const [row] = await service.history(businessId);
    expect(row!.status).toBe('CREATED');
  });

  it('rejects a webhook with a bad signature, and one whose amount does not match the order', async () => {
    const service = new CheckoutService(db);
    const started = await service.startCheckout({
      businessId,
      client: fakeRazorpay(),
      amountPaise: 99900,
    });

    const forged = capturedWebhook(
      started.orderId,
      'pay_f',
      99900,
      `evt_checkout_test_${randomUUID()}`,
    );
    expect(
      await service.handleWebhook({
        ...forged,
        signature: signWebhookBody(forged.rawBody, 'other secret'),
      }),
    ).toEqual({ status: 'rejected', event: null, activated: false });

    const short = capturedWebhook(
      started.orderId,
      'pay_s',
      100,
      `evt_checkout_test_${randomUUID()}`,
    );
    expect(await service.handleWebhook(short)).toEqual({
      status: 'failed',
      event: 'payment.captured',
      activated: false,
      error: 'AMOUNT_MISMATCH',
    });
    // The ledger row records the failure for an operator to read.
    const { rows } = await pool.query(
      `SELECT processing_error FROM payment_webhook_events WHERE provider_event_id = $1`,
      [short.eventId],
    );
    expect(rows[0].processing_error).toContain('AMOUNT_MISMATCH');

    // An order Razorpay knows and this platform never created — a payment made from the
    // Razorpay dashboard, say — is recorded and failed, not thrown.
    const stranger = capturedWebhook(
      'order_not_ours',
      'pay_n',
      99900,
      `evt_checkout_test_${randomUUID()}`,
    );
    expect((await service.handleWebhook(stranger)).status).toBe('failed');

    expect((await subscription()).status).toBe('FREE');
  });

  it('processes a redelivery of an event whose first delivery failed, once the cause is gone', async () => {
    const service = new CheckoutService(db);
    const eventId = `evt_checkout_test_${randomUUID()}`;
    // Razorpay delivers a capture for an order this platform does not know yet — its own
    // INSERT of the payment row has not committed, say. The delivery is recorded as failed.
    const orderId = `order_fake_late_${randomUUID().slice(0, 8)}`;
    const webhook = capturedWebhook(orderId, 'pay_late', 99900, eventId);
    expect((await service.handleWebhook(webhook)).status).toBe('failed');

    await pool.query(
      `INSERT INTO payments (business_id, provider, provider_order_id, amount_paise, currency, status)
       VALUES ($1, 'RAZORPAY', $2, 99900, 'INR', 'CREATED')`,
      [businessId, orderId],
    );
    // The same event id again: not a duplicate, because the first attempt did not succeed.
    expect(await service.handleWebhook(webhook)).toMatchObject({
      status: 'processed',
      event: 'payment.captured',
      activated: true,
      businessId,
    });
    expect((await subscription()).status).toBe('PRO_ACTIVE');
    // And now it is.
    expect((await service.handleWebhook(webhook)).status).toBe('duplicate');
    const { rows } = await pool.query(
      `SELECT processing_error FROM payment_webhook_events WHERE provider_event_id = $1`,
      [eventId],
    );
    expect(rows[0].processing_error).toBeNull();
  });

  it('marks the payment FAILED on payment.failed and ignores events it does not act on', async () => {
    const service = new CheckoutService(db);
    const started = await service.startCheckout({
      businessId,
      client: fakeRazorpay(),
      amountPaise: 99900,
    });

    const failedBody = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { id: 'pay_failed', order_id: started.orderId, amount: 99900, status: 'failed' },
        },
      },
    });
    expect(
      await service.handleWebhook({
        rawBody: failedBody,
        signature: signWebhookBody(failedBody, secrets.webhookSecret),
        eventId: `evt_checkout_test_${randomUUID()}`,
        secrets,
      }),
    ).toEqual({ status: 'processed', event: 'payment.failed', activated: false, businessId });
    const [row] = await service.history(businessId);
    expect(row).toMatchObject({ status: 'FAILED', providerPaymentId: 'pay_failed' });

    const refundBody = JSON.stringify({ event: 'refund.created', payload: {} });
    expect(
      await service.handleWebhook({
        rawBody: refundBody,
        signature: signWebhookBody(refundBody, secrets.webhookSecret),
        eventId: `evt_checkout_test_${randomUUID()}`,
        secrets,
      }),
    ).toEqual({ status: 'ignored', event: 'refund.created', activated: false });
    expect((await subscription()).status).toBe('FREE');
  });

  it('renews an active year from its current expiry rather than from today', async () => {
    const service = new CheckoutService(db);
    const first = await service.startCheckout({
      businessId,
      client: fakeRazorpay(),
      amountPaise: 99900,
    });
    await service.completeCheckout({
      businessId,
      orderId: first.orderId,
      paymentId: 'pay_year1',
      signature: signCheckout(first.orderId, 'pay_year1', secrets.keySecret),
      secrets,
    });
    const year1 = await subscription();

    const second = await service.startCheckout({
      businessId,
      client: fakeRazorpay(),
      amountPaise: 99900,
    });
    await service.completeCheckout({
      businessId,
      orderId: second.orderId,
      paymentId: 'pay_year2',
      signature: signCheckout(second.orderId, 'pay_year2', secrets.keySecret),
      secrets,
    });
    const year2 = await subscription();

    expect(year2.starts_at!.getTime()).toBe(year1.expires_at!.getTime());
    expect(year2.expires_at!.getTime()).toBeGreaterThan(year1.expires_at!.getTime());
    expect(await service.history(businessId)).toHaveLength(2);
  });
  it('issues a numbered invoice once, frozen at the sale, and numbers concurrent sales consecutively', async () => {
    const service = new CheckoutService(db);
    // A registered seller, so the split is real; restored afterwards so other suites see defaults.
    const settings = new PlatformSettingsService(db);
    await pool.query(
      `UPDATE businesses SET billing_legal_name = 'Checkout Co Pvt Ltd', gstin = '27AAAAA0000A1Z5',
         billing_state_code = '27', billing_address = '12 Marine Drive' WHERE id = $1`,
      [businessId],
    );
    await settings.update({
      actor: { userId: ownerId },
      reason: 'invoice test',
      changes: {
        seller_gstin: '29ABCDE1234F1Z5',
        seller_state_code: '29',
        seller_address: '1 Main Road',
      },
    });
    try {
      const starts = await Promise.all(
        Array.from({ length: 6 }, () =>
          service.startCheckout({ businessId, client: fakeRazorpay(), amountPaise: 99900 }),
        ),
      );
      // Six sales settling at once come out with six consecutive numbers.
      const real = await Promise.all(
        starts.map((s, i) => {
          const paymentId = `pay_real_${i}_${randomUUID().slice(0, 6)}`;
          return service.completeCheckout({
            businessId,
            orderId: s.orderId,
            paymentId,
            signature: signCheckout(s.orderId, paymentId, secrets.keySecret),
            secrets,
          });
        }),
      );
      const numbers = real.map((r) => r.payment.invoiceNumber!).sort();
      expect(numbers).toHaveLength(6);
      expect(new Set(numbers).size).toBe(6);
      const seqs = numbers.map((n) => Number(n.split('/')[2])).sort((a, b) => a - b);
      expect(seqs[5]! - seqs[0]!).toBe(5);
      expect(numbers[0]).toMatch(/^DH\/\d{4}-\d{2}\/\d{6}$/);

      const first = real[0]!.payment;
      expect(first.invoiceIssuedAt).toBeInstanceOf(Date);
      expect(first.taxBreakdown).toMatchObject({
        gst_applicable: true,
        igst_paise: 15_239,
        supply: 'INTER_STATE',
        place_of_supply_state_code: '27',
      });
      expect(first.sellerSnapshot).toMatchObject({
        gstin: '29ABCDE1234F1Z5',
        address: '1 Main Road',
      });
      expect(first.buyerSnapshot).toMatchObject({
        name: 'Checkout Co Pvt Ltd',
        gstin: '27AAAAA0000A1Z5',
        state_code: '27',
      });

      // A redelivered webhook for a settled order changes nothing on the invoice.
      const again = await service.handleWebhook(
        capturedWebhook(
          starts[0]!.orderId,
          first.providerPaymentId!,
          99900,
          `evt_checkout_test_inv_${randomUUID()}`,
        ),
      );
      expect(again.status).toBe('processed');
      const { rows } = await pool.query(
        'SELECT invoice_number, tax_breakdown FROM payments WHERE id = $1',
        [first.id],
      );
      expect(rows[0].invoice_number).toBe(first.invoiceNumber);
      expect(rows[0].tax_breakdown).toEqual(first.taxBreakdown);
    } finally {
      // Global rows other suites read: removed outright rather than rewritten, so nothing is
      // left attributed to the fixture owner (platform_settings.updated_by is a FK).
      await pool.query(
        `DELETE FROM platform_settings WHERE key IN ('seller_gstin', 'seller_state_code', 'seller_address')`,
      );
    }
  });
});
