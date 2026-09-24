import { NextResponse, type NextRequest } from 'next/server';
import { EVENT_SPECS, isEventName, validateEvent } from '@ai-review/analytics';
import { analyticsEvents } from '@ai-review/db';
import { db } from '@/lib/db';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import { resolvePublicRef } from '@/lib/resolve-public-ref';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';

/**
 * Public analytics ingestion.
 *
 * Events are allow-listed against the delivered taxonomy (AN-01-01) because the payload comes
 * from a browser and is untrusted, and ingestion failure must never break the customer flow
 * (AC-035).
 *
 * Identity properties are injected HERE from server-resolved state, never taken from the
 * request. Each event receives only the identity keys declared by the taxonomy: adding
 * `qr_code_id` indiscriminately makes strict validation reject events such as `review_copy`,
 * even though the QR relation still belongs in the database column.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const bodyResult = await readJsonObject(request);
  if (!bodyResult.ok) return bodyResult.response;

  const body = bodyResult.body as {
    name?: string;
    properties?: Record<string, unknown>;
    slug?: string;
    qr_code?: string;
  };

  const { name, properties = {} } = body;
  if (!name) return apiError('VALIDATION_FAILED', 'Event name is required.');
  if (!isEventName(name)) {
    console.warn(`[analytics] rejected event: Unknown event name: ${name}`);
    return accepted(false);
  }

  const resolved = await resolvePublicRef({ slug: body.slug, qrCode: body.qr_code });
  if (!resolved.ok) return accepted(false);

  const { businessId, qrCodeId } = resolved.ref;

  try {
    const session = await resolveAnonymousSession(request, businessId);
    const spec = EVENT_SPECS[name];
    const declared = new Set<string>([...spec.required, ...spec.optional]);

    const enriched: Record<string, unknown> = {
      ...stripIdentityKeys(properties),
      ...(declared.has('business_id') ? { business_id: businessId } : {}),
      ...(session && declared.has('anonymous_session_id')
        ? { anonymous_session_id: session.sessionId }
        : {}),
      ...(qrCodeId && declared.has('qr_code_id') ? { qr_code_id: qrCodeId } : {}),
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
