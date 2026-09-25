# Billing and plans

This document covers the two plans, where their prices and draft allowances come from, how a vendor
pays for Pro through Razorpay, how invoices and GST are produced, what operators can do to a payment
(reconcile, mark failed, refund, grant access), and the daily job that expires paid years and sends
reminders. Read it before changing anything under `packages/core/src/billing/`, the subscription
screens, the admin payments area or the plan wording on public pages. Several of these paths move
real money or change real access; do not exercise them against live data without explicit approval.

## Plans

| Plan | Price                       | Ai drafts                                | Notes                                                                                    |
| ---- | --------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Free | ₹0                          | 10 in total per business; never refilled | Unused Free drafts do not expire                                                         |
| Pro  | ₹999 for 12 calendar months | 2,000 per paid period                    | Paid once per year through Razorpay; renewal is another payment, not an automatic charge |

The figures above are the defaults. The live values are read from `platform_settings`
(`free_generation_limit`, `annual_price_paise`, `pro_generation_limit`) through
`PlatformSettingsService` (`packages/core/src/platform/settings.ts`), which admins edit in
`/admin/settings`:

- **Public pages** (landing cards, `/legal/pricing`, FAQ) read them at render time through
  `apps/web/lib/marketing/commercial-terms.ts`, falling back to the defaults if the database is
  unreachable. There are no hard-coded prices in marketing copy.
- **Checkout** charges the current `annual_price_paise` at the moment the order is created.
- **Draft limits** are copied onto a business's `subscriptions` row when it signs up. Changing the
  platform setting later affects new sign-ups; an admin can adjust one business's Free limit or reset
  its usage from `/admin/businesses/{id}`.
- **Payments and invoices** keep their own amount and snapshots and are never rewritten when
  settings change.

### Changing the price or allowances

- **On a running system**, a `SUPER_ADMIN` changes the values at `/admin/settings`
  (`PATCH /api/v1/admin/settings`, which needs a fresh MFA step-up and a reason, and is audited).
  Nothing needs deploying: public pages and checkout read the new values on the next request.
- **The fallback defaults** (used when no row is stored, and on a fresh database) are
  `PLATFORM_SETTING_DEFAULTS` in `packages/core/src/platform/settings.ts`. The
  `FREE_AI_GENERATION_LIMIT`, `PRO_ANNUAL_GENERATION_LIMIT` and `PRO_ANNUAL_PRICE_PAISE`
  environment variables are no longer read.
- **Browser tests assume the defaults.** Pricing, landing, public-information, subscription,
  invoice, cron and admin-payments specs, and `e2e/support/db.ts`, expect ₹999 (99900 paise). Do
  not change the settings on the test database; if you change the defaults, update those specs too
  (see [e2e](../../e2e/README.md)).
- **Public copy that states a price or allowance** reads it through
  `apps/web/lib/marketing/commercial-terms.ts`; never hard-code the number.

### How allowances are used

Allowances belong to one business profile and its Google review link. Each successful customer draft,
including a "New review", uses one; editing, copying, opening Google and the owner's preview do not.
When Pro is active the Pro counter is used; when a Pro period ends, unused Pro drafts do not roll
over and the business falls back to whatever Free allowance it has left. When no allowance is left,
customers are told the writing assistant is unavailable and can still open Google and write their
own review. Reservation mechanics: [Ai generation](ai-generation.md#draft-allowances-and-atomic-reservation).

`subscriptions.status` is one of `FREE`, `CHECKOUT_PENDING`, `PRO_ACTIVE`, `PAST_DUE`, `EXPIRED`,
`CANCELLED`, and `entitlement_source` records whether Pro came from a `PAYMENT` or an `ADMIN` grant.
Whether a business is on Pro right now is decided by the period dates, not the status alone
(`isPaidNow`), because a lapsed year stays `PRO_ACTIVE` until the nightly sweep runs.

## Paying for Pro

```text
Owner on /app/subscription
  -> POST /api/v1/subscription/checkout
       server takes the price from platform_settings, creates a Razorpay order
       and a payments row (CREATED); records subscription_checkout_started
  -> browser opens Razorpay Checkout.js with the returned key id and order id
  -> on success: POST /api/v1/subscription/verify  (order id, payment id, signature)
  -> and/or Razorpay: POST /api/v1/webhooks/razorpay (signed event)
       both call CheckoutService.settleOrder
  -> payment CAPTURED, Pro activated, invoice number and snapshots stored
  -> receipt email sent after the response, if email is configured
```

**Payment keys.** Online payment needs all three of `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
`RAZORPAY_WEBHOOK_SECRET` (`razorpayConfig` in `apps/web/lib/billing/subscription.ts`); with any one
missing, checkout, verify and the webhook answer `PAYMENTS_NOT_CONFIGURED` (503) and the subscription
page explains that online upgrade is unavailable. **Local development has no payment keys, so
checkout answers `PAYMENTS_NOT_CONFIGURED`.** `RAZORPAY_BASE_URL` exists only to point the Orders API
at a fake endpoint for a rehearsal.

**Verification rules.**

- The amount always comes from the server. The browser never sends a price.
- `verify` checks Razorpay's HMAC over the order and payment ids with the key secret, that the order
  belongs to the caller's business and that it was created here. Every failure gives the same
  `PAYMENT_VERIFICATION_FAILED` answer.
- The webhook reads the **raw body** and verifies the `X-Razorpay-Signature` HMAC with the webhook
  secret before parsing. Each delivery is recorded in `payment_webhook_events`. `payment.captured`
  and `order.paid` settle the order; `payment.failed` marks it failed; `refund.*` events apply
  refunds. It answers 400 for a bad signature and 200 for processed, duplicate or ignored events.
- `settleOrder` locks the payment row, checks business and amount, and does nothing if the payment is
  already `CAPTURED` — so whichever of `verify` and the webhook arrives second changes nothing. A
  browser success screen or a bank debit alone never grants Pro.

**Activation.** `SubscriptionService.activatePro` (`packages/core/src/billing/subscription-service.ts`)
sets `PRO_ACTIVE` for 12 months. If the business is already on a paid period, the new period starts
when the current one ends, so no paid time is lost; a database trigger (migration `0003`) resets the
Pro counter when the period start changes. Renewal is offered in the last 30 days of a paid year and
after it ends. Note the open problem with early renewal in [known issues](../known-issues.md).

## Invoices and GST

- Invoice numbers come from `invoice_sequences`, drawn inside the settlement transaction, so they are
  consecutive within a series and a failed settlement leaves no gap
  (`packages/core/src/billing/invoice-service.ts`).
- The price is tax-inclusive; checkout adds no surcharge. A GST split is computed
  (`packages/core/src/billing/gst.ts`) only when the seller's GSTIN and state code are set in
  platform settings: CGST + SGST when the buyer is in the seller's state, IGST otherwise. Without a
  seller GSTIN the invoice records that no tax was split out.
- The buyer's legal name, GSTIN, state and address come from `/app/settings`
  (`/api/v1/business/billing`). Seller details, buyer details and the tax breakdown are copied onto
  the payment as snapshots.
- Owners view receipts at `/app/subscription/receipts/{id}`; admins at
  `/admin/payments/{id}/invoice`. Both render `apps/web/components/shared/billing/InvoiceDocument.tsx`.

Whether these settings reflect the seller's actual registration and tax obligations is an owner
decision, not something the code can confirm.

## Operator paths

All are audited with a reason. Admin routes are `SUPER_ADMIN` only.

| Action              | Where                                                                                               | What it does                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconcile           | `/admin/payments` → `POST …/payments/{id}/actions` `reconcile`; `scripts/ops/reconcile-payment.mjs` | Asks Razorpay about the order and, if it was paid, settles it through the same `settleOrder` path (for a closed browser plus a lost webhook)                                  |
| Mark failed         | action `mark_failed`; `scripts/ops/mark-payment-failed.mjs`                                         | Closes abandoned `CREATED`/`AUTHORIZED` checkouts as `FAILED`                                                                                                                 |
| Resend receipt      | action `resend_receipt`                                                                             | Emails the receipt again                                                                                                                                                      |
| Refund              | `POST /api/v1/admin/payments/{id}/refund` (needs a fresh MFA step-up)                               | Records the request, calls Razorpay, then records the result. A partial refund never changes access; a full refund revokes Pro only if that payment funded the current period |
| Grant or revoke Pro | `PATCH /api/v1/admin/businesses/{id}` `activate_pro` / `revoke_pro`                                 | Same `SubscriptionService`; source `ADMIN`; revoking leaves the row `CANCELLED`                                                                                               |

Refunds are idempotent by Razorpay refund id, so the `refund.processed` webhook for a refund started
here is a no-op. The two scripts run as the `SYSTEM` actor against whatever `DATABASE_URL` they are
given and change real data; the reconcile script also calls Razorpay. Exact refund eligibility and
deadlines are an owner decision still pending; do not invent them in copy or code.

## Daily subscription job

`GET /api/cron/subscriptions` (Vercel Cron, once a day; see the
[schedule](../operations/email-and-scheduled-jobs.md#vercel-cron-jobs);
`apps/web/lib/cron/subscriptions.ts`):

1. Marks `PRO_ACTIVE`/`PAST_DUE` rows whose period has ended as `EXPIRED` and queues an expiry
   notice.
2. Queues renewal reminders 30, 7 and 1 days before expiry, at most one per period and kind; a late
   run sends only the nearest one due.
3. Sends queued reminders through Resend. Without `RESEND_API_KEY` nothing is sent and the rows wait
   for the first run after email is configured.
4. Deletes user activity rows older than `ACTIVITY_RETENTION_DAYS`.

Every step is idempotent, so a repeated call is safe.

## Where the code lives

| What                               | Path                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Subscription view, Razorpay config | `apps/web/lib/billing/subscription.ts`                                                                                     |
| Checkout, verify, webhook routes   | `apps/web/app/api/v1/subscription/`, `apps/web/app/api/v1/webhooks/razorpay/route.ts`                                      |
| Checkout and settlement            | `packages/core/src/billing/checkout-service.ts`, `packages/core/src/billing/razorpay.ts`                                   |
| Activation, grants, suspension     | `packages/core/src/billing/subscription-service.ts`                                                                        |
| Invoices and GST                   | `packages/core/src/billing/invoice-service.ts`, `packages/core/src/billing/gst.ts`, `apps/web/lib/billing/invoice-view.ts` |
| Refunds, reconcile, mark failed    | `packages/core/src/billing/payment-admin-service.ts`, `apps/web/app/api/v1/admin/payments/`                                |
| Expiry and reminders               | `packages/core/src/billing/lifecycle-service.ts`, `apps/web/lib/cron/subscriptions.ts`                                     |
| Receipt email                      | `apps/web/lib/billing/receipt-mail.ts`, `apps/web/lib/email/email-templates.ts`                                            |
| Platform settings                  | `packages/core/src/platform/settings.ts`, `apps/web/app/api/v1/admin/settings/route.ts`                                    |
| Public plan wording                | `apps/web/lib/marketing/commercial-terms.ts`, `apps/web/components/marketing/pricing/`                                     |
| Owner screens                      | `apps/web/components/dashboard/subscription/`, `apps/web/components/dashboard/settings/BillingDetailsForm.tsx`             |
| Operator scripts                   | `scripts/ops/reconcile-payment.mjs`, `scripts/ops/mark-payment-failed.mjs`                                                 |
