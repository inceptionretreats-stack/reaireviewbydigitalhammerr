import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { sessions, userInvites, users } from '@ai-review/db';
import { AuditWriter } from '../audit/writer';
import { auditActorType, type AdminAction } from '../billing/subscription-service';
import type { Executor } from '../db-executor';
import type { PasswordHasher } from './password';
import { hashToken, issueToken } from './tokens';

/**
 * The admin team (AMENDMENT-027; 19_Admin_Panel_Spec "Super-admin account only", 05_RBAC's
 * SUPER_ADMIN and BUSINESS_SUPPORT_VIEWER).
 *
 * Until this existed the only way to make an admin was a script against the database. Now an
 * admin invites another by email; the link sets a password, and the first sign-in enrols the
 * authenticator. Every change of who may administer the platform is a high-risk audit row:
 * `user.invite.create`, `user.role.change`, `user.disable`, `user.enable`.
 *
 * Two guards keep the team from locking itself out: nobody can change or disable their own
 * account here, and the last enabled SUPER_ADMIN cannot be demoted or disabled.
 */

export type AdminRole = 'SUPER_ADMIN' | 'BUSINESS_SUPPORT_VIEWER';

export const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export class TeamError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'SELF_TARGET'
      | 'LAST_SUPER_ADMIN'
      | 'ALREADY_MEMBER'
      | 'INVITE_INVALID'
      | 'UNSUPPORTED_ROLE'
      | 'CREDENTIAL_REQUIRED'
      | 'WEAK_PASSWORD',
    message: string,
  ) {
    super(message);
    this.name = 'TeamError';
  }
}

export interface TeamMember {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  mfaEnabledAt: Date | null;
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  createdAt: Date;
}

export interface PendingInvite {
  id: string;
  email: string;
  fullName: string | null;
  role: AdminRole;
  invitedBy: string;
  expiresAt: Date;
  createdAt: Date;
}

export class TeamService {
  constructor(
    private readonly db: Executor,
    private readonly deps: { hasher: PasswordHasher },
  ) {}

  async list(): Promise<{ members: TeamMember[]; invites: PendingInvite[] }> {
    const members = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        mfaEnabledAt: users.mfaEnabledAt,
        lastLoginAt: users.lastLoginAt,
        disabledAt: users.disabledAt,
        disabledReason: users.disabledReason,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(
        and(
          sql`${users.role} IN ('SUPER_ADMIN', 'BUSINESS_SUPPORT_VIEWER')`,
          isNull(users.deletedAt),
        ),
      )
      .orderBy(users.createdAt);
    const invites = await this.db
      .select({
        id: userInvites.id,
        email: userInvites.email,
        fullName: userInvites.fullName,
        role: userInvites.role,
        invitedBy: userInvites.invitedByUserId,
        expiresAt: userInvites.expiresAt,
        createdAt: userInvites.createdAt,
      })
      .from(userInvites)
      .where(
        and(
          sql`${userInvites.role} IN ('SUPER_ADMIN', 'BUSINESS_SUPPORT_VIEWER')`,
          isNull(userInvites.acceptedAt),
          isNull(userInvites.revokedAt),
          gt(userInvites.expiresAt, new Date()),
        ),
      )
      .orderBy(userInvites.createdAt);
    return {
      members: members.map((m) => ({ ...m, role: m.role as AdminRole })),
      invites: invites.map((i) => ({ ...i, role: i.role as AdminRole })),
    };
  }

  async get(userId: string): Promise<TeamMember | null> {
    const { members } = await this.list();
    return members.find((m) => m.id === userId) ?? null;
  }

  /** An emailed link. The plaintext token exists only in the returned URL. */
  async invite(
    input: AdminAction & { email: string; fullName: string; role: AdminRole; ttlMs?: number },
  ): Promise<{ inviteId: string; token: string; expiresAt: Date }> {
    if (!input.actor.userId)
      throw new TeamError('SELF_TARGET', 'an invite needs a person behind it');
    const email = input.email.trim().toLowerCase();
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    if (existing) throw new TeamError('ALREADY_MEMBER', 'that email already has an account');

    const { token, tokenHash } = issueToken();
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? INVITE_TTL_MS));
    return this.db.transaction(async (tx) => {
      // One live invite per address: a second invite supersedes the first.
      await tx
        .update(userInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userInvites.email, email),
            isNull(userInvites.acceptedAt),
            isNull(userInvites.revokedAt),
          ),
        );
      const [row] = await tx
        .insert(userInvites)
        .values({
          email,
          fullName: input.fullName.trim(),
          role: input.role,
          invitedByUserId: input.actor.userId!,
          tokenHash,
          expiresAt,
        })
        .returning({ id: userInvites.id });
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        action: 'user.invite.create',
        targetType: 'invite',
        targetId: row!.id,
        reason: input.reason,
        ipHash: input.actor.ipHash ?? null,
        after: { email, role: input.role, expires_at: expiresAt.toISOString() },
      });
      return { inviteId: row!.id, token, expiresAt };
    });
  }

  async revokeInvite(inviteId: string, input: AdminAction): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(userInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userInvites.id, inviteId),
            isNull(userInvites.acceptedAt),
            isNull(userInvites.revokedAt),
          ),
        )
        .returning({ email: userInvites.email, role: userInvites.role });
      if (!row) throw new TeamError('NOT_FOUND', 'no live invite with that id');
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        action: 'user.invite.revoke',
        targetType: 'invite',
        targetId: inviteId,
        reason: input.reason,
        ipHash: input.actor.ipHash ?? null,
        before: { email: row.email, role: row.role },
      });
    });
  }

  /** The link's other end: single use, expiring, creates the account. */
  async acceptInvite(input: {
    token: string;
    password: string;
  }): Promise<{ userId: string; role: AdminRole }> {
    const tokenHash = hashToken(input.token);
    return this.db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(userInvites)
        .where(eq(userInvites.tokenHash, tokenHash))
        .for('update')
        .limit(1);
      if (
        !invite ||
        invite.acceptedAt ||
        invite.revokedAt ||
        invite.expiresAt.getTime() <= Date.now()
      ) {
        throw new TeamError('INVITE_INVALID', 'that invitation is not valid any more');
      }
      if (invite.role !== 'SUPER_ADMIN' && invite.role !== 'BUSINESS_SUPPORT_VIEWER') {
        throw new TeamError('UNSUPPORTED_ROLE', 'owner invitations are not built yet (Flow B)');
      }
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, invite.email), isNull(users.deletedAt)))
        .limit(1);
      if (taken) throw new TeamError('ALREADY_MEMBER', 'that email already has an account');

      const passwordHash = await this.deps.hasher.hash(input.password);
      const [created] = await tx
        .insert(users)
        .values({
          email: invite.email,
          fullName: invite.fullName ?? invite.email,
          passwordHash,
          role: invite.role,
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });
      await tx
        .update(userInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(userInvites.id, invite.id));
      await new AuditWriter(tx).record({
        actorUserId: created!.id,
        action: 'user.invite.accept',
        targetType: 'user',
        targetId: created!.id,
        after: { role: invite.role, invited_by: invite.invitedByUserId },
      });
      return { userId: created!.id, role: invite.role };
    });
  }

  async changeRole(targetUserId: string, input: AdminAction & { role: AdminRole }): Promise<void> {
    if (targetUserId === input.actor.userId)
      throw new TeamError('SELF_TARGET', 'change your own role from another admin account');
    await this.db.transaction(async (tx) => {
      const target = await this.lock(tx, targetUserId);
      if (!target.passwordHash) {
        throw new TeamError(
          'CREDENTIAL_REQUIRED',
          'a passwordless account cannot use admin sign-in',
        );
      }
      if (target.role === 'SUPER_ADMIN' && input.role !== 'SUPER_ADMIN') {
        await this.assertNotLastSuperAdmin(tx, targetUserId);
      }
      await tx
        .update(users)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));
      await this.revokeSessions(tx, targetUserId, 'ROLE_CHANGED');
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        action: 'user.role.change',
        targetType: 'user',
        targetId: targetUserId,
        reason: input.reason,
        ipHash: input.actor.ipHash ?? null,
        before: { role: target.role },
        after: { role: input.role },
      });
    });
  }

  async disable(targetUserId: string, input: AdminAction): Promise<void> {
    if (targetUserId === input.actor.userId)
      throw new TeamError('SELF_TARGET', 'you cannot disable yourself');
    await this.db.transaction(async (tx) => {
      const target = await this.lock(tx, targetUserId);
      if (target.role === 'SUPER_ADMIN') await this.assertNotLastSuperAdmin(tx, targetUserId);
      await tx
        .update(users)
        .set({
          disabledAt: new Date(),
          disabledReason: input.reason.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetUserId));
      await this.revokeSessions(tx, targetUserId, 'ACCOUNT_DISABLED');
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        action: 'user.disable',
        targetType: 'user',
        targetId: targetUserId,
        reason: input.reason,
        ipHash: input.actor.ipHash ?? null,
        before: { disabled: target.disabledAt !== null },
        after: { disabled: true },
      });
    });
  }

  async enable(targetUserId: string, input: AdminAction): Promise<void> {
    await this.db.transaction(async (tx) => {
      const target = await this.lock(tx, targetUserId);
      await tx
        .update(users)
        .set({ disabledAt: null, disabledReason: null, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        action: 'user.enable',
        targetType: 'user',
        targetId: targetUserId,
        reason: input.reason,
        ipHash: input.actor.ipHash ?? null,
        before: { disabled: target.disabledAt !== null },
        after: { disabled: false },
      });
    });
  }

  private async lock(tx: Executor, userId: string) {
    const [target] = await tx
      .select({
        id: users.id,
        role: users.role,
        passwordHash: users.passwordHash,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .for('update')
      .limit(1);
    if (!target) throw new TeamError('NOT_FOUND', 'no such account');
    return target;
  }

  private async assertNotLastSuperAdmin(tx: Executor, exceptUserId: string): Promise<void> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.role, 'SUPER_ADMIN'),
          isNull(users.deletedAt),
          isNull(users.disabledAt),
          sql`${users.id} <> ${exceptUserId}`,
        ),
      );
    if ((row?.count ?? 0) === 0) {
      throw new TeamError('LAST_SUPER_ADMIN', 'there must always be one enabled platform admin');
    }
  }

  private async revokeSessions(tx: Executor, userId: string, reason: string): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
