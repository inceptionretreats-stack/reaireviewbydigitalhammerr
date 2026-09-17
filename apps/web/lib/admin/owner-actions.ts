import { eq } from 'drizzle-orm';
import { businesses, passwordResetTokens, users } from '@ai-review/db';
import { AbuseService, AuditWriter, issueToken, privacyHash } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { mailConfigured, mailer, passwordResetEmail } from '@/lib/mailer';
import { abuseWarningEmail } from '@/lib/email-templates';

/**
 * Admin actions that end in an email to the owner (AMENDMENT-030 and the Owner & account tab).
 * Each writes its audit row inside the same transaction as its state change, then sends; a
 * mail failure is reported back, never hidden, and never undoes the audited fact.
 */
const RESET_TTL_MS = 60 * 60 * 1000;

interface Actor {
  userId: string;
  ipHash: string | null;
}

export async function sendOwnerPasswordReset(input: {
  businessId: string;
  actor: Actor;
  reason: string;
}): Promise<{ sent: boolean; email: string }> {
  const database = db();
  const [owner] = await database
    .select({ id: users.id, email: users.email })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .where(eq(businesses.id, input.businessId))
    .limit(1);
  if (!owner) throw new Error('no owner');

  const { token, tokenHash } = issueToken();
  await database.transaction(async (tx) => {
    await tx.insert(passwordResetTokens).values({
      userId: owner.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
      requestedIpHash: input.actor.ipHash,
    });
    await new AuditWriter(tx).record({
      actorUserId: input.actor.userId,
      ipHash: input.actor.ipHash,
      businessId: input.businessId,
      action: 'user.password_reset.send',
      targetType: 'user',
      targetId: owner.id,
      reason: input.reason,
      before: {},
      after: { email: owner.email },
    });
  });
  if (!mailConfigured() && env().NODE_ENV === 'production')
    return { sent: false, email: owner.email };
  const resetUrl = new URL(
    `/reset-password?token=${encodeURIComponent(token)}`,
    env().APP_BASE_URL,
  ).toString();
  try {
    await mailer().send(passwordResetEmail(owner.email, resetUrl));
    return { sent: true, email: owner.email };
  } catch (error) {
    console.error('[admin] password reset email failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, email: owner.email };
  }
}

export async function warnOwner(input: {
  businessId: string;
  actor: Actor;
  reason: string;
  message: string;
}): Promise<{ sent: boolean }> {
  const database = db();
  const [row] = await database
    .select({ name: businesses.name, email: users.email })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .where(eq(businesses.id, input.businessId))
    .limit(1);
  if (!row) throw new Error('no owner');
  await new AbuseService(database).warn(input.businessId, {
    actor: input.actor,
    reason: input.reason,
    message: input.message,
  });
  if (!mailConfigured() && env().NODE_ENV === 'production') return { sent: false };
  try {
    await mailer().send(
      abuseWarningEmail(row.email, {
        businessName: row.name,
        message: input.message,
        supportEmail: env().EMAIL_FROM,
      }),
    );
    return { sent: true };
  } catch (error) {
    console.error('[admin] warning email failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false };
  }
}

/** The privacy hash of a request address, for the token row — never the address itself. */
export function hashedIp(ip: string): string | null {
  return ip ? privacyHash(ip, env().HASH_PEPPER) : null;
}
