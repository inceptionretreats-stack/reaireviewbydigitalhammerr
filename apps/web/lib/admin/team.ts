import { NextResponse } from 'next/server';
import { TeamError, TeamService } from '@ai-review/core';
import { apiError } from '@/lib/http/api-error';
import { passwordHasher } from '@/lib/auth/password-hasher';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';

/** AMENDMENT-027 — the team service composed for the web app, and its error mapping. */
export function teamService(): TeamService {
  return new TeamService(db(), { hasher: passwordHasher() });
}

export function inviteUrl(token: string): string {
  return `${env().APP_BASE_URL}/invite?token=${encodeURIComponent(token)}`;
}

/** Maps a TeamError to the API envelope, or returns null for anything else. */
export function teamErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof TeamError)) return null;
  switch (error.code) {
    case 'NOT_FOUND':
      return apiError('RESOURCE_NOT_FOUND', 'No such team member.');
    case 'SELF_TARGET':
      return apiError('VALIDATION_FAILED', 'You cannot do that to your own account.', {
        details: { fields: ['id'] },
      });
    case 'LAST_SUPER_ADMIN':
      return apiError('VALIDATION_FAILED', 'There must always be one enabled platform admin.', {
        details: { fields: ['id'] },
      });
    case 'ALREADY_MEMBER':
      return apiError('VALIDATION_FAILED', 'That email already has an account.', {
        details: { fields: ['email'] },
      });
    case 'INVITE_INVALID':
      return apiError('INVITE_INVALID', 'That invitation has expired or was already used.');
    case 'UNSUPPORTED_ROLE':
      return apiError('VALIDATION_FAILED', 'Only admin roles can be invited here.', {
        details: { fields: ['role'] },
      });
    case 'CREDENTIAL_REQUIRED':
      return apiError(
        'VALIDATION_FAILED',
        'This account uses Google only and cannot use admin sign-in.',
        {
          details: { fields: ['role'] },
        },
      );
    case 'WEAK_PASSWORD':
      return apiError('VALIDATION_FAILED', error.message, { details: { fields: ['password'] } });
  }
}
