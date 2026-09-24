import {
  purgeActivityOlderThan,
  SubscriptionLifecycleService,
  type PendingReminder,
} from '@ai-review/core';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { mailConfigured, mailer } from '@/lib/email/mailer';
import { renewalReminderEmail, subscriptionExpiredEmail } from '@/lib/email/email-templates';
import { formatMoney } from '@/lib/dashboard/presentation';
import { PlatformSettingsService } from '@ai-review/core';

/**
 * The daily subscription sweep (AMENDMENT-029), split from the route so it can be unit-tested
 * without HTTP: expire lapsed years, queue the reminders now due, send what is queued, and
 * purge activity rows past retention (AMENDMENT-028).
 */
export interface CronSummary {
  expired: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  activity_purged: number;
  mail: 'resend' | 'unconfigured';
}

export async function runSubscriptionSweep(now = new Date()): Promise<CronSummary> {
  const database = db();
  const lifecycle = new SubscriptionLifecycleService(database, () => now);
  const { expired } = await lifecycle.expireLapsed();
  const { queued } = await lifecycle.queueDueReminders();

  const configured = mailConfigured();
  const price = (await new PlatformSettingsService(database).values()).annual_price_paise;
  const amountLabel = formatMoney(price, 'INR');
  const renewUrl = `${env().APP_BASE_URL}/app/subscription`;

  const sendOne = async (p: PendingReminder) => {
    if (!configured) throw new Error('no mail transport configured');
    const email =
      p.reminder.kind === 'EXPIRED'
        ? subscriptionExpiredEmail(p.ownerEmail, {
            businessName: p.businessName,
            renewUrl,
            amountLabel,
          })
        : renewalReminderEmail(p.ownerEmail, {
            businessName: p.businessName,
            expiresAt: p.reminder.periodExpiresAt,
            daysLeft: Math.max(
              0,
              Math.round((p.reminder.periodExpiresAt.getTime() - now.getTime()) / 86_400_000),
            ),
            renewUrl,
            amountLabel,
          });
    await mailer().send(email);
  };
  // Without a transport nothing is attempted: the rows wait, attempts stay at zero, and the
  // first run after the key is set sends them (those still relevant — stale ones are skipped).
  const delivery = configured
    ? await lifecycle.sendPending(sendOne)
    : { sent: 0, failed: 0, skipped: 0 };

  const cutoff = new Date(now.getTime() - env().ACTIVITY_RETENTION_DAYS * 86_400_000);
  const purged = await purgeActivityOlderThan(database, cutoff);

  return {
    expired: expired.length,
    queued,
    ...delivery,
    activity_purged: purged,
    mail: configured ? 'resend' : 'unconfigured',
  };
}
