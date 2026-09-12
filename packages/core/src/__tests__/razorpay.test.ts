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
} from '../billing/razorpay';

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
    ).toEqual({
      event: 'payment.captured',
      orderId: 'order_1',
      paymentId: 'pay_1',
      amountPaise: 99900,
      paymentStatus: 'captured',
    });
    expect(
      parseWebhookEvent(
        '{"event":"order.paid","payload":{"order":{"entity":{"id":"order_2","amount":99900,"amount_paid":99900}}}}',
      ),
    ).toEqual({
      event: 'order.paid',
      orderId: 'order_2',
      paymentId: null,
      amountPaise: 99900,
      paymentStatus: null,
    });
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
