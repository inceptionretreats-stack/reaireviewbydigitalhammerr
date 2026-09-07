import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { analyticsDailyBusiness } from '@ai-review/db';
import { metricDateAsText, rollupEdgeAsText } from '../queries';

/**
 * AC-026 / AMENDMENT-004, defended at the one place the timezone can still be lost after
 * `range.ts` has done everything right: reading `analytics_daily_business.metric_date` back.
 *
 * The defect these pin is not hypothetical. `date('metric_date')` is drizzle's string-mode date
 * column; node-postgres parses a `date` (OID 1082) with postgres-date, which returns a Date at
 * LOCAL midnight, and drizzle's `PgDateString.mapFromDriverValue` then does
 * `value.toISOString().slice(0, -14)`. East of UTC those two disagree by a day — and Asia/Kolkata
 * is this product's documented default while nothing in the repo pins `TZ`, so the wrong branch is
 * the one that runs in production. The rollup edge came back a day behind (an extra completed day
 * shaded as unsummarised) and every rollup row landed in the previous day's bucket.
 *
 * A rendered expression is asserted rather than a query result because these reads need a database
 * and this suite has none — the same reason `api/v1/review-requests/__tests__/service-scope.test.ts`
 * gives. The cast is either in the generated SQL or it is not, and its absence is the whole bug.
 */

const dialect = new PgDialect();

describe('metric_date is read as text, not through the column mapper', () => {
  it('casts the per-day rollup date in SQL', () => {
    const { sql } = dialect.sqlToQuery(metricDateAsText);

    expect(sql).toBe('"analytics_daily_business"."metric_date"::text');
  });

  it('casts the rollup edge in SQL', () => {
    const { sql } = dialect.sqlToQuery(rollupEdgeAsText);

    expect(sql).toBe('max("analytics_daily_business"."metric_date")::text');
  });

  it('loses a day through the column mapper for any process east of UTC', () => {
    // What node-postgres hands drizzle for the stored day 2026-08-31 when the Node process runs in
    // Asia/Kolkata: local midnight on the 31st, which is 18:30Z on the 30th.
    const asKolkataProcess = new Date('2026-08-30T18:30:00.000Z');

    expect(analyticsDailyBusiness.metricDate.mapFromDriverValue(asKolkataProcess)).toBe(
      '2026-08-30',
    );

    // The same stored day on a UTC process maps correctly, which is exactly why this is invisible
    // on a developer machine and wrong in production. Asserting both halves keeps the reason for
    // the cast on the record if anyone is ever tempted to "simplify" it back to the column.
    const asUtcProcess = new Date('2026-08-31T00:00:00.000Z');

    expect(analyticsDailyBusiness.metricDate.mapFromDriverValue(asUtcProcess)).toBe('2026-08-31');
  });

  it('is a cast, not an alias of the column, in both reads', () => {
    // The failure mode being guarded against is someone "simplifying" either expression back to
    // the bare column, which typechecks, runs, and is wrong by a day only in production.
    for (const expression of [metricDateAsText, rollupEdgeAsText]) {
      expect(dialect.sqlToQuery(expression).sql).toContain('::text');
      expect(dialect.sqlToQuery(expression).params).toEqual([]);
    }
  });
});
