import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { EventPayload } from '@ai-review/analytics';
import {
  analyticsEvents,
  businessSlugs,
  businesses,
  customers,
  reviewRequests,
  reviewRequestTemplates,
  type Business,
  type Customer,
  type Database,
} from '@ai-review/db';
import { buildWhatsAppLink, normalizePhone, type ResolvedTenant } from '@ai-review/core';
import { statusesBelow, type LadderStatus } from './customer-journey';
import { DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_TEXT, buildCanonicalReviewUrl } from './template';

/**
 * Everything REQ-01 needs from the database, in one module.
 *
 * The three route handlers and the screen itself all import from here rather than each running
 * their own queries. That is not tidiness: the default template, the canonical review link and the
 * customer-status ladder each have to be identical in the preview, in the created request and in
 * what the screen shows, or the owner approves one message and a different one gets stored.
 *
 * Every function that touches tenant data takes the business id as an argument and puts it in the
 * WHERE clause — never as a check on a returned row (RBAC rule 2, AC-003). The single exception is
 * `findRequestByTrackingToken`, which is the public resolver's lookup and is argued for at its own
 * definition.
 *
 * That id is typed `ResolvedTenant`, the branded type `requireTenant` and `TenantGuard` hand back,
 * for the reason `packages/core/src/tenant/guard.ts` gives: "Everything else in the codebase should
 * take a ResolvedTenant rather than a raw string, so that forgetting the check is a type error rather
 * than a silent IDOR." A business id read straight from a request body therefore cannot reach these
 * queries at all. `apps/web/app/api/v1/customers/repository.ts` is written to the same rule.
 */

/**
 * A uuid arriving in a URL or body is shape-checked before it reaches Postgres: an id that is not a
 * uuid raises 22P02, which would surface as a 500 for what is plainly a request for something that
 * does not exist.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * A tenant has a contact list, not a mailing list (D-018, CRM-01-01 "no bulk marketing
 * automation"), and REQ-01 prepares one message for one customer. The cap is here so an unbounded
 * SELECT cannot turn the selector into a multi-megabyte payload; a tenant that reaches it needs a
 * searchable customer picker rather than a larger number on this line. See concerns.
 */
const MAX_CUSTOMER_OPTIONS = 500;

/** How much history REQ-01 shows. Each row carries its stored message, so this is ~30KB at worst. */
const MAX_RECENT_REQUESTS = 20;

export interface TenantMessagingContext {
  name: string;
  timezone: string;
  /** Typed from the schema, so the screen's status wording and Flow J's gate cannot drift apart. */
  status: Business['status'];
  /** null only for a tenant that has not claimed an address yet, which ONB-01 does during setup. */
  slug: string | null;
}

export async function loadTenantMessagingContext(
  database: Database,
  businessId: ResolvedTenant,
): Promise<TenantMessagingContext | null> {
  const [row] = await database
    .select({
      name: businesses.name,
      timezone: businesses.timezone,
      status: businesses.status,
      slug: businessSlugs.slug,
    })
    .from(businesses)
    // Left-joined on the primary row only: a tenant that has renamed keeps retired aliases in the
    // same table (AMENDMENT-005), and a message must carry the address that is current now.
    .leftJoin(
      businessSlugs,
      and(eq(businessSlugs.businessId, businesses.id), eq(businessSlugs.isPrimary, true)),
    )
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!row) return null;
  return { name: row.name, timezone: row.timezone, status: row.status, slug: row.slug };
}

export interface RequestTemplate {
  id: string;
  name: string;
  templateText: string;
}

export async function readDefaultTemplate(
  database: Database,
  businessId: ResolvedTenant,
): Promise<RequestTemplate | null> {
  const [row] = await database
    .select({
      id: reviewRequestTemplates.id,
      name: reviewRequestTemplates.name,
      templateText: reviewRequestTemplates.templateText,
    })
    .from(reviewRequestTemplates)
    .where(
      and(
        eq(reviewRequestTemplates.businessId, businessId),
        eq(reviewRequestTemplates.isDefault, true),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Seeds the tenant's default template on first use.
 *
 * REQ-01 shows a message template but nothing in the product creates one: neither signup nor
 * onboarding writes to `review_request_templates`, so without this the screen opens on an empty
 * textarea and the owner is asked to invent the message the product is meant to suggest.
 *
 * Insert-then-reselect, with the conflict target naming the partial unique index
 * (`uq_default_request_template` — one default per business), so two tabs opening the screen at the
 * same moment can neither create two defaults nor fail one of the requests. Same shape as
 * `lib/anonymous-session.ts`, for the same race.
 */
export async function ensureDefaultTemplate(
  database: Database,
  businessId: ResolvedTenant,
): Promise<RequestTemplate | null> {
  const existing = await readDefaultTemplate(database, businessId);
  if (existing) return existing;

  await database
    .insert(reviewRequestTemplates)
    .values({
      businessId,
      name: DEFAULT_TEMPLATE_NAME,
      templateText: DEFAULT_TEMPLATE_TEXT,
      isDefault: true,
    })
    .onConflictDoNothing({
      target: reviewRequestTemplates.businessId,
      // The index predicate, not a row filter: `uq_default_request_template` is a partial unique
      // index, and Postgres only infers a partial index as the conflict target when the statement
      // repeats its WHERE clause.
      where: sql`is_default`,
    });

  return readDefaultTemplate(database, businessId);
}

/**
 * The soft-delete half of every customer-facing predicate in this module, named once.
 *
 * CRM-01-02 makes deletion soft and AC-040 requires a deleted contact to be gone from every normal
 * list, so three queries here need the same clause. It is one named constant rather than three copies
 * because `loadRecentRequests` shipped without it: a contact the owner had deleted kept appearing in
 * Prepared requests with their name and a live wa.me deep link, so the row stayed fully messageable —
 * the exact invariant `loadCustomer` was written to enforce, and it re-surfaced a mobile number
 * `13_Security_Privacy_Compliance.md` wants purged after a grace period.
 *
 * Reusing one `SQL` descriptor across queries is safe: it describes a comparison, not a bound
 * statement.
 */
const CUSTOMER_NOT_DELETED: SQL = isNull(customers.deletedAt);

/**
 * `customers` rows this tenant may still message: theirs, and not soft-deleted (AC-003, AC-040).
 *
 * Exported so the scope itself can be asserted on — see `__tests__/service-scope.test.ts`. Every
 * other function here is a query and needs a database, but these two clauses are where the module's
 * two security invariants actually live, and they are pinned.
 */
export function messageableCustomerScope(businessId: ResolvedTenant): SQL | undefined {
  return and(eq(customers.businessId, businessId), CUSTOMER_NOT_DELETED);
}

/**
 * The scope for REQ-01's history: this tenant's requests, joined only to contacts that still exist.
 *
 * The tenant clause names `review_requests` because the request row is what is being listed; the
 * soft-delete clause names `customers` because that is where deletion is recorded. Both halves are
 * required, which is what the test pins.
 */
export function recentRequestsScope(businessId: ResolvedTenant): SQL | undefined {
  return and(eq(reviewRequests.businessId, businessId), CUSTOMER_NOT_DELETED);
}

export interface CustomerContact {
  id: string;
  name: string;
  mobile: string;
  status: Customer['status'];
  visitDate: string | null;
}

/**
 * One customer, if this tenant owns it.
 *
 * The id comes from the request body, which is exactly the IDOR shape AC-003 tests for, so
 * ownership is part of the WHERE clause and a missing row and another tenant's row are the same
 * `null` — the caller cannot tell them apart, so the endpoint cannot enumerate.
 *
 * `deleted_at IS NULL` belongs to the same predicate: CRM-01-02 makes deletion soft, and a
 * soft-deleted contact must not be messageable.
 */
export async function loadCustomer(
  database: Database,
  businessId: ResolvedTenant,
  customerId: string,
): Promise<CustomerContact | null> {
  const [row] = await database
    .select({
      id: customers.id,
      name: customers.name,
      mobile: customers.mobile,
      status: customers.status,
      visitDate: customers.visitDate,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), messageableCustomerScope(businessId)))
    .limit(1);

  return row ?? null;
}

export async function loadCustomerOptions(
  database: Database,
  businessId: ResolvedTenant,
): Promise<CustomerContact[]> {
  return (
    database
      .select({
        id: customers.id,
        name: customers.name,
        mobile: customers.mobile,
        status: customers.status,
        visitDate: customers.visitDate,
      })
      .from(customers)
      .where(messageableCustomerScope(businessId))
      // Most recently added first: the customer an owner wants to message is almost always the one
      // they just served. id breaks ties, so a batch created in one transaction holds a stable order
      // in a list where the selection decides who gets messaged.
      .orderBy(desc(customers.createdAt), desc(customers.id))
      .limit(MAX_CUSTOMER_OPTIONS)
  );
}

export interface StoredRequest {
  id: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  renderedMessage: string;
  preparedAt: Date;
  markedSentAt: Date | null;
  firstClickedAt: Date | null;
  lastClickedAt: Date | null;
}

/**
 * The tenant's recent prepared requests.
 *
 * `rendered_message` is returned, and it is the only place a usable tracked link survives: the
 * token itself is never stored (only its SHA-256), so the one remaining copy of the link is the one
 * embedded in the message rendered when it was minted. That is what lets an owner copy an older
 * request again and still have the click attributed to it.
 *
 * A request for a contact CRM-01 has soft-deleted is not listed. The row survives, but every action
 * this screen offers on it — Copy, Open WhatsApp, Mark sent — is a way of messaging that person
 * again, and `13_Security_Privacy_Compliance.md` asks for their number to be purged, not re-shown.
 * Hiding the row is therefore the honest reading of AC-040 here, not a loss of history the owner can
 * act on.
 */
export async function loadRecentRequests(
  database: Database,
  businessId: ResolvedTenant,
): Promise<StoredRequest[]> {
  return (
    database
      .select({
        id: reviewRequests.id,
        customerId: reviewRequests.customerId,
        customerName: customers.name,
        customerMobile: customers.mobile,
        renderedMessage: reviewRequests.renderedMessage,
        preparedAt: reviewRequests.preparedAt,
        markedSentAt: reviewRequests.markedSentAt,
        firstClickedAt: reviewRequests.firstClickedAt,
        lastClickedAt: reviewRequests.lastClickedAt,
      })
      .from(reviewRequests)
      // Inner join: a request whose customer row is gone has nobody to show it against. The foreign
      // key cascades on delete, so the join itself only excludes rows that no longer exist — the
      // soft-delete half of the scope below is what excludes the ones CRM-01-02 hid.
      .innerJoin(customers, eq(customers.id, reviewRequests.customerId))
      .where(recentRequestsScope(businessId))
      .orderBy(desc(reviewRequests.preparedAt), desc(reviewRequests.id))
      .limit(MAX_RECENT_REQUESTS)
  );
}

export interface OwnedRequest {
  id: string;
  customerId: string;
  markedSentAt: Date | null;
}

/** Ownership in the WHERE clause again — see `loadCustomer`. */
export async function loadOwnedRequest(
  database: Database,
  businessId: ResolvedTenant,
  requestId: string,
): Promise<OwnedRequest | null> {
  const [row] = await database
    .select({
      id: reviewRequests.id,
      customerId: reviewRequests.customerId,
      markedSentAt: reviewRequests.markedSentAt,
    })
    .from(reviewRequests)
    .where(and(eq(reviewRequests.id, requestId), eq(reviewRequests.businessId, businessId)))
    .limit(1);

  return row ?? null;
}

/**
 * Records the owner's manual "Mark Message Sent" (Flow F step 8, AC-023).
 *
 * `marked_sent_at IS NULL` in the WHERE clause makes the write idempotent and keeps the *first*
 * time the owner said they had sent it. Re-clicking must not move the timestamp: it records
 * something that happened outside this system, and rewriting it would quietly change history.
 * Returns null when no row was updated, which the caller reads as "already marked".
 *
 * The business id is not in this WHERE clause because the caller has already resolved the row
 * through `loadOwnedRequest`; the id here is one this tenant provably owns, not one from a URL.
 */
export async function markSent(database: Database, requestId: string): Promise<Date | null> {
  const [row] = await database
    .update(reviewRequests)
    .set({ markedSentAt: sql`now()` })
    .where(and(eq(reviewRequests.id, requestId), isNull(reviewRequests.markedSentAt)))
    .returning({ markedSentAt: reviewRequests.markedSentAt });

  return row?.markedSentAt ?? null;
}

export interface ResolvedTrackedRequest {
  requestId: string;
  businessId: string;
  customerId: string;
  businessStatus: Business['status'];
  businessDeleted: boolean;
  slug: string | null;
}

/**
 * The public resolver's lookup — the one query here that is not tenant-scoped, deliberately.
 *
 * There is no session on `GET /r/req/{token}`: the visitor is a customer of the business, not a
 * user of the product (D-008). The token is the only credential, and it is a 256-bit secret whose
 * SHA-256 is what the column stores (`tracking_token_hash`), so this is a lookup by an unguessable
 * value rather than by an enumerable id — RBAC rule 3's "a locator is never an authorization token"
 * is not weakened, because what a hit authorizes is a redirect to a page that is public anyway. On a
 * miss it discloses nothing at all: unknown and expired are answered identically (see the route).
 */
export async function findRequestByTrackingToken(
  database: Database,
  tokenHash: string,
): Promise<ResolvedTrackedRequest | null> {
  const [row] = await database
    .select({
      requestId: reviewRequests.id,
      businessId: reviewRequests.businessId,
      customerId: reviewRequests.customerId,
      businessStatus: businesses.status,
      businessDeletedAt: businesses.deletedAt,
      slug: businessSlugs.slug,
    })
    .from(reviewRequests)
    .innerJoin(businesses, eq(businesses.id, reviewRequests.businessId))
    .leftJoin(
      businessSlugs,
      and(
        eq(businessSlugs.businessId, reviewRequests.businessId),
        eq(businessSlugs.isPrimary, true),
      ),
    )
    .where(eq(reviewRequests.trackingTokenHash, tokenHash))
    .limit(1);

  if (!row) return null;

  return {
    requestId: row.requestId,
    businessId: row.businessId,
    customerId: row.customerId,
    businessStatus: row.businessStatus,
    businessDeleted: row.businessDeletedAt !== null,
    slug: row.slug,
  };
}

/**
 * Stamps a click (Flow F step 9).
 *
 * One statement, so there is no read-modify-write: `first_clicked_at` is set by COALESCE, which
 * means the earliest click wins even when two arrive together — a messaging client fetching the URL
 * to build a preview and the customer then tapping it is the ordinary case, not an edge one.
 */
export async function recordLinkClick(database: Database, requestId: string): Promise<void> {
  await database
    .update(reviewRequests)
    .set({
      firstClickedAt: sql`coalesce(${reviewRequests.firstClickedAt}, now())`,
      lastClickedAt: sql`now()`,
    })
    .where(eq(reviewRequests.id, requestId));
}

/**
 * Climbs `customers.status` to `target`, never down (see `./customer-journey`).
 *
 * Tenant-scoped and atomic: one UPDATE whose WHERE names the business, the customer and the rungs
 * below the target, so a concurrent advance cannot be lost and another tenant's row cannot be
 * touched even if a stale customer id reached it.
 *
 * The one function here that also accepts a plain string, and the reason is the public resolver: on
 * `GET /r/req/{token}` there is no session to resolve a tenant from, so the business id comes from
 * `findRequestByTrackingToken` — derived on the server from the token's own hash, which is a stronger
 * provenance than a session lookup rather than a weaker one. Nothing a client sent reaches this
 * parameter on either path. The owner-facing callers all pass `ResolvedTenant`, so a raw body value
 * still cannot get here from a dashboard route (AC-003).
 */
export async function advanceCustomerStatus(
  database: Database,
  businessId: ResolvedTenant | string,
  customerId: string,
  target: LadderStatus,
): Promise<void> {
  const overwritable = statusesBelow(target);
  if (overwritable.length === 0) return;

  await database
    .update(customers)
    .set({ status: target, updatedAt: new Date() })
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.businessId, businessId),
        inArray(customers.status, overwritable),
      ),
    );
}

/**
 * REQ-01-01: "Open WhatsApp uses wa.me style deep link where valid."
 *
 * `customers.mobile` is a varchar the CRM normalizes on write (CRM-01-03), but this module will not
 * be its only writer forever, and a wa.me link built from an unnormalized number opens WhatsApp on
 * a chat with nobody. Returning null is what makes "where valid" true: the screen then offers Copy
 * alone and says why, rather than handing the owner a link that fails after they have left.
 */
export function whatsAppLinkFor(mobile: string, message: string): string | null {
  const phone = normalizePhone(mobile);
  if (!phone.ok) return null;
  return buildWhatsAppLink(phone.e164, message);
}

/**
 * Analytics writes are best-effort, always.
 *
 * AC-035's rule for the customer flow applies to the owner's flow for the same reason: a degraded
 * analytics pipeline must not stop an owner preparing a message, nor a customer reaching the review
 * page. Logged as a warning rather than swallowed silently, because an event that quietly stops
 * being written is the failure nobody notices — the same argument as `POST /public/events`.
 */
async function safeInsertEvent(
  database: Database,
  values: {
    businessId: string;
    customerId?: string | null;
    anonymousSessionId?: string | null;
    eventName: string;
    properties: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await database.insert(analyticsEvents).values({
      businessId: values.businessId,
      customerId: values.customerId ?? null,
      anonymousSessionId: values.anonymousSessionId ?? null,
      eventName: values.eventName,
      properties: values.properties,
    });
  } catch (error) {
    // AC-030: the caller gets nothing about this. The detail stays in the server log.
    console.warn(`[review-requests] analytics write failed for ${values.eventName}`, error);
  }
}

/**
 * The payload types come from `@ai-review/analytics`, which generates them from
 * `11_Analytics_Event_Taxonomy.csv`. Declaring the literal as `EventPayload<...>` makes a missing
 * required property or an invented one a compile error, which is how AN-01-01 stays structural
 * rather than a convention (see that package's header).
 */
export async function recordPreparedEvent(
  database: Database,
  input: { businessId: string; customerId: string; requestId: string; templateId: string | null },
): Promise<void> {
  const properties: EventPayload<'review_request_prepared'> = {
    business_id: input.businessId,
    customer_id: input.customerId,
    review_request_id: input.requestId,
    ...(input.templateId === null ? {} : { template_id: input.templateId }),
  };

  await safeInsertEvent(database, {
    businessId: input.businessId,
    customerId: input.customerId,
    eventName: 'review_request_prepared',
    properties,
  });
}

export async function recordMarkedSentEvent(
  database: Database,
  input: { businessId: string; customerId: string; requestId: string },
): Promise<void> {
  const properties: EventPayload<'review_request_marked_sent'> = {
    business_id: input.businessId,
    customer_id: input.customerId,
    review_request_id: input.requestId,
  };

  await safeInsertEvent(database, {
    businessId: input.businessId,
    customerId: input.customerId,
    eventName: 'review_request_marked_sent',
    properties,
  });
}

/**
 * The click event, and the one place in this module where a customer reference is withheld.
 *
 * Flow F step 9 is explicit that attribution must not expose the customer's identity in public
 * analytics, and the taxonomy encodes exactly that: `review_request_link_click` requires only
 * business_id and review_request_id, while the two owner-side events also carry customer_id. So
 * neither the property nor the `analytics_events.customer_id` column is set here — the column would
 * otherwise let any analytics query group public clicks by named contact, which is the thing step 9
 * forbids, and no careful wording on a chart would undo it.
 *
 * The request id is enough for attribution. An owner can see which request it was on their own
 * dashboard, where they are entitled to know.
 */
export async function recordLinkClickEvent(
  database: Database,
  input: { businessId: string; requestId: string; anonymousSessionId: string | null },
): Promise<void> {
  const properties: EventPayload<'review_request_link_click'> = {
    business_id: input.businessId,
    review_request_id: input.requestId,
    ...(input.anonymousSessionId === null
      ? {}
      : { anonymous_session_id: input.anonymousSessionId }),
  };

  await safeInsertEvent(database, {
    businessId: input.businessId,
    customerId: null,
    anonymousSessionId: input.anonymousSessionId,
    eventName: 'review_request_link_click',
    properties,
  });
}

/** The canonical (untracked) review link for a tenant, or null while no address is claimed. */
export function canonicalReviewUrlFor(baseUrl: string, slug: string | null): string | null {
  return slug === null ? null : buildCanonicalReviewUrl(baseUrl, slug);
}
