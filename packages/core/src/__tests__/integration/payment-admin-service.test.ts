import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { CheckoutService } from '../../billing/checkout-service';
import { PaymentAdminError, PaymentAdminService } from '../../billing/payment-admin-service';
import { RazorpayClient, signCheckout, signWebhookBody } from '../../billing/razorpay';

/**
 * Payment control against the real schema (AMENDMENT-029). Razorpay is a fake that answers
 * the four endpoints the product calls; what is under test is our side of each — the rows,
 * the entitlement, the audit trail, and idempotency under redelivery and double submit.
 */
describe('PaymentAdminService', () => {
  let pool: Pool;
  let db: Database;
  let ownerId: string;
  let businessId: string;
  const adminId = randomUUID();
  const secrets = { keySecret: 'ks_' + randomUUID(), webhookSecret: 'ws_' + randomUUID() };
  const actor = { userId: adminId };

  /** A Razorpay whose answers a test can script per endpoint. */
  const fake = (script: {
    refund?: (body: Record<string, unknown>) => Record<string, unknown> | { status: number };
    orderPayments?: () => unknown[];
  }) =>
    new RazorpayClient({
      keyId: 'rzp_test_fake',
      keySecret: secrets.keySecret,
      fetchImpl: async (url, init) => {
        const respond = (status: number, body: unknown) => ({
          ok: status < 400,
          status,
          text: async () => JSON.stringify(body),
        });
        if (url.endsWith('/orders') && init.method === 'POST') {
          const body = JSON.parse(init.body ?? '{}') as { amount: number; currency: string };
          return respond(200, {
            id: `order_${randomUUID().slice(0, 10)}`,
            amount: body.amount,
            currency: body.currency,
            status: 'created',
          });
        }
        if (/\/payments\/[^/]+\/refund$/.test(url)) {
          const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
          const answer = script.refund?.(body) ?? {
            id: `rfnd_${randomUUID().slice(0, 10)}`,
            payment_id: url.split('/')[5],
            amount: body['amount'] ?? 99900,
            status: 'processed',
          };
          if ('status' in answer && typeof answer['status'] === 'number') {
            return respond(answer['status'], { error: { code: 'BAD_REQUEST_ERROR' } });
          }
          return respond(200, answer);
        }
        if (/\/orders\/[^/]+\/payments$/.test(url)) {
          return respond(200, { items: script.orderPayments?.() ?? [] });
        }
        return respond(404, { error: { code: 'NOT_FOUND' } });
      },
    });

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 8 });
    db = createDatabase({ connectionString, poolMax: 8 });
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, 'Payments Admin', 'x', 'SUPER_ADMIN')`,
      [adminId, `payadmin-${adminId}@example.test`],
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM payment_refunds WHERE payment_id IN (SELECT id FROM payments WHERE business_id IN
         (SELECT id FROM businesses WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1)))`,
      ['payadmin-%@example.test'],
    );
    await pool.query(
      `DELETE FROM payment_webhook_events WHERE provider_event_id LIKE 'evt_payadmin_%'`,
    );
    await pool.query(
      `DELETE FROM payments WHERE business_id IN
         (SELECT id FROM businesses WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1))`,
      ['payadmin-%@example.test'],
    );
    await pool.query(
      `DELETE FROM admin_audit_logs WHERE actor_user_id = $1 OR business_id IN
         (SELECT id FROM businesses WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $2))`,
      [adminId, 'payadmin-%@example.test'],
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['payadmin-%@example.test']);
    await pool.end();
  });

  beforeEach(async () => {
    ownerId = randomUUID();
    businessId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, 'Payments Owner', 'x', 'BUSINESS_OWNER')`,
      [ownerId, `payadmin-owner-${ownerId}@example.test`],
    );
    await pool.query(
      `INSERT INTO businesses (id, owner_user_id, name, category, status)
       VALUES ($1, $2, 'Payments Co', 'Cafe', 'ACTIVE')`,
      [businessId, ownerId],
    );
    await pool.query(
      `INSERT INTO subscriptions (business_id, status, free_generation_limit, free_generations_used)
       VALUES ($1, 'FREE', 10, 0)`,
      [businessId],
    );
  });

  /** A settled ₹999 payment for the fixture business, through the real checkout path. */
  async function paidYear(client = fake({})) {
    const checkout = new CheckoutService(db);
    const started = await checkout.startCheckout({ businessId, client, amountPaise: 99900 });
    const providerPaymentId = `pay_${randomUUID().slice(0, 10)}`;
    const { payment } = await checkout.completeCheckout({
      businessId,
      orderId: started.orderId,
      paymentId: providerPaymentId,
      signature: signCheckout(started.orderId, providerPaymentId, secrets.keySecret),
      secrets,
    });
    return payment;
  }

  async function subscription() {
    const { rows } = await pool.query(
      'SELECT status, entitlement_note FROM subscriptions WHERE business_id = $1',
      [businessId],
    );
    return rows[0] as { status: string; entitlement_note: string | null };
  }

  async function auditActions(paymentId: string) {
    const { rows } = await pool.query(
      `SELECT action, actor_type FROM admin_audit_logs WHERE target_id = $1 ORDER BY id`,
      [paymentId],
    );
    return rows as Array<{ action: string; actor_type: string }>;
  }

  it('refunds part of a payment: the money is noted, Pro stays, one audit row', async () => {
    const payment = await paidYear();
    const service = new PaymentAdminService(db);
    const outcome = await service.refund(payment.id, {
      actor,
      reason: 'Goodwill for a week of downtime',
      amountPaise: 10_000,
      client: fake({}),
    });
    expect(outcome.revoked).toBe(false);
    expect(outcome.payment).toMatchObject({ status: 'CAPTURED', refundedPaise: 10_000 });
    expect(outcome.refund).toMatchObject({ status: 'PROCESSED', amountPaise: 10_000 });
    expect(outcome.refund.providerRefundId).toMatch(/^rfnd_/);
    expect((await subscription()).status).toBe('PRO_ACTIVE');
    expect(await auditActions(payment.id)).toEqual([
      { action: 'payment.refund', actor_type: 'ADMIN' },
    ]);

    const detail = await service.get(payment.id);
    expect(detail?.refunds).toHaveLength(1);
    expect(detail?.fundsCurrentPeriod).toBe(true);
    expect(detail?.audit.map((a) => a.action)).toEqual(['payment.refund']);
  });

  it('refunds the rest: REFUNDED, Pro revoked to CANCELLED, both audited', async () => {
    const payment = await paidYear();
    const service = new PaymentAdminService(db);
    await service.refund(payment.id, {
      actor,
      reason: 'part',
      amountPaise: 10_000,
      client: fake({}),
    });
    const outcome = await service.refund(payment.id, {
      actor,
      reason: 'Customer asked to cancel within the cooling-off period',
      client: fake({}),
    });
    expect(outcome.revoked).toBe(true);
    expect(outcome.payment).toMatchObject({ status: 'REFUNDED', refundedPaise: 99_900 });
    expect(await subscription()).toMatchObject({ status: 'CANCELLED', entitlement_note: null });
    const { rows } = await pool.query(
      `SELECT action FROM admin_audit_logs WHERE business_id = $1 ORDER BY id`,
      [businessId],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'payment.refund',
      'business.entitlement.adjust',
      'payment.refund',
    ]);
    // Nothing left to refund.
    await expect(
      service.refund(payment.id, { actor, reason: 'again', client: fake({}) }),
    ).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });

  it('a full refund of a payment that no longer funds the period leaves Pro alone', async () => {
    const first = await paidYear();
    const second = await paidYear(); // renews from the first year's end; now funds the period
    expect((await subscription()).entitlement_note).toBe(`payment:${second.id}`);
    const outcome = await new PaymentAdminService(db).refund(first.id, {
      actor,
      reason: 'Charged twice by mistake',
      client: fake({}),
    });
    expect(outcome.revoked).toBe(false);
    expect(outcome.payment.status).toBe('REFUNDED');
    expect((await subscription()).status).toBe('PRO_ACTIVE');
  });

  it('two admins refunding the whole amount at once: one succeeds, the other is refused', async () => {
    const payment = await paidYear();
    const service = new PaymentAdminService(db);
    const results = await Promise.allSettled([
      service.refund(payment.id, { actor, reason: 'a', client: fake({}) }),
      service.refund(payment.id, { actor, reason: 'b', client: fake({}) }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(PaymentAdminError);
    const { rows } = await pool.query('SELECT refunded_paise FROM payments WHERE id = $1', [
      payment.id,
    ]);
    expect(rows[0].refunded_paise).toBe(99_900);
  });

  it('records a refund Razorpay refused as FAILED, and changes nothing else', async () => {
    const payment = await paidYear();
    await expect(
      new PaymentAdminService(db).refund(payment.id, {
        actor,
        reason: 'x',
        amountPaise: 5_000,
        client: fake({ refund: () => ({ status: 400 }) }),
      }),
    ).rejects.toMatchObject({ code: 'REFUND_FAILED' });
    const { rows } = await pool.query(
      `SELECT r.status, r.error, p.refunded_paise FROM payment_refunds r JOIN payments p ON p.id = r.payment_id WHERE r.payment_id = $1`,
      [payment.id],
    );
    expect(rows[0]).toMatchObject({ status: 'FAILED', refunded_paise: 0 });
    expect(rows[0].error).toMatch(/REJECTED/);
    expect(await auditActions(payment.id)).toEqual([]);
    // And a new refund is allowed afterwards — the failed one is not "in progress".
    const again = await new PaymentAdminService(db).refund(payment.id, {
      actor,
      reason: 'retry',
      amountPaise: 5_000,
      client: fake({}),
    });
    expect(again.refund.status).toBe('PROCESSED');
  });

  it('a refund webhook is applied once, whether ours (by id) or made at the dashboard', async () => {
    const payment = await paidYear();
    const checkout = new CheckoutService(db);
    const service = new PaymentAdminService(db);
    const ours = await service.refund(payment.id, {
      actor,
      reason: 'ours',
      amountPaise: 10_000,
      client: fake({
        refund: (b) => ({
          id: 'rfnd_ours_' + payment.id.slice(0, 6),
          payment_id: payment.providerPaymentId,
          amount: b['amount'],
          status: 'pending',
        }),
      }),
    });
    expect(ours.refund.status).toBe('PENDING');

    const webhook = (refundId: string, amount: number, status: string) => {
      const rawBody = JSON.stringify({
        event: `refund.${status}`,
        payload: {
          refund: {
            entity: { id: refundId, payment_id: payment.providerPaymentId, amount, status },
          },
          payment: {
            entity: {
              id: payment.providerPaymentId,
              order_id: payment.providerOrderId,
              amount: 99900,
              status: 'captured',
            },
          },
        },
      });
      return {
        rawBody,
        signature: signWebhookBody(rawBody, secrets.webhookSecret),
        eventId: `evt_payadmin_${randomUUID()}`,
        secrets,
      };
    };

    // Ours settles: status moves, the amount is not counted twice.
    const settled = await checkout.handleWebhook(
      webhook(ours.refund.providerRefundId!, 10_000, 'processed'),
    );
    expect(settled.status).toBe('processed');
    let { rows } = await pool.query('SELECT refunded_paise FROM payments WHERE id = $1', [
      payment.id,
    ]);
    expect(rows[0].refunded_paise).toBe(10_000);
    const again = await checkout.handleWebhook(
      webhook(ours.refund.providerRefundId!, 10_000, 'processed'),
    );
    expect(again.status).toBe('duplicate'); // a new event id, but the refund is already final
    ({ rows } = await pool.query('SELECT refunded_paise FROM payments WHERE id = $1', [
      payment.id,
    ]));
    expect(rows[0].refunded_paise).toBe(10_000);

    // A dashboard refund we never asked for: recorded once as SYSTEM, then ignored on redelivery.
    const dashboard = webhook('rfnd_dash_' + payment.id.slice(0, 6), 20_000, 'processed');
    expect((await checkout.handleWebhook(dashboard)).status).toBe('processed');
    expect((await checkout.handleWebhook(dashboard)).status).toBe('duplicate');
    ({ rows } = await pool.query('SELECT refunded_paise, status FROM payments WHERE id = $1', [
      payment.id,
    ]));
    expect(rows[0]).toMatchObject({ refunded_paise: 30_000, status: 'CAPTURED' });
    const audit = await auditActions(payment.id);
    expect(audit).toEqual([
      { action: 'payment.refund', actor_type: 'ADMIN' },
      { action: 'payment.refund', actor_type: 'SYSTEM' },
    ]);
    const ledger = await service.listWebhookEvents({ eventType: 'refund.processed' });
    expect(ledger.rows.find((r) => r.paymentId === payment.id)?.outcome).toBe('processed');
  });

  it('reconciles a captured-but-unsettled order through the same path as checkout', async () => {
    const checkout = new CheckoutService(db);
    const started = await checkout.startCheckout({
      businessId,
      client: fake({}),
      amountPaise: 99900,
    });
    const service = new PaymentAdminService(db);
    const capturedId = `pay_${randomUUID().slice(0, 10)}`;

    // Nothing captured at Razorpay yet: audited, nothing settled.
    const nothing = await service.reconcile(started.paymentId, {
      actor,
      reason: 'Owner says they paid',
      client: fake({
        orderPayments: () => [
          { id: 'pay_x', order_id: started.orderId, amount: 99900, status: 'failed' },
        ],
      }),
    });
    expect(nothing.activated).toBe(false);
    expect(nothing.providerStatus).toBe('failed');
    expect((await subscription()).status).toBe('FREE');

    const done = await service.reconcile(started.paymentId, {
      actor,
      reason: 'Webhook was blocked',
      client: fake({
        orderPayments: () => [
          { id: capturedId, order_id: started.orderId, amount: 99900, status: 'captured' },
        ],
      }),
    });
    expect(done.activated).toBe(true);
    expect(done.payment).toMatchObject({ status: 'CAPTURED', providerPaymentId: capturedId });
    expect(done.payment.invoiceNumber).toMatch(/\/\d{6}$/);
    expect((await subscription()).status).toBe('PRO_ACTIVE');
    expect((await auditActions(started.paymentId)).map((a) => a.action)).toEqual([
      'payment.reconcile',
      'payment.reconcile',
    ]);
    await expect(
      service.reconcile(started.paymentId, { actor, reason: 'again', client: fake({}) }),
    ).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });

  it('marks an abandoned checkout failed, and refuses to on a captured one', async () => {
    const checkout = new CheckoutService(db);
    const started = await checkout.startCheckout({
      businessId,
      client: fake({}),
      amountPaise: 99900,
    });
    const service = new PaymentAdminService(db);
    const failed = await service.markFailed(started.paymentId, {
      actor,
      reason: 'Abandoned for a week',
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toMatch(/Abandoned/);
    expect((await auditActions(started.paymentId)).map((a) => a.action)).toEqual([
      'payment.mark_failed',
    ]);

    const paid = await paidYear();
    await expect(service.markFailed(paid.id, { actor, reason: 'x' })).rejects.toMatchObject({
      code: 'STATE_INVALID',
    });
    await expect(service.markFailed(paid.id, { actor, reason: '' })).rejects.toThrow();
  });

  it('lists across tenants with filters and keyset paging', async () => {
    const paid = await paidYear();
    const service = new PaymentAdminService(db);
    await service.refund(paid.id, { actor, reason: 'p', amountPaise: 1_000, client: fake({}) });
    const all = await service.list({ businessId, limit: 1 });
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({ businessName: 'Payments Co', refundedPaise: 1_000 });
    expect(all.rows[0]!.ownerEmail).toContain('payadmin-owner-');
    expect(all.nextBefore).toBeNull();
    expect((await service.list({ businessId, refunded: false })).rows).toHaveLength(0);
    expect((await service.list({ businessId, status: 'CAPTURED' })).rows).toHaveLength(1);
    expect((await service.list({ businessId, status: 'FAILED' })).rows).toHaveLength(0);
  });
});
