/**
 * Operator tool (AMENDMENT-029): settle a payment Razorpay captured but the app never heard
 * about — the browser closed before the callback and the webhook was not delivered. Runs the
 * same `PaymentAdminService.reconcile` the admin's "Check Razorpay" button runs, as the
 * SYSTEM actor, so the audit row says exactly what happened.
 *
 *   DATABASE_URL=<unpooled> RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… \
 *     node node_modules/tsx/dist/cli.mjs scripts/reconcile-payment.mjs --payment <payments.id> --reason '…'
 */
import { createDatabase } from '@ai-review/db';
import { PaymentAdminService, RazorpayClient, SYSTEM_ACTOR } from '@ai-review/core';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const paymentId = args.get('--payment');
const reason = args.get('--reason');
const { DATABASE_URL, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
if (!paymentId || !reason || !DATABASE_URL || !RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error('Need --payment, --reason, DATABASE_URL, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET.');
  process.exit(2);
}

const db = createDatabase({ connectionString: DATABASE_URL, poolMax: 2 });
const client = new RazorpayClient({ keyId: RAZORPAY_KEY_ID, keySecret: RAZORPAY_KEY_SECRET });
try {
  const outcome = await new PaymentAdminService(db).reconcile(paymentId, {
    actor: SYSTEM_ACTOR,
    reason,
    client,
  });
  console.log(
    JSON.stringify(
      {
        status: outcome.payment.status,
        provider_payment_id: outcome.payment.providerPaymentId,
        invoice_number: outcome.payment.invoiceNumber,
        activated: outcome.activated,
        provider_status: outcome.providerStatus,
      },
      null,
      2,
    ),
  );
} finally {
  await db.$client.end();
}
