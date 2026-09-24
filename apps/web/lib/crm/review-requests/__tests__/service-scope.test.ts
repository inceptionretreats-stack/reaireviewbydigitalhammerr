import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { ResolvedTenant } from '@ai-review/core';
import { messageableCustomerScope, recentRequestsScope } from '../service';

/**
 * The two WHERE clauses REQ-01's reads are built from, rendered to SQL.
 *
 * These assertions exist because of a real defect: `loadRecentRequests` scoped on
 * `review_requests.business_id` alone and left the soft-delete filter out, so a contact CRM-01 had
 * deleted kept appearing in Prepared requests with their name and a live wa.me deep link — Copy, Open
 * WhatsApp and Mark sent all still worked on them (AC-040, and
 * `13_Security_Privacy_Compliance.md` wants that number purged, not re-shown).
 *
 * A clause is checked rather than a query result because every function in `../service` needs a
 * database and this suite has none (see `vitest.config.mts`). Rendering the predicate is enough: both
 * halves are either in the generated SQL or they are not, and the failure being guarded against is
 * precisely a missing half.
 */

const dialect = new PgDialect();

/** The branded type is what `requireTenant` hands a handler; a test has to mint one by assertion. */
const TENANT = '11111111-1111-4111-8111-111111111111' as ResolvedTenant;

function render(clause: ReturnType<typeof recentRequestsScope>): {
  sql: string;
  params: unknown[];
} {
  // `and()` returns `SQL | undefined`, and undefined is the shape of "no filter at all" — the worst
  // possible outcome here, so it fails loudly rather than being rendered as an empty string.
  expect(clause).toBeDefined();
  if (clause === undefined) throw new Error('unreachable: assertion above failed');

  const query = dialect.sqlToQuery(clause);
  return { sql: query.sql, params: [...query.params] };
}

describe('messageableCustomerScope', () => {
  it('scopes to the tenant and excludes soft-deleted contacts', () => {
    const { sql, params } = render(messageableCustomerScope(TENANT));

    expect(sql).toContain('"customers"."business_id" = $1');
    expect(sql).toContain('"customers"."deleted_at" is null');
    expect(params).toEqual([TENANT]);
  });

  it('requires both halves, never one', () => {
    // AC-003 is the tenant half and AC-040 the deletion half. Either one alone is a defect: without
    // the first this reads another tenant's contacts, without the second it re-surfaces a deleted
    // contact's mobile number.
    const { sql } = render(messageableCustomerScope(TENANT));
    expect(sql).toMatch(/business_id.*and.*deleted_at/is);
  });
});

describe('recentRequestsScope', () => {
  it('scopes the request rows to the tenant', () => {
    const { sql, params } = render(recentRequestsScope(TENANT));

    // The tenant clause names `review_requests`, not `customers`: the request row is what is listed,
    // and a request always carries its own business id.
    expect(sql).toContain('"review_requests"."business_id" = $1');
    expect(params).toEqual([TENANT]);
  });

  it('excludes requests whose contact has been soft-deleted', () => {
    // The regression. Every action REQ-01 offers on one of these rows — Copy, Open WhatsApp, Mark
    // sent — is a way of messaging that person again, so the row must not be listed at all.
    const { sql } = render(recentRequestsScope(TENANT));

    expect(sql).toContain('"customers"."deleted_at" is null');
  });

  it('does not scope the tenant on the joined customers table by mistake', () => {
    // A tempting simplification — reuse `messageableCustomerScope` for the joined table — would scope
    // on `customers.business_id`. It happens to be equivalent today only because the foreign keys
    // agree; the request row's own tenant column is the one that must decide.
    const { sql } = render(recentRequestsScope(TENANT));

    expect(sql).not.toContain('"customers"."business_id"');
  });
});
