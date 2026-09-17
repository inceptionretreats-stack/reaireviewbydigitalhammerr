import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay, the parts this product uses (E10-02, E10-03, D-022): one-time yearly orders,
 * checkout-signature verification, webhook-signature verification.
 *
 * `fetch` rather than the vendor SDK, for the same reasons as the model adapters: one HTTP call
 * per order with no hidden retry, a request body traceable to the platform price setting, and a
 * seam a test can drive without a network. The signatures are HMAC-SHA256 over documented
 * strings; there is nothing an SDK would add there except a dependency.
 *
 * AC-016: a forged payload or signature must never activate an entitlement. Both verifiers
 * compare in constant time and treat a length mismatch as a mismatch, never as an exception
 * that a caller might catch its way past.
 */

export interface RazorpayOrder {
  id: string;
  amountPaise: number;
  currency: string;
  status: string;
}

export interface RazorpayHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type RazorpayFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<RazorpayHttpResponse>;

export interface RazorpayClientOptions {
  keyId: string;
  keySecret: string;
  /** Override for a test double. Defaults to the public API. */
  baseUrl?: string;
  fetchImpl?: RazorpayFetchLike;
  timeoutMs?: number;
}

export class RazorpayError extends Error {
  constructor(
    readonly code: 'UPSTREAM' | 'REJECTED' | 'TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'RazorpayError';
  }
}

const DEFAULT_BASE_URL = 'https://api.razorpay.com/v1';

export interface RazorpayPayment {
  id: string;
  orderId: string | null;
  amountPaise: number;
  /** created | authorized | captured | refunded | failed */
  status: string;
  amountRefundedPaise: number;
  currency: string;
  /** Razorpay's error_code on a failed payment, when it gives one. */
  errorCode: string | null;
}

export interface RazorpayRefund {
  id: string;
  paymentId: string;
  amountPaise: number;
  /** pending | processed | failed */
  status: string;
}

export class RazorpayClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: RazorpayFetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: RazorpayClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** POST /orders. The amount is what the platform charges, in paise, decided by the caller. */
  async createOrder(input: {
    amountPaise: number;
    currency?: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<RazorpayOrder> {
    if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
      throw new RazorpayError('REJECTED', 'order amount must be at least ₹1');
    }
    const parsed = await this.request('POST', '/orders', {
      amount: input.amountPaise,
      currency: input.currency ?? 'INR',
      // Razorpay caps receipts at 40 characters.
      receipt: input.receipt.slice(0, 40),
      notes: input.notes ?? {},
    });
    if (typeof parsed['id'] !== 'string' || typeof parsed['amount'] !== 'number') {
      throw new RazorpayError('UPSTREAM', 'razorpay order response had no id or amount');
    }
    return {
      id: parsed['id'],
      amountPaise: parsed['amount'],
      currency: typeof parsed['currency'] === 'string' ? parsed['currency'] : 'INR',
      status: typeof parsed['status'] === 'string' ? parsed['status'] : 'created',
    };
  }

  /**
   * POST /payments/{id}/refund (AMENDMENT-029). Without an amount Razorpay refunds the whole
   * captured amount; with one, that much of it. `speed: normal` — an instant refund costs a
   * fee and the product has no reason to pay it. The receipt is our refund row's id, so the
   * dashboard and our ledger name the same thing.
   */
  async refund(
    paymentId: string,
    input: { amountPaise?: number; receipt: string; notes?: Record<string, string> },
  ): Promise<RazorpayRefund> {
    if (
      input.amountPaise !== undefined &&
      (!Number.isInteger(input.amountPaise) || input.amountPaise < 100)
    ) {
      throw new RazorpayError('REJECTED', 'refund amount must be at least ₹1');
    }
    const parsed = await this.request('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {
      ...(input.amountPaise !== undefined ? { amount: input.amountPaise } : {}),
      speed: 'normal',
      receipt: input.receipt.slice(0, 40),
      notes: input.notes ?? {},
    });
    const refund = parseRefund(parsed);
    if (!refund) throw new RazorpayError('UPSTREAM', 'razorpay refund response had no id');
    return refund;
  }

  /** GET /payments/{id}. */
  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    const parsed = await this.request('GET', `/payments/${encodeURIComponent(paymentId)}`);
    const payment = parsePayment(parsed);
    if (!payment) throw new RazorpayError('UPSTREAM', 'razorpay payment response had no id');
    return payment;
  }

  /** GET /orders/{id}/payments — every attempt against an order, for reconciliation. */
  async listOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
    const parsed = await this.request('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    const items = Array.isArray(parsed['items']) ? (parsed['items'] as unknown[]) : [];
    return items
      .map((item) => parsePayment(item as Record<string, unknown>))
      .filter((p): p is RazorpayPayment => p !== null);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.options.keyId}:${this.options.keySecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        // No body key at all on GET: fetch refuses a GET that carries one, even an empty one.
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        // The body can quote our request; only the status and Razorpay's error code go on.
        throw new RazorpayError(
          response.status >= 500 ? 'UPSTREAM' : 'REJECTED',
          `razorpay ${path.split('/')[1] ?? 'api'} api answered ${response.status} (${errorCode(text)})`,
        );
      }
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        throw new RazorpayError('UPSTREAM', 'razorpay answered with something other than JSON');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof RazorpayError) throw error;
      if (controller.signal.aborted) {
        throw new RazorpayError('TIMEOUT', `razorpay did not answer within ${this.timeoutMs}ms`);
      }
      throw new RazorpayError('UPSTREAM', 'razorpay request failed before a response');
    } finally {
      clearTimeout(timer);
    }
  }
}

function parsePayment(raw: Record<string, unknown>): RazorpayPayment | null {
  if (typeof raw['id'] !== 'string' || typeof raw['amount'] !== 'number') return null;
  return {
    id: raw['id'],
    orderId: typeof raw['order_id'] === 'string' ? raw['order_id'] : null,
    amountPaise: raw['amount'],
    status: typeof raw['status'] === 'string' ? raw['status'] : 'unknown',
    amountRefundedPaise: typeof raw['amount_refunded'] === 'number' ? raw['amount_refunded'] : 0,
    currency: typeof raw['currency'] === 'string' ? raw['currency'] : 'INR',
    errorCode: typeof raw['error_code'] === 'string' ? raw['error_code'] : null,
  };
}

function parseRefund(raw: Record<string, unknown>): RazorpayRefund | null {
  if (typeof raw['id'] !== 'string' || typeof raw['payment_id'] !== 'string') return null;
  return {
    id: raw['id'],
    paymentId: raw['payment_id'],
    amountPaise: typeof raw['amount'] === 'number' ? raw['amount'] : 0,
    status: typeof raw['status'] === 'string' ? raw['status'] : 'pending',
  };
}

/** The checkout callback's signature: HMAC-SHA256 of `order_id|payment_id` with the key secret. */
export function verifyCheckoutSignature(
  input: { orderId: string; paymentId: string; signature: string },
  keySecret: string,
): boolean {
  const expected = createHmac('sha256', keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');
  return constantTimeEqual(expected, input.signature.trim().toLowerCase());
}

/** A webhook's signature: HMAC-SHA256 of the raw request body with the webhook secret. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  webhookSecret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return constantTimeEqual(expected, signature.trim().toLowerCase());
}

/** Signs a body the way Razorpay does. For tests and for the local webhook rehearsal only. */
export function signWebhookBody(rawBody: string, webhookSecret: string): string {
  return createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
}

export function signCheckout(orderId: string, paymentId: string, keySecret: string): string {
  return createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function errorCode(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { code?: unknown } };
    const code = parsed.error?.code;
    return typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) ? code : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The subset of a webhook event this product acts on. Anything else is acknowledged and
 * ignored — Razorpay retries on non-2xx, and an event we do not handle is not an error.
 */
export interface RazorpayWebhookEvent {
  event: string;
  orderId: string | null;
  paymentId: string | null;
  amountPaise: number | null;
  paymentStatus: string | null;
  /** On payment.failed: Razorpay's error code and description, when given. */
  errorCode: string | null;
  errorDescription: string | null;
  /** On refund.* events (AMENDMENT-029). */
  refundId: string | null;
  refundAmountPaise: number | null;
  refundStatus: string | null;
  /** The payment's running refunded total, when the payment entity carries it. */
  amountRefundedPaise: number | null;
}

export function parseWebhookEvent(rawBody: string): RazorpayWebhookEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const root = parsed as Record<string, unknown>;
  const event = typeof root['event'] === 'string' ? root['event'] : null;
  if (!event) return null;
  const payload = (root['payload'] ?? {}) as Record<string, unknown>;
  const entity = (key: string) =>
    ((payload[key] as Record<string, unknown> | undefined)?.['entity'] ?? null) as Record<
      string,
      unknown
    > | null;
  const payment = entity('payment');
  const order = entity('order');
  const refund = entity('refund');
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    event,
    orderId: str(payment?.['order_id']) ?? str(order?.['id']),
    paymentId: str(payment?.['id']) ?? str(refund?.['payment_id']),
    amountPaise: num(payment?.['amount']) ?? num(order?.['amount_paid']) ?? num(order?.['amount']),
    paymentStatus: str(payment?.['status']),
    errorCode: str(payment?.['error_code']),
    errorDescription: str(payment?.['error_description']),
    refundId: str(refund?.['id']),
    refundAmountPaise: num(refund?.['amount']),
    refundStatus: str(refund?.['status']),
    amountRefundedPaise: num(payment?.['amount_refunded']),
  };
}
