import { and, eq, isNull, sql } from 'drizzle-orm';
import { mfaRecoveryCodes, sessions, users } from '@ai-review/db';
import { AuditWriter } from '../audit/writer';
import { auditActorType, type AdminAction } from '../audit/actor';
import type { Executor } from '../db-executor';
import type { SecretBox } from '../crypto/secret-box';
import { privacyHash } from './tokens';
import {
  base32Decode,
  base32Encode,
  formatManualKey,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from './totp';

/**
 * Admin MFA (AMENDMENT-027; 19_Admin_Panel_Spec "MFA mandatory", 13_Security L7, E13-01).
 *
 * Enrolment is two steps so a secret nobody managed to scan is never armed: `startEnrolment`
 * writes a sealed pending secret, `confirmEnrolment` proves the app produces the right code
 * and only then sets `mfa_enabled_at` and issues eight one-time recovery codes. The seed is
 * sealed at rest by `SecretBox`; the recovery codes are stored as peppered hashes, the same
 * class of secret as a session token, and each is spent with one conditional UPDATE so two
 * submissions of the same code cannot both succeed.
 *
 * Replay: the accepted TOTP step is remembered on the user, and a code whose step is at or
 * before it is refused. A step that a concurrent request already claimed loses the race on the
 * conditional UPDATE and is refused too.
 */

export const RECOVERY_CODE_COUNT = 8;
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export interface MfaDeps {
  box: SecretBox;
  pepper: string;
  issuer: string;
  now?: () => number;
}

export type MfaFailure = 'INVALID' | 'REPLAY' | 'NOT_ENROLLED' | 'ALREADY_ENROLLED' | 'NO_PENDING';
export type MfaOutcome = { ok: true; step: bigint } | { ok: false; reason: MfaFailure };

export interface EnrolmentStart {
  secretBase32: string;
  manualKey: string;
  otpauthUri: string;
}

export class MfaService {
  constructor(
    private readonly db: Executor,
    private readonly deps: MfaDeps,
  ) {}

  /** The pending secret (new, or the one already pending). Refused once MFA is enabled. */
  async startEnrolment(
    userId: string,
    account: string,
  ): Promise<EnrolmentStart | { error: 'ALREADY_ENROLLED' }> {
    const [user] = await this.db
      .select({ mfaEnabledAt: users.mfaEnabledAt, mfaSecret: users.mfaSecret })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new Error(`no user ${userId}`);
    if (user.mfaEnabledAt) return { error: 'ALREADY_ENROLLED' };

    // Idempotent while pending: a reload, a double-fired effect or a second tab all see the
    // same key, so the code the app produces always matches what the row holds.
    let secret: Uint8Array;
    if (user.mfaSecret) {
      try {
        secret = this.deps.box.open(user.mfaSecret, aad(userId));
      } catch {
        secret = generateTotpSecret();
      }
    } else {
      secret = generateTotpSecret();
    }
    const secretBase32 = base32Encode(secret);
    await this.db
      .update(users)
      .set({
        mfaSecret: this.deps.box.seal(secret, aad(userId)),
        mfaLastUsedStep: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return {
      secretBase32,
      manualKey: formatManualKey(secretBase32),
      otpauthUri: otpauthUri({ issuer: this.deps.issuer, account, secretBase32 }),
    };
  }

  /** Proves the app has the secret, arms MFA, and hands out the recovery codes exactly once. */
  async confirmEnrolment(
    userId: string,
    code: string,
    actor: { ipHash?: string | null } = {},
  ): Promise<(MfaOutcome & { ok: true; recoveryCodes: string[] }) | (MfaOutcome & { ok: false })> {
    const [user] = await this.db
      .select({ mfaSecret: users.mfaSecret, mfaEnabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new Error(`no user ${userId}`);
    if (user.mfaEnabledAt) return { ok: false, reason: 'ALREADY_ENROLLED' };
    if (!user.mfaSecret) return { ok: false, reason: 'NO_PENDING' };

    const secret = this.deps.box.open(user.mfaSecret, aad(userId));
    const verified = verifyTotp(secret, code, { timeMs: this.now() });
    if (!verified.ok) return { ok: false, reason: verified.reason };

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ mfaEnabledAt: new Date(), mfaLastUsedStep: verified.step, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
      await tx
        .insert(mfaRecoveryCodes)
        .values(codes.map((c) => ({ userId, codeHash: this.hashCode(c) })));
      await new AuditWriter(tx).record({
        actorUserId: userId,
        action: 'user.mfa.enrolled',
        targetType: 'user',
        targetId: userId,
        ipHash: actor.ipHash ?? null,
        after: { mfa_enabled: true, recovery_codes: RECOVERY_CODE_COUNT },
      });
    });
    return { ok: true, step: verified.step, recoveryCodes: codes };
  }

  /** The login-time and step-up challenge. */
  async verifyCode(userId: string, code: string): Promise<MfaOutcome> {
    const [user] = await this.db
      .select({
        mfaSecret: users.mfaSecret,
        mfaEnabledAt: users.mfaEnabledAt,
        mfaLastUsedStep: users.mfaLastUsedStep,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || !user.mfaEnabledAt || !user.mfaSecret)
      return { ok: false, reason: 'NOT_ENROLLED' };

    const secret = this.deps.box.open(user.mfaSecret, aad(userId));
    const verified = verifyTotp(secret, code, {
      timeMs: this.now(),
      notBeforeStep: user.mfaLastUsedStep,
    });
    if (!verified.ok) return verified;

    // Claim the step. A concurrent request with the same code loses here and is refused —
    // that is what makes "once" true under a double submit, not the read above.
    const claimed = await this.db
      .update(users)
      .set({ mfaLastUsedStep: verified.step })
      .where(
        and(
          eq(users.id, userId),
          sql`${users.mfaLastUsedStep} IS NULL OR ${users.mfaLastUsedStep} < ${verified.step}`,
        ),
      )
      .returning({ id: users.id });
    if (claimed.length === 0) return { ok: false, reason: 'REPLAY' };
    return verified;
  }

  /** Spends one recovery code. Atomic: the UPDATE is the check. */
  async consumeRecoveryCode(
    userId: string,
    code: string,
    actor: { ipHash?: string | null } = {},
  ): Promise<{ ok: true; remaining: number } | { ok: false }> {
    const hash = this.hashCode(code);
    const spent = await this.db
      .update(mfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(mfaRecoveryCodes.userId, userId),
          eq(mfaRecoveryCodes.codeHash, hash),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: mfaRecoveryCodes.id });
    if (spent.length === 0) return { ok: false };

    const [count] = await this.db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(mfaRecoveryCodes)
      .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
    await new AuditWriter(this.db).record({
      actorUserId: userId,
      action: 'user.mfa.recovery_code_used',
      targetType: 'user',
      targetId: userId,
      ipHash: actor.ipHash ?? null,
      after: { remaining: count?.remaining ?? 0 },
    });
    return { ok: true, remaining: count?.remaining ?? 0 };
  }

  /** Replaces every recovery code. The caller must have verified a fresh TOTP first. */
  async regenerateRecoveryCodes(
    userId: string,
    actor: { ipHash?: string | null } = {},
  ): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
    await this.db.transaction(async (tx) => {
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
      await tx
        .insert(mfaRecoveryCodes)
        .values(codes.map((c) => ({ userId, codeHash: this.hashCode(c) })));
      await new AuditWriter(tx).record({
        actorUserId: userId,
        action: 'user.mfa.recovery_codes.regenerated',
        targetType: 'user',
        targetId: userId,
        ipHash: actor.ipHash ?? null,
        after: { recovery_codes: RECOVERY_CODE_COUNT },
      });
    });
    return codes;
  }

  async remainingRecoveryCodes(userId: string): Promise<number> {
    const [count] = await this.db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(mfaRecoveryCodes)
      .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
    return count?.remaining ?? 0;
  }

  /**
   * Clears another admin's MFA so they can enrol again (lost phone). High-risk: reason
   * required, every one of their sessions revoked, audited against the target.
   */
  async reset(targetUserId: string, input: AdminAction): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ mfaEnabledAt: users.mfaEnabledAt })
        .from(users)
        .where(eq(users.id, targetUserId))
        .for('update')
        .limit(1);
      if (!before) throw new Error(`no user ${targetUserId}`);
      await tx
        .update(users)
        .set({ mfaSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, targetUserId));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'MFA_RESET' })
        .where(and(eq(sessions.userId, targetUserId), isNull(sessions.revokedAt)));
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        action: 'user.mfa.reset',
        targetType: 'user',
        targetId: targetUserId,
        reason: input.reason,
        ipHash: input.actor.ipHash ?? null,
        before: { mfa_enabled_at: before.mfaEnabledAt?.toISOString() ?? null },
        after: { mfa_enabled_at: null },
      });
    });
  }

  /**
   * Arms MFA from a known secret without the app round-trip. For the break-glass script and
   * the E2E suite only; the web app never calls it.
   */
  async installSecret(userId: string, secretBase32: string): Promise<void> {
    const secret = base32Decode(secretBase32);
    await this.db
      .update(users)
      .set({
        mfaSecret: this.deps.box.seal(secret, aad(userId)),
        mfaEnabledAt: new Date(),
        mfaLastUsedStep: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  private hashCode(code: string): string {
    return privacyHash(normaliseRecoveryCode(code), this.deps.pepper);
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}

function aad(userId: string): string {
  return `mfa:${userId}`;
}

/** XXXXX-XXXXX from a 31-character alphabet: ~50 bits, unambiguous when read aloud. */
export function generateRecoveryCode(): string {
  const bytes = generateTotpSecret(10);
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length];
    if (i === 4) out += '-';
  }
  return out;
}

export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
