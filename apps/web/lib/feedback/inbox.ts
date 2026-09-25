import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { businesses, privateFeedback, type Database } from '@ai-review/db';
import {
  encodeFeedbackCursor,
  resolveTimeZone,
  statusesFor,
  zonedDayRange,
  type FeedbackFilters,
  type FeedbackPageRequest,
} from './filters';
import { COUNT_KEY, emptyFeedbackCounts, type FeedbackCounts, type FeedbackWireItem } from './row';

/**
 * Reads one page of a tenant's private feedback (FB-02).
 *
 * Shared by `GET /api/v1/feedback` and by the server-rendered first page of
 * `/app/feedback`, so the screen and the endpoint cannot disagree about what a filter means.
 *
 * ## FB-02-01 / AC-003
 *
 * `businessId` is a parameter, and the only callers are a route handler and a server component
 * that each got it from `requireTenant` / `TenantGuard` — never from a URL or a body (RBAC rule
 * 2). Every statement below is filtered on it. Private feedback is a customer's correspondence
 * with one business, so a cross-tenant read here is not a data-shape bug, it is disclosing a
 * stranger's message.
 *
 * ## What is not here
 *
 * No analytics event is written on a read or a status change. `11_Analytics_Event_Taxonomy.csv`
 * defines `private_feedback_open` and `private_feedback_submit` for the customer side and nothing
 * at all for the merchant reading their inbox, and that CSV is the contract — CI regenerates the
 * event types from it and fails on a diff (AN-01-01). An event for this screen has to be added
 * there first, not invented in a component.
 */

export interface FeedbackPage {
  items: readonly FeedbackWireItem[];
  /** Null when this is the last page. */
  nextCursor: string | null;
  /**
   * Counts respect the date filter but not the status filter — they are what the status chips
   * report, so they have to describe the same slice of time the list does.
   */
  counts: FeedbackCounts;
  /** The zone every date on the screen is read and rendered in (AC-026, AMENDMENT-004). */
  timeZone: string;
}

/**
 * `created_at` at full precision, as text.
 *
 * The Date that node-postgres hands back is millisecond-resolution, and a keyset cursor built
 * from it would skip any row whose timestamp fell in the truncated microseconds. `to_char` against
 * UTC is used rather than a plain `::text` cast because the cast renders in the session's
 * TimeZone, which is not ours to depend on.
 */
const CURSOR_AT = sql<string>`to_char(${privateFeedback.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export async function loadFeedbackPage(
  db: Database,
  businessId: string,
  filters: FeedbackFilters,
  page: FeedbackPageRequest,
): Promise<FeedbackPage> {
  // Sequential rather than parallel, because the timezone is what turns a `from`/`to` date into
  // the instants the other two statements filter on (AC-026). One extra round trip is the price
  // of the date filter meaning what the merchant's own clock says.
  const timeZone = await loadTimeZone(db, businessId);
  const range = zonedDayRange(filters, timeZone);

  const scope: SQL[] = [eq(privateFeedback.businessId, businessId)];
  if (range.startInclusive !== null) {
    scope.push(gte(privateFeedback.createdAt, range.startInclusive));
  }
  if (range.endExclusive !== null) scope.push(lt(privateFeedback.createdAt, range.endExclusive));

  const [rows, counts] = await Promise.all([
    selectRows(db, scope, filters, page),
    selectCounts(db, scope),
  ]);

  // One row over the page size is requested so that "is there more" is answered by the same
  // statement, rather than by a second COUNT that would race the first.
  const hasMore = rows.length > page.limit;
  const visible = hasMore ? rows.slice(0, page.limit) : rows;
  const last = visible.at(-1);

  return {
    items: visible.map((row) => ({
      id: row.id,
      message: row.message,
      // Emitted because this is the owner's own inbox and FB-02 lists "Name/mobile if supplied"
      // as screen content. AC-039 bounds where they may go next: never a public page, never an
      // analytics property, never an aggregate export.
      name: row.name,
      mobile: row.mobile,
      status: row.status,
      created_at: row.createdAt.toISOString(),
      cursor: encodeFeedbackCursor({ at: row.cursorAt, id: row.id }),
    })),
    nextCursor:
      hasMore && last !== undefined
        ? encodeFeedbackCursor({ at: last.cursorAt, id: last.id })
        : null,
    counts,
    timeZone,
  };
}

async function loadTimeZone(db: Database, businessId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  return resolveTimeZone(row?.timezone);
}

function selectRows(
  db: Database,
  scope: readonly SQL[],
  filters: FeedbackFilters,
  page: FeedbackPageRequest,
) {
  const conditions = [...scope];

  // Omitted only for `all`, which is the one filter that selects every state: the predicate would
  // match every row anyway, and leaving it out keeps `idx_feedback_business_status` doing the
  // ordering rather than filtering. Tested on the filter name rather than on how many statuses came
  // back, so a fourth `feedback_status` member cannot turn this into a silently dropped predicate.
  if (filters.status !== 'all') {
    conditions.push(inArray(privateFeedback.status, [...statusesFor(filters.status)]));
  }

  if (page.cursor !== null) {
    // Row-wise comparison, which is exactly the keyset predicate for `ORDER BY created_at DESC,
    // id DESC`. Both halves were matched against a strict pattern in `parseFeedbackCursor` before
    // reaching here, and both are bound parameters.
    conditions.push(
      sql`(${privateFeedback.createdAt}, ${privateFeedback.id}) < (${page.cursor.at}::timestamptz, ${page.cursor.id}::uuid)`,
    );
  }

  return (
    db
      .select({
        id: privateFeedback.id,
        message: privateFeedback.message,
        name: privateFeedback.name,
        mobile: privateFeedback.mobile,
        status: privateFeedback.status,
        createdAt: privateFeedback.createdAt,
        cursorAt: CURSOR_AT,
      })
      .from(privateFeedback)
      .where(and(...conditions))
      // Newest first: an inbox. `id` breaks ties so the order is total and the keyset above can
      // never loop on two rows sharing a timestamp.
      .orderBy(desc(privateFeedback.createdAt), desc(privateFeedback.id))
      .limit(page.limit + 1)
  );
}

async function selectCounts(db: Database, scope: readonly SQL[]): Promise<FeedbackCounts> {
  const rows = await db
    .select({ status: privateFeedback.status, rows: count() })
    .from(privateFeedback)
    .where(and(...scope))
    // Grouped in Postgres rather than counted in TypeScript: the point of the chips is to say how
    // much is unread without shipping every row to find out.
    .groupBy(privateFeedback.status);

  const counts = emptyFeedbackCounts();
  for (const row of rows) {
    counts[COUNT_KEY[row.status]] += row.rows;
    counts.total += row.rows;
  }
  return counts;
}
