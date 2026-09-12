import { eq } from 'drizzle-orm';
import { businesses, subscriptions, users, type Database, type Payment } from '@ai-review/db';
import { CheckoutService, PlatformSettingsService, RazorpayClient } from '@ai-review/core';
import { env } from './env';

/**
 * SUB-01's data, read once for the page and once for `GET /api/v1/subscription`, so the two
 * cannot describe the same row differently.
 *
 * Every read is keyed on the business id `TenantGuard` resolved from the session (RBAC rule 2).
 */

export interface SubscriptionView {
  business: { name: string; timezone: string };
  owner: { name: string; email: string };
  plan: {
    status: 'FREE' | 'CHECKOUT_PENDING' | 'PRO_ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED';
    /** How the row got its entitlement — a paid year and an admin grant read differently. */
    source: 'NONE' | 'PAYMENT' | 'ADMIN';
    startsAt: Date | null;
    expiresAt: Date | null;
    /** The per-tenant price on the row: what a paying tenant pays, grandfathered if it changed. */
    amountPaise: number;
    currency: string;
    proGenerationLimit: number;
  };
  usage: { kind: 'FREE' | 'PRO'; used: number; limit: number; remaining: number };
  /** What checkout charges today: the platform setting, not the row. */
  pricePaise: number;
  /** Whether Razorpay keys are present. Without them the page says so instead of offering a button. */
  paymentsConfigured: boolean;
  /** Renewal is offered inside the last 30 days of a paid year, and after it ends. */
  renewal: { offered: boolean; daysLeft: number | null };
  payments: Payment[];
}

export const RENEWAL_WINDOW_DAYS = 30;

export async function loadSubscriptionView(
  database: Database,
  businessId: string,
): Promise<SubscriptionView | null> {
  const [row] = await database
    .select({
      name: businesses.name,
      timezone: businesses.timezone,
      ownerName: users.fullName,
      ownerEmail: users.email,
      subscription: subscriptions,
    })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!row || !row.subscription) return null;

  const s = row.subscription;
  const [settings, payments] = await Promise.all([
    new PlatformSettingsService(database).values(),
    new CheckoutService(database).history(businessId),
  ]);

  const paid = s.status === 'PRO_ACTIVE' || s.status === 'PAST_DUE';
  const now = Date.now();
  const daysLeft =
    paid && s.expiresAt ? Math.ceil((s.expiresAt.getTime() - now) / 86_400_000) : null;
  const used = paid ? s.proGenerationsUsed : s.freeGenerationsUsed;
  const limit = paid ? s.proGenerationLimit : s.freeGenerationLimit;

  return {
    business: { name: row.name, timezone: row.timezone },
    owner: { name: row.ownerName, email: row.ownerEmail },
    plan: {
      status: s.status,
      source: s.entitlementSource,
      startsAt: s.startsAt,
      expiresAt: s.expiresAt,
      amountPaise: s.amountPaise,
      currency: s.currency,
      proGenerationLimit: s.proGenerationLimit,
    },
    usage: { kind: paid ? 'PRO' : 'FREE', used, limit, remaining: Math.max(0, limit - used) },
    pricePaise: settings.annual_price_paise,
    paymentsConfigured: razorpayConfig() !== null,
    renewal: {
      offered: !paid || (daysLeft !== null && daysLeft <= RENEWAL_WINDOW_DAYS),
      daysLeft,
    },
    payments,
  };
}

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/**
 * All three keys or none. A checkout with a key id but no webhook secret would activate from
 * the browser callback and silently drop every webhook, which is a worse state than "not set up".
 */
export function razorpayConfig(): RazorpayConfig | null {
  const e = env();
  const keyId = e.RAZORPAY_KEY_ID?.trim();
  const keySecret = e.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = e.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!keyId || !keySecret || !webhookSecret) return null;
  return { keyId, keySecret, webhookSecret };
}

export function razorpayClient(config: RazorpayConfig): RazorpayClient {
  return new RazorpayClient({
    keyId: config.keyId,
    keySecret: config.keySecret,
    baseUrl: env().RAZORPAY_BASE_URL,
  });
}

/** The wire shape of `GET /api/v1/subscription`; dates as ISO strings, money in paise. */
export function subscriptionToWire(view: SubscriptionView) {
  return {
    plan: {
      status: view.plan.status,
      source: view.plan.source,
      starts_at: view.plan.startsAt?.toISOString() ?? null,
      expires_at: view.plan.expiresAt?.toISOString() ?? null,
      amount_paise: view.plan.amountPaise,
      currency: view.plan.currency,
      pro_generation_limit: view.plan.proGenerationLimit,
    },
    usage: view.usage,
    price_paise: view.pricePaise,
    payments_configured: view.paymentsConfigured,
    renewal: { offered: view.renewal.offered, days_left: view.renewal.daysLeft },
    payments: view.payments.map(paymentToWire),
  };
}

export function paymentToWire(p: Payment) {
  return {
    id: p.id,
    status: p.status,
    amount_paise: p.amountPaise,
    currency: p.currency,
    provider: p.provider,
    provider_order_id: p.providerOrderId,
    provider_payment_id: p.providerPaymentId,
    paid_at: p.paidAt?.toISOString() ?? null,
    created_at: p.createdAt.toISOString(),
  };
}
