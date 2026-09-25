import { eq } from 'drizzle-orm';
import { businesses, payments, users } from '@ai-review/db';
import { PaymentAdminService } from '@ai-review/core';
import { env } from '@/lib/infra/env';
import { db } from '@/lib/infra/db';
import { mailConfigured, mailer } from '@/lib/email/mailer';
import { receiptEmail } from '@/lib/email/email-templates';
import { formatDate, formatMoney } from '@/lib/dashboard/presentation';

/**
 * The receipt email for a settled payment (AMENDMENT-029): the invoice number, the amount,
 * the period, and a link to the invoice page. Sent from the browser callback and the webhook,
 * whichever settles first, and again by hand from the admin's payment drawer.
 *
 * Never throws. `receipt_emailed_at` is stamped only on a send the transport accepted; with no
 * transport configured the payment keeps a null stamp, which the admin screen shows as
 * "not sent" so the gap is visible rather than assumed.
 */
export async function sendReceipt(
  paymentId: string,
): Promise<{ sent: boolean; reason?: 'not_configured' | 'not_settled' | 'send_failed' }> {
  if (!mailConfigured()) return { sent: false, reason: 'not_configured' };
  const database = db();
  const [row] = await database
    .select({
      payment: payments,
      businessName: businesses.name,
      timezone: businesses.timezone,
      email: users.email,
    })
    .from(payments)
    .innerJoin(businesses, eq(businesses.id, payments.businessId))
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!row || (row.payment.status !== 'CAPTURED' && row.payment.status !== 'REFUNDED')) {
    return { sent: false, reason: 'not_settled' };
  }
  const p = row.payment;
  const reference = p.rawReference as Record<string, unknown>;
  const start = isoDate(reference['period_starts_at']);
  const end = isoDate(reference['period_expires_at']);
  try {
    await mailer().send(
      receiptEmail(row.email, {
        businessName: row.businessName,
        invoiceNumber: p.invoiceNumber,
        amountLabel: formatMoney(p.amountPaise, p.currency),
        paidOn: formatDate(p.paidAt ?? p.createdAt, row.timezone) ?? '',
        periodLabel:
          start && end
            ? `${formatDate(start, row.timezone)} to ${formatDate(end, row.timezone)}`
            : null,
        receiptUrl: `${env().APP_BASE_URL}/app/subscription/receipts/${p.id}`,
      }),
    );
  } catch (error) {
    console.error('[billing] receipt email failed', {
      paymentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: 'send_failed' };
  }
  await new PaymentAdminService(database).markReceiptEmailed(paymentId);
  return { sent: true };
}

function isoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
