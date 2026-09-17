import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { AuditReasonRequiredError } from '../../audit/writer';
import { MfaService, RECOVERY_CODE_COUNT } from '../../auth/mfa-service';
import { SessionService } from '../../auth/session';
import { base32Decode, totp } from '../../auth/totp';
import { SecretBox } from '../../crypto/secret-box';

/**
 * AMENDMENT-027 against the real schema: the sealed secret, the hashed recovery codes, the
 * atomic single-use consume, and a reset that revokes every session.
 */
describe('MfaService', () => {
  let pool: Pool;
  let db: Database;
  let userId: string;
  let adminId: string;
  const box = new SecretBox('integration-test-master-key-of-32-chars');
  const pepper = 'integration-pepper';
  let clock = Date.now();
  const service = () => new MfaService(db, { box, pepper, issuer: 'Test', now: () => clock });

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 8 });
    db = createDatabase({ connectionString, poolMax: 8 });
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM admin_audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE $1)
         OR target_id IN (SELECT id::text FROM users WHERE email LIKE $1)`,
      ['mfa-%@example.test'],
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['mfa-%@example.test']);
    await pool.end();
  });

  beforeEach(async () => {
    userId = randomUUID();
    adminId = randomUUID();
    clock = Date.now();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role) VALUES
         ($1, $2, 'Mfa Subject', 'x', 'SUPER_ADMIN'),
         ($3, $4, 'Mfa Admin', 'x', 'SUPER_ADMIN')`,
      [userId, `mfa-${userId}@example.test`, adminId, `mfa-${adminId}@example.test`],
    );
  });

  it('enrols in two steps, seals the secret, and issues eight hashed recovery codes once', async () => {
    const started = await service().startEnrolment(userId, 'mfa@example.test');
    if ('error' in started) throw new Error('unexpected');
    const secret = base32Decode(started.secretBase32);

    const { rows: pending } = await pool.query(
      'SELECT mfa_secret, mfa_enabled_at FROM users WHERE id = $1',
      [userId],
    );
    expect(pending[0].mfa_enabled_at).toBeNull();
    expect(pending[0].mfa_secret).toMatch(/^v1\./);
    expect(pending[0].mfa_secret).not.toContain(started.secretBase32);
    // Not enabled: the challenge refuses, and a wrong code does not arm anything.
    expect(await service().verifyCode(userId, totp(secret, { timeMs: clock }))).toEqual({
      ok: false,
      reason: 'NOT_ENROLLED',
    });
    expect((await service().confirmEnrolment(userId, '000000')).ok).toBe(false);

    const confirmed = await service().confirmEnrolment(userId, totp(secret, { timeMs: clock }));
    if (!confirmed.ok) throw new Error('confirm failed');
    expect(confirmed.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    const { rows: codes } = await pool.query(
      'SELECT code_hash, used_at FROM mfa_recovery_codes WHERE user_id = $1',
      [userId],
    );
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of confirmed.recoveryCodes) {
      expect(codes.map((c) => c.code_hash)).not.toContain(code);
    }
    const { rows: audit } = await pool.query(
      `SELECT action FROM admin_audit_logs WHERE actor_user_id = $1 ORDER BY id`,
      [userId],
    );
    expect(audit.map((a) => a.action)).toEqual(['user.mfa.enrolled']);

    // Enrolment cannot be restarted over an armed account.
    expect(await service().startEnrolment(userId, 'x')).toEqual({ error: 'ALREADY_ENROLLED' });
  });

  it('accepts a code once per step and refuses the replay, even under a concurrent double submit', async () => {
    const started = await service().startEnrolment(userId, 'mfa@example.test');
    if ('error' in started) throw new Error('unexpected');
    const secret = base32Decode(started.secretBase32);
    await service().confirmEnrolment(userId, totp(secret, { timeMs: clock }));

    // The confirming code's step is spent; move one step on.
    clock += 30_000;
    const code = totp(secret, { timeMs: clock });
    const results = await Promise.all([
      service().verifyCode(userId, code),
      service().verifyCode(userId, code),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'REPLAY')).toHaveLength(1);
    expect(await service().verifyCode(userId, code)).toEqual({ ok: false, reason: 'REPLAY' });

    clock += 30_000;
    expect((await service().verifyCode(userId, totp(secret, { timeMs: clock }))).ok).toBe(true);
  });

  it('spends a recovery code exactly once, even when submitted twice at the same time', async () => {
    const started = await service().startEnrolment(userId, 'mfa@example.test');
    if ('error' in started) throw new Error('unexpected');
    const secret = base32Decode(started.secretBase32);
    const confirmed = await service().confirmEnrolment(userId, totp(secret, { timeMs: clock }));
    if (!confirmed.ok) throw new Error('confirm failed');
    const [first] = confirmed.recoveryCodes;

    const [a, b] = await Promise.all([
      service().consumeRecoveryCode(userId, first!.toLowerCase()),
      service().consumeRecoveryCode(userId, first!),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const winner = a.ok ? a : b;
    expect(winner.ok && winner.remaining).toBe(RECOVERY_CODE_COUNT - 1);
    expect((await service().consumeRecoveryCode(userId, first!)).ok).toBe(false);
    expect(await service().remainingRecoveryCodes(userId)).toBe(RECOVERY_CODE_COUNT - 1);
  });

  it('resets another admin only with a reason, clearing the secret and every session', async () => {
    const started = await service().startEnrolment(userId, 'mfa@example.test');
    if ('error' in started) throw new Error('unexpected');
    await service().confirmEnrolment(
      userId,
      totp(base32Decode(started.secretBase32), { timeMs: clock }),
    );
    const sessions = new SessionService(db);
    const live = await sessions.create({ userId });
    expect(await sessions.resolve(live.token)).not.toBeNull();

    await expect(
      service().reset(userId, { actor: { userId: adminId }, reason: '' }),
    ).rejects.toBeInstanceOf(AuditReasonRequiredError);

    await service().reset(userId, { actor: { userId: adminId }, reason: 'Lost phone' });
    const { rows } = await pool.query(
      'SELECT mfa_secret, mfa_enabled_at FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]).toEqual({ mfa_secret: null, mfa_enabled_at: null });
    expect(await service().remainingRecoveryCodes(userId)).toBe(0);
    expect(await sessions.resolve(live.token)).toBeNull();
    const { rows: audit } = await pool.query(
      `SELECT action, reason, actor_user_id FROM admin_audit_logs WHERE target_id = $1 AND action = 'user.mfa.reset'`,
      [userId],
    );
    expect(audit).toEqual([
      { action: 'user.mfa.reset', reason: 'Lost phone', actor_user_id: adminId },
    ]);
  });

  it('a disabled account has no live sessions', async () => {
    const sessions = new SessionService(db);
    const live = await sessions.create({ userId });
    await pool.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [userId]);
    expect(await sessions.resolve(live.token)).toBeNull();
  });

  it('marks a session MFA-verified, extending a pending one and never a verified one', async () => {
    const sessions = new SessionService(db);
    const pending = await sessions.create({ userId, ttlMs: 10 * 60 * 1000 });
    const first = await sessions.markMfaVerified(
      (await sessions.resolve(pending.token))!.sessionId,
      { extendToMs: 12 * 60 * 60 * 1000 },
    );
    expect(first.getTime() - Date.now()).toBeGreaterThan(11 * 60 * 60 * 1000);
    const again = await sessions.markMfaVerified(
      (await sessions.resolve(pending.token))!.sessionId,
      { extendToMs: 48 * 60 * 60 * 1000 },
    );
    expect(again.getTime()).toBe(first.getTime());
    expect((await sessions.resolve(pending.token))!.mfaVerifiedAt).not.toBeNull();
  });
});
