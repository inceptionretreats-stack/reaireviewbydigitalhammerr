import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
import { submitFeedbackRequest } from '@ai-review/contracts';
import { analyticsEvents, privateFeedback } from '@ai-review/db';
import { normalizePhone } from '@ai-review/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import { resolvePublicRef } from '@/lib/resolve-public-ref';

/**
 * POST /api/v1/public/feedback — FB-01, private feedback.
 *
 * Open to every visitor with no login and no sentiment precondition (PUB-01-01, FB-01-01,
 * AC-024). Nothing in the payload describes how the visit went, because nothing asks
 * (D-009, AC-006).
 *
 * The tenant is resolved server-side from the public slug, never taken from the body: the same
 * rule the generate endpoint follows, and for the same reason — a client-supplied business id
 * would let anyone write feedback into another tenant's inbox.
 *
 * AC-039 governs what leaves this handler. The customer's name and mobile are stored for the
 * business and go nowhere else: not into the analytics properties, not into a log line, and
 * not into the response.
 */

/**
 * Per-session write cap.
 *
 * 13_Security_Privacy_Compliance.md puts rate limiting on public feedback endpoints on the
 * security baseline, but no shared limiter exists yet (02_System_Architecture.md puts it in
 * Redis, which has no client wired up). This is the interim control that can be built from what
 * is already here: it is per anonymous session and backed by the database, so unlike an
 * in-process counter it holds across both web containers.
 *
 * It is not a substitute for the WAF/Redis limiter — a client that discards its cookie gets a
 * fresh session — but it does stop the cheap case, a single browser posting in a loop.
 */
const MAX_SUBMISSIONS_PER_SESSION = 5;
const THROTTLE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  // Trim before validating. Whitespace satisfies a bare min-length check without being a
  // message, and an empty optional field must become absent rather than an empty string, so
  // that private_feedback.name stays NULL instead of holding ''.
  const parsed = submitFeedbackRequest.safeParse({
    slug: trimmed(body.slug),
    name: trimmedOrUndefined(body.name),
    mobile: trimmedOrUndefined(body.mobile),
    message: trimmed(body.message),
  });

  if (!parsed.success) {
    // Field names and rule violations only. Echoing the submitted values back would put the
    // customer's name and mobile into an error payload (AC-039).
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || '(root)';
      fields[field] ??= issue.message;
    }
    return apiError('VALIDATION_FAILED', 'Please check the details you entered.', { fields });
  }

  const { slug, name, mobile, message } = parsed.data;

  const resolved = await resolvePublicRef({ slug });
  if (!resolved.ok) {
    // A missing business and a suspended one answer identically, so this endpoint cannot be
    // used to enumerate which businesses exist or which have been suspended.
    return apiError('RESOURCE_NOT_FOUND', 'This feedback page is not available.');
  }

  const { businessId } = resolved.ref;
  const database = db();
  const session = await resolveAnonymousSession(request, businessId);

  if (session && (await isThrottled(database, businessId, session.sessionId))) {
    return apiError(
      'PUBLIC_RATE_LIMITED',
      'You have sent several messages already. Please try again a little later.',
    );
  }

  const [row] = await database
    .insert(privateFeedback)
    .values({
      businessId,
      anonymousSessionId: session?.sessionId ?? null,
      name: name ?? null,
      mobile: normalizeMobile(mobile),
      message,
    })
    .returning({ id: privateFeedback.id });

  if (!row) {
    return apiError('INTERNAL_ERROR', 'We could not save your feedback. Please try again.');
  }

  await recordSubmit(database, businessId, session?.sessionId ?? null, row.id);

  // Deliberately not returning the feedback id. Nothing in the customer flow needs it, and
  // 02_System_Architecture.md is explicit that internal identifiers do not cross into the
  // browser unless a screen depends on them.
  return NextResponse.json({ received: true }, { status: 201 });
}

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimmedOrUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const result = value.trim();
  return result.length > 0 ? result : undefined;
}

/**
 * Stores E.164 when the number can be normalized, and the customer's own text when it cannot.
 *
 * The mobile is optional and 03_Screen_Field_Button_Spec.md sets no format for it, so rejecting
 * a submission over a badly typed phone number would lose the message itself — which is the
 * part the business actually needs. Normalizing when possible still gives CRM-01-03 and the
 * wa.me reply link a usable number for the common case (D-002: a bare 10-digit Indian mobile).
 */
function normalizeMobile(mobile: string | undefined): string | null {
  if (!mobile) return null;
  const normalized = normalizePhone(mobile);
  return normalized.ok ? normalized.e164 : mobile;
}

async function isThrottled(
  database: ReturnType<typeof db>,
  businessId: string,
  sessionId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - THROTTLE_WINDOW_MS);

  const recent = await database
    .select({ id: privateFeedback.id })
    .from(privateFeedback)
    .where(
      and(
        eq(privateFeedback.businessId, businessId),
        eq(privateFeedback.anonymousSessionId, sessionId),
        gt(privateFeedback.createdAt, since),
      ),
    )
    .limit(MAX_SUBMISSIONS_PER_SESSION);

  return recent.length >= MAX_SUBMISSIONS_PER_SESSION;
}

/**
 * private_feedback_submit. AC-035: the feedback is already stored, so an analytics failure must
 * not turn a successful submission into an error the customer sees.
 *
 * feedback_id is the only identifier carried. The message, name and mobile are never copied
 * into an event, because analytics_events is read by dashboards and exported for aggregation
 * (AC-039).
 */
async function recordSubmit(
  database: ReturnType<typeof db>,
  businessId: string,
  sessionId: string | null,
  feedbackId: string,
): Promise<void> {
  try {
    await database.insert(analyticsEvents).values({
      businessId,
      anonymousSessionId: sessionId,
      eventName: 'private_feedback_submit',
      properties: {
        business_id: businessId,
        ...(sessionId ? { anonymous_session_id: sessionId } : {}),
        feedback_id: feedbackId,
      },
    });
  } catch (error) {
    console.warn('[analytics] private_feedback_submit failed', error);
  }
}
