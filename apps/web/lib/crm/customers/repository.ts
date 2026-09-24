import { and, count, desc, eq, ilike, isNull, like, ne, or, type SQL } from 'drizzle-orm';
import { customers, type Database } from '@ai-review/db';
import type { ResolvedTenant } from '@ai-review/core';
import { isCustomerStatus, isObservedStatus, type CustomerStatus } from './customer-status';
import { containsPattern, resolvePage, totalPages, type ListQuery } from './list-params';

/**
 * Every read and write of the `customers` table, in one place.
 *
 * One module rather than per-caller queries, because two callers need exactly the
 * same query — `GET /api/v1/customers` and the CRM-01 page, which renders the first page on the
 * server so the owner does not watch an empty table fill in after hydration. Copying a
 * tenant-scoped, soft-delete-excluding query into both is how one of them eventually loses the
 * `deleted_at IS NULL` clause and starts showing deleted contacts (AC-040), or loses the
 * `business_id` clause and shows another tenant's (AC-003). One function, one WHERE clause.
 *
 * Every function takes a `ResolvedTenant` — the branded type `requireTenant` and `TenantGuard`
 * hand back — so a business id straight from a request body cannot reach this module at all
 * (RBAC rule 2). The id of the *contact* is a plain string and is always paired with that tenant
 * inside the WHERE clause, never checked afterwards against a row already fetched.
 */

/** The columns CRM-01 needs. `deleted_at` is a filter, never something a client is told about. */
const SELECTION = {
  id: customers.id,
  name: customers.name,
  mobile: customers.mobile,
  email: customers.email,
  visitDate: customers.visitDate,
  note: customers.note,
  status: customers.status,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
} as const;

export interface CustomerRow {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  /** A bare calendar date, `YYYY-MM-DD`. Deliberately not an instant — see `toCustomerDto`. */
  visitDate: string | null;
  note: string | null;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** The wire shape. Snake case, mirroring `customerRequest` so what CRM-01 sends it reads back. */
export interface CustomerDto {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  visit_date: string | null;
  note: string | null;
  status: CustomerStatus;
  created_at: string;
  updated_at: string;
}

export interface CustomerListPage {
  customers: readonly CustomerDto[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  /** Echoed, so a client can tell which search a late-arriving response answers. */
  q: string;
}

/** The contact this mobile number already belongs to, when a write has to refuse. */
export interface ExistingContact {
  id: string;
  name: string;
}

export interface CustomerWriteValues {
  name: string;
  mobile: string;
  email: string | null;
  visitDate: string | null;
  note: string | null;
}

export type CreateOutcome =
  | { ok: true; customer: CustomerRow }
  | { ok: false; reason: 'MOBILE_TAKEN'; existing: ExistingContact };

export type UpdateOutcome =
  | { ok: true; customer: CustomerRow }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'MOBILE_TAKEN'; existing: ExistingContact }
  | { ok: false; reason: 'STATUS_LOCKED'; status: CustomerStatus };

/**
 * The tenant scope and the soft-delete filter, as one clause used by every query in this module.
 *
 * AC-040: a deleted contact is gone from every normal list. The row survives — `13_Security_
 * Privacy_Compliance.md` asks for personal fields to be purged "after a grace period", which is a
 * scheduled job's work rather than a delete handler's — but nothing in the dashboard sees it again.
 */
function liveScope(businessId: ResolvedTenant): SQL | undefined {
  return and(eq(customers.businessId, businessId), isNull(customers.deletedAt));
}

/**
 * The search half of CRM-01's `Search` action.
 *
 * Three fields, because those are the three an owner remembers a contact by. The mobile arm compares
 * digits to digits: the column holds E.164 (`+919876543210`) while the owner types `98765 43210` or
 * `0-9876543210`, so a literal match on the raw query would find nothing (CRM-01-03).
 *
 * `like` rather than `ilike` on the mobile arm — the stored value is digits and a `+`, so
 * case-insensitivity would only cost the planner a usable comparison.
 */
function searchClause(query: ListQuery): SQL | undefined {
  if (query.search === '') return undefined;

  const text = containsPattern(query.search);

  return or(
    ilike(customers.name, text),
    ilike(customers.email, text),
    query.mobileDigits === null
      ? undefined
      : like(customers.mobile, containsPattern(query.mobileDigits)),
  );
}

function listWhere(businessId: ResolvedTenant, query: ListQuery): SQL | undefined {
  return and(liveScope(businessId), searchClause(query));
}

/**
 * Another live contact of this tenant already holding this mobile number.
 *
 * Two contacts on one number would mean two review requests to one phone, which is not what a
 * review-request list is for (D-018, CRM-01-01). `exceptId` lets an edit keep its own number.
 *
 * Soft-deleted rows are excluded, which is the behaviour AC-040 asks for: the partial index on
 * `(business_id, mobile) WHERE deleted_at IS NULL` exists so a deleted contact's number can be
 * added again. That index is NOT unique — neither in `06_Database_Schema.sql` nor in migration
 * 0000 — so this is an application-level rule and two simultaneous inserts could still both pass
 * it. Recorded in the concerns; the fix is a unique partial index, not more code here.
 */
function duplicateMobileWhere(
  businessId: ResolvedTenant,
  mobile: string,
  exceptId?: string,
): SQL | undefined {
  return and(
    liveScope(businessId),
    eq(customers.mobile, mobile),
    exceptId === undefined ? undefined : ne(customers.id, exceptId),
  );
}

/**
 * One page of contacts, assembled exactly as `GET /api/v1/customers` returns it.
 *
 * Shared with the CRM-01 page, which renders the first page on the server, so the table in the first
 * paint and every list the client fetches afterwards cannot describe the same data differently.
 *
 * Counted before the rows are read, because the page has to be clamped to what exists: asking for
 * page 3 of a list that is now two pages long is what happens when the owner deletes the last contact
 * on the last page, and answering that with an empty table explains nothing.
 */
export async function loadCustomerPage(
  database: Database,
  businessId: ResolvedTenant,
  query: ListQuery,
): Promise<CustomerListPage> {
  const total = await countCustomers(database, businessId, query);
  const page = resolvePage(query.page, total, query.perPage);
  const rows = await listCustomers(database, businessId, query, page);

  return {
    customers: rows.map(toCustomerDto),
    page,
    per_page: query.perPage,
    total,
    total_pages: totalPages(total, query.perPage),
    q: query.search,
  };
}

async function countCustomers(
  database: Database,
  businessId: ResolvedTenant,
  query: ListQuery,
): Promise<number> {
  const [row] = await database
    .select({ total: count() })
    .from(customers)
    .where(listWhere(businessId, query));

  return row?.total ?? 0;
}

/**
 * One page of contacts, newest first.
 *
 * Newest first because the reason to open CRM-01 is nearly always the customer who has just left the
 * shop. `id` breaks ties: rows inserted in one transaction can share `created_at` to the microsecond,
 * and an unstable sort under `LIMIT`/`OFFSET` is how a contact appears on two pages while another
 * appears on none — and, in a table of Edit and Delete buttons, how the wrong row gets clicked.
 */
async function listCustomers(
  database: Database,
  businessId: ResolvedTenant,
  query: ListQuery,
  page: number,
): Promise<readonly CustomerRow[]> {
  const rows = await database
    .select(SELECTION)
    .from(customers)
    .where(listWhere(businessId, query))
    .orderBy(desc(customers.createdAt), desc(customers.id))
    .limit(query.perPage)
    .offset((page - 1) * query.perPage);

  return rows.map(narrowStatus);
}

/**
 * Adds a contact (CRM-01 `Add customer`).
 *
 * `status` is not an input. A contact that has just been written down has not been contacted, and
 * `customers.status` defaults to NOT_CONTACTED in the schema; accepting a status here would let the
 * very first write claim a stage the platform has not observed.
 *
 * The duplicate check and the insert share one transaction so that the check is against the same
 * snapshot the insert lands in.
 */
export async function createCustomer(
  database: Database,
  businessId: ResolvedTenant,
  values: CustomerWriteValues,
): Promise<CreateOutcome> {
  return database.transaction(async (tx): Promise<CreateOutcome> => {
    const [clash] = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(duplicateMobileWhere(businessId, values.mobile))
      .limit(1);

    if (clash) return { ok: false, reason: 'MOBILE_TAKEN', existing: clash };

    const [row] = await tx
      .insert(customers)
      // The tenant comes from the resolved session, never from the body. `customerRequest` has no
      // `business_id` field for a caller to send, and this is why (RBAC rule 2).
      .values({ businessId, ...values })
      .returning(SELECTION);

    // `INSERT … RETURNING` yields one row or throws, so this is not a state to handle — but the
    // array type says it might be, and a non-null assertion would be a worse way to say so.
    if (!row) throw new Error('customer insert returned no row');

    return { ok: true, customer: narrowStatus(row) };
  });
}

/**
 * Edits a contact, and is the only place a status may be written by hand (CRM-01 `Edit`).
 *
 * A full-record update: `customerRequest`'s optional fields are cleared when the body omits them,
 * because CRM-01 edits the whole contact in one form and "the email box is empty" has to be able to
 * mean "remove the email". The verb is PATCH because `08_OpenAPI_v1.yaml` says PATCH.
 *
 * The status guard is the reason this is a transaction with `FOR UPDATE` rather than a bare UPDATE:
 * once the platform has observed the customer, the status is history and stops being editable
 * (see `customer-status.ts`), and that decision has to be made against a row nobody else can move
 * in between. Requesting the status a contact already holds is allowed — a form that resubmits the
 * value it was given is not an attempt to rewrite anything.
 */
export async function updateCustomer(
  database: Database,
  businessId: ResolvedTenant,
  id: string,
  values: CustomerWriteValues & { status?: CustomerStatus },
): Promise<UpdateOutcome> {
  return database.transaction(async (tx): Promise<UpdateOutcome> => {
    const [current] = await tx
      .select({ status: customers.status })
      .from(customers)
      .where(and(eq(customers.id, id), liveScope(businessId)))
      .limit(1)
      .for('update');

    // A missing contact, a deleted one and another tenant's are one answer, so the endpoint cannot
    // be used to find out which ids exist (AC-003).
    if (!current) return { ok: false, reason: 'NOT_FOUND' };
    if (!isCustomerStatus(current.status)) {
      throw new Error(`unknown customer_request_status: ${current.status}`);
    }

    if (
      values.status !== undefined &&
      values.status !== current.status &&
      isObservedStatus(current.status)
    ) {
      return { ok: false, reason: 'STATUS_LOCKED', status: current.status };
    }

    const [clash] = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(duplicateMobileWhere(businessId, values.mobile, id))
      .limit(1);

    if (clash) return { ok: false, reason: 'MOBILE_TAKEN', existing: clash };

    const [row] = await tx
      .update(customers)
      .set({
        name: values.name,
        mobile: values.mobile,
        email: values.email,
        visitDate: values.visitDate,
        note: values.note,
        // Omitted rather than written as the current value, so an edit that does not mention the
        // status cannot be the thing that changes it.
        ...(values.status === undefined ? {} : { status: values.status }),
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, id), liveScope(businessId)))
      .returning(SELECTION);

    // Unreachable: the row was selected FOR UPDATE inside this transaction. Reported rather than
    // asserted away, because "unreachable" is a claim about today's code.
    if (!row) return { ok: false, reason: 'NOT_FOUND' };

    return { ok: true, customer: narrowStatus(row) };
  });
}

/**
 * The soft delete behind CRM-01's Delete action (AC-040, CRM-01-02).
 *
 * `deleted_at IS NULL` is in the WHERE clause, so deleting a contact twice reports not-found — the
 * same answer as a contact that never existed and as another tenant's.
 *
 * Personal fields are deliberately left in place. The retention policy asks for them to be purged
 * "after a grace period", so scrubbing them here would remove the grace period the policy is built
 * around, and would erase the name from any review request already prepared for this contact.
 */
export async function softDeleteCustomer(
  database: Database,
  businessId: ResolvedTenant,
  id: string,
): Promise<boolean> {
  const now = new Date();
  const rows = await database
    .update(customers)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(customers.id, id), liveScope(businessId)))
    .returning({ id: customers.id });

  return rows.length > 0;
}

/**
 * A stored row as it goes over the wire.
 *
 * `created_at` and `updated_at` are UTC instants; rendering them in `businesses.timezone`
 * (AMENDMENT-004) is the client's job. `visit_date` passes through untouched, because it is a bare
 * calendar date rather than an instant: turning "they came in on the 7th" into a timestamp makes it
 * the 6th for anyone reading it from a timezone behind the shop's.
 */
export function toCustomerDto(row: CustomerRow): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    email: row.email,
    visit_date: row.visitDate,
    note: row.note,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Confirms the enum value the driver handed back is one this build knows about.
 *
 * Not paranoia: a migration can add a value to `customer_request_status` before the deploy that
 * understands it, at which point the column's TypeScript type is a lie. Failing loudly beats
 * rendering a blank badge — `customer-status.ts` would have no entry for the new value, so it would
 * read as neither owner-settable nor observed, and the safest of those two defaults is not obvious.
 */
function narrowStatus(row: Omit<CustomerRow, 'status'> & { status: string }): CustomerRow {
  if (!isCustomerStatus(row.status)) {
    throw new Error(`unknown customer_request_status: ${row.status}`);
  }
  return { ...row, status: row.status };
}
