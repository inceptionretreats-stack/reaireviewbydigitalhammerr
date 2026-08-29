import { NextResponse, type NextRequest } from 'next/server';
import { validateEvent } from '@ai-review/analytics';
import { analyticsEvents } from '@ai-review/db';
import { db } from '@/lib/db';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import { resolvePublicRef } from '@/lib/resolve-public-ref';
import { apiError } from '@/lib/api-error';

/**
 * Public analytics ingestion.
 *
 * Events are allow-listed against the delivered taxonomy (AN-01-01) because the payload comes
 * from a browser and is untrusted, and ingestion failure must never break the customer flow
 * (AC-035).
 *
 * The identity properties every event requires — business_id, anonymous_session_id, qr_code_id
 * — are injected HERE from server-resolved state, never taken from the request. An earlier
 * revision expected the client to send them; it sent qr_code instead and never sent the two
 * required ones at all, so validateEvent rejected every single event and the endpoint returned
 * 202. The entire customer funnel, including both conversion metrics, silently recorded
 * nothing. Injecting server-side makes that failure mode structurally impossible.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    name?: string;
    properties?: Record<string, unknown>;
    slug?: string;
    qr_code?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const { name, properties = {} } = body;
  if (!name) return apiError('VALIDATION_FAILED', 'Event name is required.');

  const resolved = await resolvePublicRef({ slug: body.slug, qrCode: body.qr_code });
  if (!resolved.ok) return accepted(false);

  const { businessId, qrCodeId } = resolved.ref;

  try {
    const session = await resolveAnonymousSession(request, businessId);

    const enriched: Record<string, unknown> = {
      ...stripIdentityKeys(properties),
      business_id: businessId,
      ...(session ? { anonymous_session_id: session.sessionId } : {}),
      ...(qrCodeId ? { qr_code_id: qrCodeId } : {}),
    };

    const validation = validateEvent(name, enriched);
    if (!validation.ok) {
      // Not silent: an off-taxonomy event is a client bug, and swallowing it invisibly is how
      // a broken funnel goes unnoticed. Still a 202 so the customer is never affected.
      console.warn(`[analytics] rejected event: ${validation.reason}`);
      return accepted(false);
    }

    await db()
      .insert(analyticsEvents)
      .values({
        businessId,
        anonymousSessionId: session?.sessionId ?? null,
        qrCodeId: qrCodeId ?? null,
        eventName: validation.name,
        properties: enriched,
      });
  } catch (error) {
    console.warn('[analytics] ingestion failed', error);
    return accepted(false);
  }

  return accepted(true);
}

/**
 * Identity is server-authoritative. A client claiming a different business_id or session must
 * not be able to write an event into another tenant's analytics.
 */
function stripIdentityKeys(properties: Record<string, unknown>): Record<string, unknown> {
  const { business_id: _b, anonymous_session_id: _s, qr_code_id: _q, ...rest } = properties;
  return rest;
}

function accepted(stored: boolean): NextResponse {
  return NextResponse.json({ accepted: stored }, { status: 202 });
}
