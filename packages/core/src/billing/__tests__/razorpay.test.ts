import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  parseWebhookEvent,
  RazorpayClient,
  RazorpayError,
  signCheckout,
  signWebhookBody,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../razorpay';

/**
 * AC-016: a forged payload or signature must never activate an entitlement. These are the
 * verifiers that stand between a POST anyone can send and a Pro year.
 */
describe('Razorpay signatures', () => {
  const secret = 'test_key_secret_0123456789';

  it('accepts the documented checkout signature and nothing near it', () => {
    const good = createHmac('sha256', secret).update('order_ABC|pay_XYZ').digest('hex');
    expect(
      verifyCheckoutSignature(
        { orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: good },
        secret,
      ),
    ).toBe(true);
    expect(signCheckout('order_ABC', 'pay_XYZ', secret)).toBe(good);
    // Case-insensitive on the hex, since some clients upper-case it.
    expect(
      verifyCheckoutSignature(
        { orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: good.toUpperCase() },
        secret,
      ),
    ).toBe(true);

    expect(
      verifyCheckoutSignature(
        { orderId: 'order_ABC', paymentId: 'pay_OTHER', signature: good },
        secret,
      ),
    ).toBe(false);
    expect(
      verifyCheckoutSignature(
        { orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: good },
        'wrong secret',
      ),
    ).toBe(false);
    expect(
      verifyCheckoutSignature(
        { orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: '' },
        secret,
      ),
    ).toBe(false);
    expect(
      verifyCheckoutSignature(
        { orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: good.slice(1) },
        secret,
      ),
    ).toBe(false);
  });

  it('verifies a webhook over the raw body, byte for byte', () => {
    const body =
      '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","order_id":"order_1","amount":99900,"status":"captured"}}}}';
    const sig = signWebhookBody(body, secret);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    // Reserialised JSON is a different byte string, and must not verify.
    expect(verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 2), sig, secret)).toBe(
      false,
    );
    expect(verifyWebhookSignature(body + ' ', sig, secret)).toBe(false);
  });

  it('reads the fields it acts on out of payment.captured and order.paid, and nothing from junk', () => {
    expect(
      parseWebhookEvent(
        '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","order_id":"order_1","amount":99900,"status":"captured"}}}}',
      ),
    ).toMatchObject({
      event: 'payment.captured',
      orderId: 'order_1',
      paymentId: 'pay_1',
      amountPaise: 99900,
      paymentStatus: 'captured',
      refundId: null,
    });
    expect(
      parseWebhookEvent(
        '{"event":"order.paid","payload":{"order":{"entity":{"id":"order_2","amount":99900,"amount_paid":99900}}}}',
      ),
    ).toMatchObject({
      event: 'order.paid',
      orderId: 'order_2',
      paymentId: null,
      amountPaise: 99900,
      paymentStatus: null,
    });
    // AMENDMENT-029: refund events name the refund and the payment it belongs to; a failed
    // payment carries Razorpay's reason.
    expect(
      parseWebhookEvent(
        '{"event":"refund.processed","payload":{"refund":{"entity":{"id":"rfnd_1","payment_id":"pay_1","amount":10000,"status":"processed"}},"payment":{"entity":{"id":"pay_1","order_id":"order_1","amount":99900,"amount_refunded":10000,"status":"captured"}}}}',
      ),
    ).toMatchObject({
      event: 'refund.processed',
      paymentId: 'pay_1',
      orderId: 'order_1',
      refundId: 'rfnd_1',
      refundAmountPaise: 10000,
      refundStatus: 'processed',
      amountRefundedPaise: 10000,
    });
    expect(
      parseWebhookEvent(
        '{"event":"payment.failed","payload":{"payment":{"entity":{"id":"pay_9","order_id":"order_9","amount":99900,"status":"failed","error_code":"BAD_REQUEST_ERROR","error_description":"Card declined"}}}}',
      ),
    ).toMatchObject({ errorCode: 'BAD_REQUEST_ERROR', errorDescription: 'Card declined' });
    expect(parseWebhookEvent('not json')).toBeNull();
    expect(parseWebhookEvent('{"no":"event"}')).toBeNull();
  });
});

describe('RazorpayClient.createOrder', () => {
  it('posts the amount with Basic auth and returns the order', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: unknown) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ id: 'order_9', amount: 99900, currency: 'INR', status: 'created' }),
    }));
    const client = new RazorpayClient({ keyId: 'rzp_test_key', keySecret: 'secret', fetchImpl });
    const order = await client.createOrder({ amountPaise: 99900, receipt: 'sub_abc' });

    expect(order).toEqual({
      id: 'order_9',
      amountPaise: 99900,
      currency: 'INR',
      status: 'created',
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect((init as { headers: Record<string, string> }).headers['Authorization']).toBe(
      `Basic ${Buffer.from('rzp_test_key:secret').toString('base64')}`,
    );
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({
      amount: 99900,
      currency: 'INR',
      receipt: 'sub_abc',
    });
  });

  it('refuses an amount below a rupee before any request', async () => {
    const fetchImpl = vi.fn();
    const client = new RazorpayClient({ keyId: 'k', keySecret: 's', fetchImpl });
    await expect(client.createOrder({ amountPaise: 50, receipt: 'r' })).rejects.toMatchObject({
      code: 'REJECTED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps a 4xx to REJECTED with only the error code, and a 5xx to UPSTREAM', async () => {
    const reject = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'key secret is s' } }),
    }));
    const error: unknown = await new RazorpayClient({
      keyId: 'k',
      keySecret: 's',
      fetchImpl: reject,
    })
      .createOrder({ amountPaise: 99900, receipt: 'r' })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(RazorpayError);
    const razorpayError = error as RazorpayError;
    expect(razorpayError.code).toBe('REJECTED');
    expect(razorpayError.message).toContain('BAD_REQUEST_ERROR');
    expect(razorpayError.message).not.toContain('key secret');

    const down = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'down' }));
    await expect(
      new RazorpayClient({ keyId: 'k', keySecret: 's', fetchImpl: down }).createOrder({
        amountPaise: 99900,
        receipt: 'r',
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM' });
  });
});

describe('RazorpayClient refunds and lookups', () => {
  const ok = (body: unknown) =>
    vi.fn(async (_url: string, _init: unknown) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }));

  it('posts a partial refund with our receipt and reads the refund back', async () => {
    const fetchImpl = ok({ id: 'rfnd_1', payment_id: 'pay_1', amount: 10000, status: 'pending' });
    const client = new RazorpayClient({ keyId: 'k', keySecret: 's', fetchImpl });
    const refund = await client.refund('pay_1', { amountPaise: 10000, receipt: 'refund-row-id' });
    expect(refund).toEqual({
      id: 'rfnd_1',
      paymentId: 'pay_1',
      amountPaise: 10000,
      status: 'pending',
    });
    const [url, init] = fetchImpl.mock.calls[0]! as [string, { method: string; body: string }];
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_1/refund');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      amount: 10000,
      speed: 'normal',
      receipt: 'refund-row-id',
      notes: {},
    });
  });

  it('omits the amount for a full refund, and refuses less than a rupee before any request', async () => {
    const fetchImpl = ok({ id: 'rfnd_2', payment_id: 'pay_1', amount: 99900, status: 'processed' });
    const client = new RazorpayClient({ keyId: 'k', keySecret: 's', fetchImpl });
    await client.refund('pay_1', { receipt: 'r' });
    const [, init] = fetchImpl.mock.calls[0]! as [string, { body: string }];
    expect(JSON.parse(init.body)).not.toHaveProperty('amount');
    await expect(client.refund('pay_1', { amountPaise: 50, receipt: 'r' })).rejects.toMatchObject({
      code: 'REJECTED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads a payment and lists the payments on an order, dropping malformed items', async () => {
    const one = ok({
      id: 'pay_1',
      order_id: 'order_1',
      amount: 99900,
      status: 'captured',
      amount_refunded: 0,
      currency: 'INR',
    });
    const payment = await new RazorpayClient({
      keyId: 'k',
      keySecret: 's',
      fetchImpl: one,
    }).fetchPayment('pay_1');
    expect(payment).toEqual({
      id: 'pay_1',
      orderId: 'order_1',
      amountPaise: 99900,
      status: 'captured',
      amountRefundedPaise: 0,
      currency: 'INR',
      errorCode: null,
    });
    const [url, init] = one.mock.calls[0]! as [string, { method: string; body: string }];
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_1');
    expect(init.method).toBe('GET');
    // A GET with a body — even an empty string — is refused by fetch, so none is sent.
    expect(init).not.toHaveProperty('body');

    const many = ok({
      items: [
        {
          id: 'pay_a',
          order_id: 'order_1',
          amount: 99900,
          status: 'failed',
          error_code: 'BAD_REQUEST_ERROR',
        },
        { nonsense: true },
        { id: 'pay_b', order_id: 'order_1', amount: 99900, status: 'captured' },
      ],
    });
    const list = await new RazorpayClient({
      keyId: 'k',
      keySecret: 's',
      fetchImpl: many,
    }).listOrderPayments('order_1');
    expect(list.map((p) => [p.id, p.status, p.errorCode])).toEqual([
      ['pay_a', 'failed', 'BAD_REQUEST_ERROR'],
      ['pay_b', 'captured', null],
    ]);
    expect(many.mock.calls[0]![0]).toBe('https://api.razorpay.com/v1/orders/order_1/payments');
  });

  it('turns a 4xx into REJECTED with only the error code, and a 5xx into UPSTREAM', async () => {
    const bad = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'secret stuff' } }),
    }));
    await expect(
      new RazorpayClient({ keyId: 'k', keySecret: 's', fetchImpl: bad }).fetchPayment('pay_x'),
    ).rejects.toMatchObject({
      code: 'REJECTED',
      message: expect.not.stringContaining('secret stuff'),
    });
    const down = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'gateway' }));
    await expect(
      new RazorpayClient({ keyId: 'k', keySecret: 's', fetchImpl: down }).listOrderPayments('o'),
    ).rejects.toMatchObject({ code: 'UPSTREAM' });
  });
});
