import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { AuditReasonRequiredError } from '../../audit/writer';
import { PasswordHasher } from '../../auth/password';
import { SessionService } from '../../auth/session';
import { TeamError, TeamService } from '../../auth/team-service';

/**
 * AMENDMENT-027 — the admin team against the real schema: invitations are single-use and
 * expiring, the last platform admin cannot be removed, nobody edits themselves, and a disabled
 * account's sessions are gone.
 */
describe('TeamService', () => {
  let pool: Pool;
  let db: Database;
  let adminId: string;
  let otherId: string;
  const hasher = new PasswordHasher({ pepper: 'team-test-pepper' });
  const service = () => new TeamService(db, { hasher });
  const actor = () => ({ userId: adminId, ipHash: null });

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 8 });
    db = createDatabase({ connectionString, poolMax: 8 });
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM admin_audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE $1)
         OR target_id IN (SELECT id::text FROM users WHERE email LIKE $1)
         OR target_id IN (SELECT id::text FROM user_invites WHERE email LIKE $1)`,
      ['team-%@example.test'],
    );
    await pool.query('DELETE FROM user_invites WHERE email LIKE $1', ['team-%@example.test']);
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['team-%@example.test']);
    await pool.end();
  });

  beforeEach(async () => {
    adminId = randomUUID();
    otherId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role) VALUES
         ($1, $2, 'Team Admin', 'x', 'SUPER_ADMIN'),
         ($3, $4, 'Team Other', 'x', 'SUPER_ADMIN')`,
      [adminId, `team-${adminId}@example.test`, otherId, `team-${otherId}@example.test`],
    );
  });

  it('invites, and the link creates the account once with the role and name the invite carried', async () => {
    const email = `team-invitee-${randomUUID()}@example.test`;
    const invite = await service().invite({
      actor: actor(),
      reason: 'New support hire',
      email,
      fullName: 'Support Person',
      role: 'BUSINESS_SUPPORT_VIEWER',
    });
    expect(invite.token.length).toBeGreaterThan(20);

    const accepted = await service().acceptInvite({
      token: invite.token,
      password: 'A-strong-password-1234',
    });
    expect(accepted.role).toBe('BUSINESS_SUPPORT_VIEWER');
    const { rows } = await pool.query(
      'SELECT full_name, role, email_verified_at IS NOT NULL AS verified FROM users WHERE id = $1',
      [accepted.userId],
    );
    expect(rows[0]).toEqual({
      full_name: 'Support Person',
      role: 'BUSINESS_SUPPORT_VIEWER',
      verified: true,
    });
    expect(
      await hasher.verify(
        (await pool.query('SELECT password_hash FROM users WHERE id = $1', [accepted.userId]))
          .rows[0].password_hash,
        'A-strong-password-1234',
      ),
    ).toBe(true);

    // Single use.
    await expect(
      service().acceptInvite({ token: invite.token, password: 'Another-strong-one-123' }),
    ).rejects.toMatchObject({ code: 'INVITE_INVALID' });
    // Inviting an existing account is refused.
    await expect(
      service().invite({
        actor: actor(),
        reason: 'dup',
        email,
        fullName: 'x',
        role: 'SUPER_ADMIN',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_MEMBER' });
    // The audit trail names the invitation and the acceptance.
    const { rows: audit } = await pool.query(
      `SELECT action FROM admin_audit_logs WHERE target_id IN ($1, $2) ORDER BY id`,
      [invite.inviteId, accepted.userId],
    );
    expect(audit.map((a) => a.action)).toEqual(['user.invite.create', 'user.invite.accept']);
  });

  it('refuses an expired or withdrawn invitation, and a second invite supersedes the first', async () => {
    const email = `team-invitee-${randomUUID()}@example.test`;
    const expired = await service().invite({
      actor: actor(),
      reason: 'x',
      email,
      fullName: 'x',
      role: 'SUPER_ADMIN',
      ttlMs: -1,
    });
    await expect(
      service().acceptInvite({ token: expired.token, password: 'A-strong-password-1234' }),
    ).rejects.toMatchObject({ code: 'INVITE_INVALID' });

    const first = await service().invite({
      actor: actor(),
      reason: 'x',
      email,
      fullName: 'x',
      role: 'SUPER_ADMIN',
    });
    const second = await service().invite({
      actor: actor(),
      reason: 'x',
      email,
      fullName: 'x',
      role: 'SUPER_ADMIN',
    });
    await expect(
      service().acceptInvite({ token: first.token, password: 'A-strong-password-1234' }),
    ).rejects.toMatchObject({ code: 'INVITE_INVALID' });
    await service().revokeInvite(second.inviteId, { actor: actor(), reason: 'changed mind' });
    await expect(
      service().acceptInvite({ token: second.token, password: 'A-strong-password-1234' }),
    ).rejects.toMatchObject({ code: 'INVITE_INVALID' });
    expect((await service().list()).invites.some((i) => i.email === email)).toBe(false);
  });

  it('keeps one platform admin, forbids self-edits, and requires a reason', async () => {
    await expect(
      service().changeRole(adminId, {
        actor: actor(),
        reason: 'x',
        role: 'BUSINESS_SUPPORT_VIEWER',
      }),
    ).rejects.toMatchObject({ code: 'SELF_TARGET' });
    await expect(service().disable(adminId, { actor: actor(), reason: 'x' })).rejects.toMatchObject(
      {
        code: 'SELF_TARGET',
      },
    );
    await expect(service().disable(otherId, { actor: actor(), reason: '' })).rejects.toBeInstanceOf(
      AuditReasonRequiredError,
    );

    // The guard counts every enabled platform admin in the table, so make this test's admin
    // the only one for a moment (the shared database has others), restoring them afterwards.
    const { rows: others } = await pool.query(
      `UPDATE users SET disabled_at = now()
        WHERE role = 'SUPER_ADMIN' AND disabled_at IS NULL AND deleted_at IS NULL AND id <> $1
        RETURNING id`,
      [adminId],
    );
    try {
      const otherActor = { userId: otherId, ipHash: null };
      await expect(
        service().disable(adminId, { actor: otherActor, reason: 'x' }),
      ).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
      await expect(
        service().changeRole(adminId, {
          actor: otherActor,
          reason: 'x',
          role: 'BUSINESS_SUPPORT_VIEWER',
        }),
      ).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
      // With a second enabled admin the same actions go through.
      await service().enable(otherId, { actor: actor(), reason: 'second admin' });
      await service().changeRole(adminId, {
        actor: otherActor,
        reason: 'x',
        role: 'BUSINESS_SUPPORT_VIEWER',
      });
      expect((await service().get(adminId))?.role).toBe('BUSINESS_SUPPORT_VIEWER');
    } finally {
      await pool.query(`UPDATE users SET disabled_at = NULL WHERE id = ANY($1::uuid[])`, [
        others.map((r) => r.id),
      ]);
    }
  });

  it('disabling revokes every session and enabling brings the account back', async () => {
    const sessions = new SessionService(db);
    const live = await sessions.create({ userId: otherId });
    await service().disable(otherId, { actor: actor(), reason: 'Left the company' });
    expect(await sessions.resolve(live.token)).toBeNull();
    const member = await service().get(otherId);
    expect(member?.disabledAt).not.toBeNull();
    expect(member?.disabledReason).toBe('Left the company');

    await service().enable(otherId, { actor: actor(), reason: 'Back' });
    expect((await service().get(otherId))?.disabledAt).toBeNull();
    const { rows } = await pool.query(
      `SELECT action, reason FROM admin_audit_logs WHERE target_id = $1 ORDER BY id`,
      [otherId],
    );
    expect(rows.map((r) => r.action)).toEqual(['user.disable', 'user.enable']);
  });

  it('is a TeamError for an unknown account', async () => {
    await expect(
      service().enable(randomUUID(), { actor: actor(), reason: 'x' }),
    ).rejects.toBeInstanceOf(TeamError);
  });
});
