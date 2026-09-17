import { and, asc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  businesses,
  subscriptionReminders,
  subscriptions,
  users,
  type Database,
  type SubscriptionReminder,
} from '@ai-review/db';
import { AuditWriter } from '../audit/writer';

/**
 * What happens to a paid year when nobody is looking (AMENDMENT-029).
 *
 * `EXPIRED` was a status the quota engine understood but nothing ever wrote; a lapsed year
 * stayed PRO_ACTIVE on the row while the engine treated it as Free by the dates. That is
 * correct for quota and wrong for every screen and count that reads the status. The daily
 * sweep flips lapsed rows and writes a SYSTEM audit row for each, so the change is as
 * traceable as an admin's.
 *
 * Reminders are rows before they are emails: one per (subscription, period end, kind), inserted
 * with ON CONFLICT DO NOTHING, so a cron that runs twice — or late, or after a crash mid-send —
 * never sends the same reminder twice. A late cron sends only the nearest due kind: a business
 * whose T30 window was missed because the job was down does not get three emails on the day
 * it comes back.
 */

export type ReminderKind = 'T30' | 'T7' | 'T1' | 'EXPIRED';

/** Days before expiry at which each reminder falls due, nearest first. */
const WINDOWS: Array<{ kind: ReminderKind; days: number }> = [
  { kind: 'T1', days: 1 },
  { kind: 'T7', days: 7 },
  { kind: 'T30', days: 30 },
];

export const REMINDER_MAX_ATTEMPTS = 5;

export interface PendingReminder {
  reminder: SubscriptionReminder;
  businessName: string;
  ownerEmail: string;
  timezone: string;
}

export interface ReminderSender {
  (pending: PendingReminder): Promise<void>;
}

export class SubscriptionLifecycleService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * PRO_ACTIVE / PAST_DUE rows whose period has ended become EXPIRED. Each in its own
   * transaction under SKIP LOCKED, so two overlapping runs split the work rather than
   * double-writing it, and one bad row does not hold up the rest.
   */
  async expireLapsed(batch = 200): Promise<{ expired: string[] }> {
    const now = this.now();
    const expired: string[] = [];
    for (;;) {
      const done = await this.db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: subscriptions.id,
            businessId: subscriptions.businessId,
            status: subscriptions.status,
            expiresAt: subscriptions.expiresAt,
            entitlementSource: subscriptions.entitlementSource,
          })
          .from(subscriptions)
          .where(
            and(
              inArray(subscriptions.status, ['PRO_ACTIVE', 'PAST_DUE']),
              lt(subscriptions.expiresAt, now),
            ),
          )
          .orderBy(asc(subscriptions.expiresAt))
          .limit(batch)
          .for('update', { skipLocked: true });
        if (rows.length === 0) return true;
        for (const row of rows) {
          await tx
            .update(subscriptions)
            .set({ status: 'EXPIRED', updatedAt: now })
            .where(eq(subscriptions.id, row.id));
          await new AuditWriter(tx).record({
            actorUserId: null,
            actorType: 'SYSTEM',
            ipHash: null,
            businessId: row.businessId,
            action: 'subscription.expire',
            targetType: 'subscription',
            targetId: row.id,
            reason: 'Paid period ended',
            before: { status: row.status, expires_at: row.expiresAt?.toISOString() ?? null },
            after: { status: 'EXPIRED' },
          });
          if (row.expiresAt) {
            await tx
              .insert(subscriptionReminders)
              .values({
                subscriptionId: row.id,
                businessId: row.businessId,
                kind: 'EXPIRED',
                periodExpiresAt: row.expiresAt,
              })
              .onConflictDoNothing();
          }
          expired.push(row.businessId);
        }
        return rows.length < batch;
      });
      if (done) break;
    }
    return { expired };
  }

  /**
   * Queues the nearest due reminder for every active paid year. Nothing is queued for a year
   * more than 30 days out, and a period whose nearer reminder was already queued or sent gets
   * no further-out one afterwards.
   */
  async queueDueReminders(): Promise<{ queued: number }> {
    const now = this.now();
    const horizon = new Date(now.getTime() + 30 * 86_400_000);
    const active = await this.db
      .select({
        id: subscriptions.id,
        businessId: subscriptions.businessId,
        expiresAt: subscriptions.expiresAt,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, 'PRO_ACTIVE'),
          lte(subscriptions.expiresAt, horizon),
          sql`${subscriptions.expiresAt} > ${now}`,
        ),
      );
    let queued = 0;
    for (const row of active) {
      if (!row.expiresAt) continue;
      const daysLeft = (row.expiresAt.getTime() - now.getTime()) / 86_400_000;
      const due = WINDOWS.find((w) => daysLeft <= w.days);
      if (!due) continue;
      // Anything nearer than the due kind that already exists for this period means a later
      // cron caught up; the further-out kinds are then not sent at all.
      const existing = await this.db
        .select({ kind: subscriptionReminders.kind })
        .from(subscriptionReminders)
        .where(
          and(
            eq(subscriptionReminders.subscriptionId, row.id),
            eq(subscriptionReminders.periodExpiresAt, row.expiresAt),
          ),
        );
      const have = new Set(existing.map((e) => e.kind));
      const nearerOrSame = WINDOWS.filter((w) => w.days <= due.days).map((w) => w.kind);
      if (nearerOrSame.some((k) => have.has(k))) continue;
      const inserted = await this.db
        .insert(subscriptionReminders)
        .values({
          subscriptionId: row.id,
          businessId: row.businessId,
          kind: due.kind,
          periodExpiresAt: row.expiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: subscriptionReminders.id });
      queued += inserted.length;
    }
    return { queued };
  }

  /**
   * Sends what is queued, up to the attempt cap, skipping a reminder whose period has since
   * been renewed — an owner who renewed yesterday must not hear that their year is ending.
   */
  async sendPending(
    send: ReminderSender,
    limit = 100,
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    const now = this.now();
    const pending = await this.db
      .select({
        reminder: subscriptionReminders,
        businessName: businesses.name,
        timezone: businesses.timezone,
        ownerEmail: users.email,
        currentExpiresAt: subscriptions.expiresAt,
        currentStatus: subscriptions.status,
      })
      .from(subscriptionReminders)
      .innerJoin(businesses, eq(businesses.id, subscriptionReminders.businessId))
      .innerJoin(users, eq(users.id, businesses.ownerUserId))
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionReminders.subscriptionId))
      .where(
        and(
          isNull(subscriptionReminders.sentAt),
          isNull(subscriptionReminders.skippedAt),
          lt(subscriptionReminders.attempts, REMINDER_MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(subscriptionReminders.createdAt))
      .limit(limit);

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of pending) {
      const r = row.reminder;
      const renewed =
        row.currentExpiresAt !== null &&
        row.currentExpiresAt.getTime() !== r.periodExpiresAt.getTime();
      const stale =
        r.kind === 'EXPIRED'
          ? row.currentStatus !== 'EXPIRED'
          : renewed || row.currentStatus !== 'PRO_ACTIVE';
      // A pre-expiry reminder that is more than three days past its period end is not worth
      // sending either: the EXPIRED notice covers it.
      const tooLate =
        r.kind !== 'EXPIRED' && r.periodExpiresAt.getTime() < now.getTime() - 3 * 86_400_000;
      if (stale || tooLate) {
        await this.db
          .update(subscriptionReminders)
          .set({ skippedAt: now, lastError: 'period changed before sending' })
          .where(eq(subscriptionReminders.id, r.id));
        skipped += 1;
        continue;
      }
      try {
        await send({
          reminder: r,
          businessName: row.businessName,
          ownerEmail: row.ownerEmail,
          timezone: row.timezone,
        });
        await this.db
          .update(subscriptionReminders)
          .set({ sentAt: now, attempts: r.attempts + 1, lastError: null })
          .where(eq(subscriptionReminders.id, r.id));
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.db
          .update(subscriptionReminders)
          .set({ attempts: r.attempts + 1, lastError: message.slice(0, 500) })
          .where(eq(subscriptionReminders.id, r.id));
        failed += 1;
      }
    }
    return { sent, failed, skipped };
  }
}
