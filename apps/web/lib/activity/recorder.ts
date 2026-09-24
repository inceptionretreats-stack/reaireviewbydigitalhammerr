import { after } from 'next/server';
import {
  ActivityRecorder,
  privacyHash,
  type ActivityAction,
  type ActivityOutcome,
  type SessionContext,
} from '@ai-review/core';
import { db } from '../infra/db';
import { env } from '../infra/env';
import { clientIp } from '../http/rate-limit';

/**
 * Recording what a signed-in person did (AMENDMENT-028).
 *
 * One line per route, after the write it describes: `recordActivity(request, who, entry)`.
 * The insert runs in `after()`, which on a serverless host keeps the function alive until it
 * lands — a dangling promise would be cut off with the response. Nothing here can fail the
 * request: the recorder swallows its own errors and reports them to the log.
 *
 * The address is hashed with HASH_PEPPER before it is stored, the same hash the rate limiter
 * and the session row use, so one visitor is one value across the system and no raw IP is
 * ever kept (13_Security_Privacy_Compliance.md).
 */

let recorder: ActivityRecorder | undefined;

export function activityRecorder(): ActivityRecorder {
  recorder ??= new ActivityRecorder(db(), {
    onError: (error, entry) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[activity] ${entry.action} not recorded: ${message}`);
    },
  });
  return recorder;
}

export function requestMeta(request: Request): { ipHash: string | null; userAgent: string | null } {
  const ip = clientIp(request);
  return {
    ipHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null,
    userAgent: request.headers.get('user-agent'),
  };
}

export interface ActivityWho {
  session?: SessionContext | null;
  userId?: string | null;
  businessId?: string | null;
}

export interface ActivityWhat {
  action: ActivityAction;
  outcome?: ActivityOutcome;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export function recordActivity(request: Request, who: ActivityWho, what: ActivityWhat): void {
  const meta = requestMeta(request);
  const entry = {
    userId: who.userId ?? who.session?.userId ?? null,
    businessId: who.businessId ?? null,
    sessionId: who.session?.sessionId ?? null,
    action: what.action,
    outcome: what.outcome ?? 'SUCCESS',
    targetType: what.targetType ?? null,
    targetId: what.targetId ?? null,
    metadata: what.metadata,
    ipHash: meta.ipHash,
    userAgent: meta.userAgent,
  };
  try {
    after(() => activityRecorder().record(entry));
  } catch {
    // Outside a request scope (a test calling a handler directly): record inline, still safe.
    void activityRecorder().record(entry);
  }
}
