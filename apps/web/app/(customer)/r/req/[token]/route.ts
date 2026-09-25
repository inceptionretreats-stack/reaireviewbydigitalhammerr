import { NextResponse, type NextRequest } from 'next/server';
import { hashToken } from '@ai-review/core';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { resolveAnonymousSession } from '@/lib/customer/anonymous-session';
import { looksLikeLinkPreviewFetch } from '@/lib/crm/review-requests/link-preview';
import { isTrackingTokenFormat } from '@/lib/crm/review-requests/template';
import {
  advanceCustomerStatus,
  findRequestByTrackingToken,
  recordLinkClick,
  recordLinkClickEvent,
} from '@/lib/crm/review-requests/repository';

/**
 * GET /r/req/{token} — the tracked-link resolver. This route is what OPEN-02 records as missing:
 * `review_requests.tracking_token_hash` and the `review_request_link_click` event both existed, but
 * nothing consumed the token, so Flow F step 9 could not work at all.
 *
 * What arrives here is a link a business sent to a customer over WhatsApp. Every decision below
 * follows from that: the visitor is not a user of this product, is standing somewhere with one hand
 * on a phone, and must end up on something useful in one hop.
 *
 * Only the SHA-256 of the token is stored, so this looks up by hash (`hashToken`) — the same
 * treatment sessions, invites and password resets get, and it means a database disclosure hands over
 * no usable links.
 *
 * There is no collision with `/r/{code}`, the QR landing. Generated QR codes are ten characters from
 * an uppercase alphabet and `isValidQrCodeFormat` requires at least six, so the literal lowercase
 * segment `req` can never be a QR code, and a static segment wins over a dynamic sibling in any case.
 */

/** node:crypto, via `hashToken`. Stated so a future edge default cannot break this at runtime. */
export const runtime = 'nodejs';

/**
 * Never cached, at any layer.
 *
 * Two reasons, both load-bearing. Every open must be recorded, and a cached redirect records the
 * second one nowhere. And the destination is resolved live from tenant configuration, which is the
 * same property AC-017 depends on for QR codes — a business that changes its address, or is
 * suspended tomorrow, must not have yesterday's redirect served from a CDN.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const baseUrl = env().APP_BASE_URL;

  // Shape-checked before anything else, so a scanner probing this path costs no database round trip.
  if (!isTrackingTokenFormat(token)) return redirectTo(baseUrl, '/');

  const database = db();

  let resolved: Awaited<ReturnType<typeof findRequestByTrackingToken>>;
  try {
    resolved = await findRequestByTrackingToken(database, hashToken(token));
  } catch (error) {
    // AC-030: nothing about this reaches the visitor. AC-035: they still land somewhere sensible.
    console.error('[review-request-link] resolution failed', error);
    return redirectTo(baseUrl, '/');
  }

  /*
   * An unknown or expired token lands on the site root, not on a 404.
   *
   * Somebody was handed this link by a business they know, and a 404 tells them that business is
   * broken. The root page already says the right thing for exactly this situation — "Scan a business
   * QR code or open a business link to leave a review" — so it is a real destination rather than a
   * dead end, and it needs no page of its own to maintain. It is the same judgement `/r/{code}` makes
   * for a disabled standee (QR-01-02) and `/{slug}` makes for a suspended tenant (Flow J).
   *
   * Unknown and expired are answered identically and with no message, so a hit and a miss are
   * indistinguishable from outside. That is deliberate even though these tokens are unguessable: an
   * endpoint that says "that link existed but has gone" is an oracle, and it would be one for the
   * only thing it could leak — that this business messaged somebody.
   *
   * There is nothing to expire against today: `review_requests` has no expiry column, so a token
   * stays valid until the row is deleted (the customer or the business being removed cascades it
   * away). Whether links should expire is an open product question (docs/known-issues.md).
   */
  if (!resolved) return redirectTo(baseUrl, '/');

  const reachable =
    !resolved.businessDeleted && resolved.businessStatus === 'ACTIVE' && resolved.slug !== null;

  /*
   * Flow F step 9 says the click is attributed; nothing says it is only attributed when the business
   * happens to be live. So a SUSPENDED, DRAFT or slug-less tenant is still recorded, before the
   * redirect — an owner needs to know their customers are still tapping links while their account is
   * suspended.
   *
   * A *deleted* tenant is the exception, and it is not the same case: there is no owner left to read
   * the number, and the writes are not passive — they stamp `first/last_clicked_at`, insert an
   * analytics event, climb `customers.status`, and mint an `anonymous_sessions` row for a business
   * that no longer exists. Every other public entry point already refuses: `lib/customer/public-business.ts`
   * returns null once `businesses.deleted_at` is set, so `/r/{code}` and `/{slug}` record nothing for
   * a deleted tenant. This one now matches them.
   */
  if (!resolved.businessDeleted) await record(database, request, resolved);

  if (!reachable) {
    // A suspended, draft or closed tenant: `/{slug}` renders the controlled unavailable page rather
    // than a 404 (Flow J), which is the closest thing to useful that exists. With no address at all
    // there is nothing tenant-specific to show, so the root page takes it.
    return redirectTo(baseUrl, resolved.slug === null ? '/' : `/${resolved.slug}`);
  }

  // Flow F step 9's destination: the business's review flow, the same experience a QR scan reaches.
  return redirectTo(baseUrl, `/${resolved.slug}/review`);
}

/**
 * Stamps the click, emits the event, and moves the customer's manual status along.
 *
 * All three are best-effort and run together: this sits between a customer's tap and the page they
 * are waiting for, so the three writes are one round trip's worth of latency rather than three, and
 * none of them may keep the visitor from arriving (AC-035).
 */
async function record(
  database: ReturnType<typeof db>,
  request: NextRequest,
  resolved: NonNullable<Awaited<ReturnType<typeof findRequestByTrackingToken>>>,
): Promise<void> {
  // A messaging client building a preview card is not the recipient opening the link, and for
  // WhatsApp that fetch comes from the *sender's* device before the message is even sent. Counting
  // it would report "link opened" for every request the owner prepared. See ./link-preview.
  if (looksLikeLinkPreviewFetch(request.headers.get('user-agent'))) return;

  let sessionId: string | null = null;
  try {
    // Ties this click to the same anonymous session the review page will use, so the funnel joins up
    // (AN-01-02: a session, not a person). Null on a first-ever visit, because the cookie minted by
    // proxy.ts is only visible to the browser on its next request — the same limitation `/r/{code}`
    // documents. The event's `anonymous_session_id` is optional in the taxonomy for that reason.
    const session = await resolveAnonymousSession(request, resolved.businessId);
    sessionId = session?.sessionId ?? null;
  } catch (error) {
    console.warn('[review-request-link] anonymous session unavailable', error);
  }

  const outcomes = await Promise.allSettled([
    recordLinkClick(database, resolved.requestId),
    recordLinkClickEvent(database, {
      businessId: resolved.businessId,
      requestId: resolved.requestId,
      anonymousSessionId: sessionId,
    }),
    /*
     * The customer's own contact row, which is the tenant's private data and not analytics.
     *
     * Flow F step 9 forbids exposing the customer's identity in public *analytics*, and the event
     * above honours that — it carries the request id and nothing else. This is the other side of the
     * same coin: the owner already knows who they messaged, and "the link you sent Priya was opened"
     * is the entire point of a tracked link. LINK_CLICKED exists in `customer_request_status` and
     * nothing else in the product can ever set it.
     */
    advanceCustomerStatus(database, resolved.businessId, resolved.customerId, 'LINK_CLICKED'),
  ]);

  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      console.warn('[review-request-link] click write failed', outcome.reason);
    }
  }
}

/**
 * 302 rather than 301 or 308: the destination is a live lookup, and a permanent redirect would be
 * cached by the browser forever — after which a suspension or an address change would never be seen,
 * and the second click on the link would never reach this handler to be counted.
 */
function redirectTo(baseUrl: string, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, baseUrl), 302);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
