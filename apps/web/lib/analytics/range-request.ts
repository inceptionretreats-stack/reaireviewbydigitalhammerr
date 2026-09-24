import type { NextResponse } from 'next/server';
import type { Database } from '@ai-review/db';
import { apiError } from '@/lib/http/api-error';
import { loadBusinessTimeZone } from '@/lib/analytics/queries';
import {
  describeRangeRejection,
  resolveAnalyticsRange,
  type AnalyticsRange,
} from '@/lib/analytics/range';

/**
 * The `?from=&to=` half of all three analytics endpoints, in one place.
 *
 * Shared for the same reason `requireTenant` is: three handlers each resolving a date range would
 * be three chances for one of them to fall back to UTC, and AC-026 would then hold on two screens
 * out of three with nothing to show which.
 *
 * The timezone is read from `businesses.timezone` (AMENDMENT-004) using the tenant id the session
 * resolved — never from a query parameter. A client-supplied timezone would let a caller shift
 * another day's numbers into their range, which is a smaller problem than a cross-tenant read but
 * the same mistake: trusting the request for something the server already knows.
 *
 * Outcome shape mirrors `TenantOutcome` so a handler reads the same way for both guards.
 */

export type RangeOutcome =
  { ok: true; range: AnalyticsRange } | { ok: false; response: NextResponse };

export async function analyticsRangeFor(
  db: Database,
  businessId: string,
  request: Request,
): Promise<RangeOutcome> {
  const params = new URL(request.url).searchParams;
  const timeZone = await loadBusinessTimeZone(db, businessId);

  const resolution = resolveAnalyticsRange({
    from: params.get('from'),
    to: params.get('to'),
    timeZone,
    now: new Date(),
  });

  if (!resolution.ok) {
    return {
      ok: false,
      response: apiError('VALIDATION_FAILED', describeRangeRejection(resolution.reason), {
        details: { fields: [...resolution.fields] },
      }),
    };
  }

  return { ok: true, range: resolution.range };
}

/**
 * Wire form of a resolved range.
 *
 * The timezone is part of every response, not an optional extra: AC-026 makes the day boundary a
 * property of the tenant, so a count of "scans on 12 August" is uninterpretable without the zone
 * that decided when the 12th began and ended. `timezone_is_default` says whether that zone is the
 * tenant's own or the documented Asia/Kolkata fallback standing in for an unusable value.
 */
export function serializeRange(range: AnalyticsRange): Record<string, unknown> {
  return {
    from: range.from,
    to: range.to,
    timezone: range.timeZone,
    timezone_is_default: range.usedDefaultTimeZone,
    /** True when a requested future date was pulled back to the tenant's today. */
    clamped_future: range.clampedFuture,
    includes_today: range.includesToday,
    /**
     * True when the range reaches past the 13-month retention on `analytics_events`. Rollup rows
     * outlive the events they came from, so a caller charting that far back can see trend numbers
     * with no live figures behind them, and should say so rather than reconcile the two.
     */
    beyond_event_retention: range.beyondEventRetention,
    days: range.days.length,
  };
}
