'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, InlineError, StatusBadge } from '@ai-review/ui';
import { sendJson } from '@/components/dashboard/ai/send-json';
import { describePlan } from '@/components/dashboard/presentation';

/**
 * SUB-01's plan card and the purchase flow (Flow E steps 5–7).
 *
 * The five states the screen spec lists map onto `phase` plus the plan status the server
 * rendered: `free` and `expired` are the plan; `checkout` is the Razorpay sheet open or the
 * signature being verified; `paid` is the plan after a verified payment; `payment failed` is
 * a declined card, a closed sheet, or a verification the server refused.
 *
 * Checkout.js is loaded when the owner clicks, not on page load: it is a third-party script
 * and nothing on this page needs it until then. The only thing it receives from this page is
 * what `/subscription/checkout` returned — the public key id, the order, the amount and the
 * business name. The secret never reaches the browser and the amount is never taken from it.
 *
 * On success the sheet hands back three strings; they go to `/subscription/verify` untouched,
 * and the page believes the server's answer, not Razorpay's — a plan changes only after the
 * signature verifies (AC-016).
 */

export interface SubscriptionPanelProps {
  status: 'FREE' | 'CHECKOUT_PENDING' | 'PRO_ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED';
  source: 'NONE' | 'PAYMENT' | 'ADMIN';
  /** Preformatted on the server in the business timezone (AC-026). */
  startsAt: string | null;
  expiresAt: string | null;
  /** "₹999" — what checkout charges today. */
  price: string;
  proAllowance: string;
  usage: { kind: 'FREE' | 'PRO'; used: number; limit: number; remaining: number };
  paymentsConfigured: boolean;
  renewal: { offered: boolean; daysLeft: number | null };
  businessActive: boolean;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'checkout' }
  | { kind: 'verifying' }
  | { kind: 'paid' }
  | { kind: 'failed'; message: string }
  | { kind: 'unavailable'; message: string };

interface CheckoutConfig {
  key_id: string;
  order_id: string;
  amount_paise: number;
  currency: string;
  business_name: string;
  prefill: { name: string; email: string };
}

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckout {
  open(): void;
  on(event: 'payment.failed', handler: (response: unknown) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';

export function SubscriptionPanel(props: SubscriptionPanelProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const plan = describePlan(props.status);
  const isPro = plan.badge === 'PRO';
  const busy = phase.kind === 'starting' || phase.kind === 'checkout' || phase.kind === 'verifying';

  const buy = async () => {
    setPhase({ kind: 'starting' });
    const started = await sendJson('/api/v1/subscription/checkout', 'POST');
    if (!started.ok) {
      setPhase({
        kind: started.failure.code === 'PAYMENTS_NOT_CONFIGURED' ? 'unavailable' : 'failed',
        message: started.failure.message,
      });
      return;
    }
    const config = started.payload as unknown as CheckoutConfig;

    try {
      await loadCheckoutJs();
    } catch {
      setPhase({
        kind: 'failed',
        message: 'Could not load the payment window. Check your connection and try again.',
      });
      return;
    }
    const Razorpay = window.Razorpay;
    if (!Razorpay) {
      setPhase({ kind: 'failed', message: 'The payment window is unavailable right now.' });
      return;
    }

    setPhase({ kind: 'checkout' });
    const sheet = new Razorpay({
      key: config.key_id,
      amount: config.amount_paise,
      currency: config.currency,
      name: config.business_name,
      description: 'Ai Review Pro — one year',
      order_id: config.order_id,
      prefill: config.prefill,
      theme: { color: '#111827' },
      handler: (response: RazorpaySuccess) => void verify(response),
      modal: {
        ondismiss: () =>
          setPhase((current) =>
            current.kind === 'checkout'
              ? { kind: 'failed', message: 'The payment window was closed before paying.' }
              : current,
          ),
      },
    });
    sheet.on('payment.failed', () => {
      setPhase({
        kind: 'failed',
        message: 'The payment did not go through. No plan change was made; you can try again.',
      });
    });
    sheet.open();
  };

  const verify = async (response: RazorpaySuccess) => {
    setPhase({ kind: 'verifying' });
    const result = await sendJson('/api/v1/subscription/verify', 'POST', {
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
    });
    if (!result.ok) {
      setPhase({ kind: 'failed', message: result.failure.message });
      return;
    }
    setPhase({ kind: 'paid' });
    router.refresh();
  };

  const cta = isPro
    ? props.renewal.offered
      ? `Renew — ${props.price}/year`
      : null
    : `Upgrade — ${props.price}/year`;

  return (
    <Card
      title="Your plan"
      titleAs="h2"
      className="dashboard-section-card dashboard-section-card--yellow"
      actions={
        cta && props.businessActive ? (
          <Button onClick={() => void buy()} loading={busy} disabled={busy}>
            {phase.kind === 'verifying' ? 'Confirming payment…' : cta}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-muted">Plan</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <StatusBadge status={plan.badge} label={plan.label} />
          {props.source === 'ADMIN' && isPro && (
            <span className="text-xs text-ink-muted">granted by Digital Hammerr</span>
          )}
        </dd>

        <dt className="text-ink-muted">{isPro ? 'You pay' : 'Pro costs'}</dt>
        <dd className="font-medium tabular-nums text-ink">{props.price} per year</dd>

        {props.startsAt && (
          <>
            <dt className="text-ink-muted">Start</dt>
            <dd className="font-medium text-ink">{props.startsAt}</dd>
          </>
        )}
        {props.expiresAt && (
          <>
            <dt className="text-ink-muted">Expiry</dt>
            <dd className="font-medium text-ink">
              {props.expiresAt}
              {props.renewal.daysLeft !== null && props.renewal.daysLeft >= 0 && (
                <span className="ml-2 text-xs text-ink-muted">
                  {props.renewal.daysLeft === 0
                    ? 'ends today'
                    : `${props.renewal.daysLeft} days left`}
                </span>
              )}
            </dd>
          </>
        )}

        <dt className="text-ink-muted">
          {props.usage.kind === 'PRO' ? 'Ai drafts this year' : 'Free Ai drafts'}
        </dt>
        <dd className="font-medium tabular-nums text-ink">
          {props.usage.used.toLocaleString('en-IN')} of {props.usage.limit.toLocaleString('en-IN')}{' '}
          used · {props.usage.remaining.toLocaleString('en-IN')} left
        </dd>

        <dt className="text-ink-muted">Pro allowance</dt>
        <dd className="font-medium tabular-nums text-ink">
          {props.proAllowance} Ai drafts per year
        </dd>
      </dl>

      <p className="mt-3 text-sm text-ink-muted">{plan.note}</p>

      {!props.businessActive && cta && (
        <p className="mt-1 text-sm text-ink-muted">
          Finish publishing your page before upgrading — the plan applies to a live business.
        </p>
      )}
      {isPro && !props.renewal.offered && (
        <p className="mt-1 text-sm text-ink-muted">
          Renewal opens 30 days before your plan ends. A renewal adds a year from the current
          expiry, so paying early never loses time.
        </p>
      )}
      {!props.paymentsConfigured && cta && props.businessActive && phase.kind === 'idle' && (
        <p className="mt-1 text-sm text-ink-muted">
          Online payment is being set up. Until then, Digital Hammerr can activate Pro for you — get
          in touch.
        </p>
      )}

      <div className="mt-3" aria-live="polite">
        {phase.kind === 'checkout' && (
          <p className="text-sm text-ink-muted" role="status">
            Complete the payment in the Razorpay window.
          </p>
        )}
        {phase.kind === 'verifying' && (
          <p className="text-sm text-ink-muted" role="status">
            Confirming your payment with Razorpay…
          </p>
        )}
        {phase.kind === 'paid' && (
          <p className="text-sm font-medium text-success" role="status">
            Payment confirmed. Your Pro year is active.
          </p>
        )}
        {phase.kind === 'unavailable' && (
          <p className="text-sm text-ink-muted" role="status">
            {phase.message}
          </p>
        )}
        {phase.kind === 'failed' && <InlineError>{phase.message}</InlineError>}
      </div>
    </Card>
  );
}

let checkoutJs: Promise<void> | null = null;

/** Injects Checkout.js once; a second click awaits the same load. */
function loadCheckoutJs(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  checkoutJs ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_JS;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      checkoutJs = null;
      script.remove();
      reject(new Error('checkout.js failed to load'));
    };
    document.head.appendChild(script);
  });
  return checkoutJs;
}
