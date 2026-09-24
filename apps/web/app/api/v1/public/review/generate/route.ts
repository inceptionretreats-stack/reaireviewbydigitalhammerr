import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { aiGenerations, analyticsEvents } from '@ai-review/db';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import { resolvePublicRef } from '@/lib/resolve-public-ref';
import {
  buildGenerator,
  loadGenerationContext,
  loadAiControls,
  loadPlan,
  loadPreviousDrafts,
  providerKeys,
  releaseQuota,
  selectProvider,
} from '@/lib/generation-service';
import { clientIp, isDenied, rateLimiter } from '@/lib/rate-limit';
import { validateSelectedServices } from '@/lib/customer-services';
import { safeError } from '@/lib/safe-error';

const requestSchema = z.object({
  slug: z.string().min(1).max(160).optional(),
  qr_code: z.string().min(1).max(160).optional(),
  previous_generation_id: z.uuid().optional(),
  selected_services: z.unknown().optional(),
});

/**
 * POST /api/v1/public/review/generate — REV-01 and Flow D.
 *
 * The ordering carries the acceptance criteria: quota is reserved inside the generator before
 * the provider call (AC-013), released on failure (AC-014), and the quality gate's internal
 * retry sits inside that one reservation so two provider calls remain one customer generation.
 *
 * The tenant is resolved server-side from the public slug or QR code. It is never taken from
 * the request body — doing so let a caller pass any business id and consume that business's
 * free quota, and leaked internal UUIDs to the browser besides.
 *
 * No star rating is accepted or returned at any point (D-009, AC-006), and no response ever
 * suggests the review was posted (D-028, AC-025).
 */
/**
 * The generator waits on the model for up to AI_REQUEST_TIMEOUT_MS and retries once on a 503, so
 * on a serverless host the function must be allowed to outlive a default 10 s budget. Ignored
 * by `next start`; read by Vercel.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBodyResult = await readJsonObject(request);
  if (!rawBodyResult.ok) return rawBodyResult.response;
  const rawBody = rawBodyResult.body;

  const parsedBody = requestSchema.safeParse(rawBody);
  if (!parsedBody.success) return apiError('VALIDATION_FAILED', 'Malformed request body.');
  const body = parsedBody.data;

  const resolved = await resolvePublicRef({ slug: body.slug, qrCode: body.qr_code });
  if (!resolved.ok) {
    if (resolved.reason === 'QR_DISABLED') {
      return apiError('QR_DISABLED', 'This review code is no longer active.');
    }
    // A missing business and a suspended one report identically, so the endpoint cannot be
    // used to enumerate which businesses exist or which are suspended.
    return apiError('RESOURCE_NOT_FOUND', 'This review page is not available.');
  }

  const { businessId, qrCodeId } = resolved.ref;
  const database = db();
  const session = await resolveAnonymousSession(request, businessId);

  // AMENDMENT-030: an admin has switched Ai off for this business. The page and the Google
  // button keep working; the customer is told drafting is unavailable, in the same words as
  // a provider outage (Flow E step 3), and nothing about why.
  const controls = await loadAiControls(database, businessId);
  if (controls.suspended) {
    if (session) {
      await recordEvent(database, {
        businessId,
        sessionId: session.sessionId,
        qrCodeId,
        name: 'ai_generate_failure',
        properties: { error_class: 'AI_SUSPENDED', provider: 'admin' },
      });
    }
    return apiError(
      'AI_SUSPENDED',
      'The writing assistant is unavailable right now. You can still write your own review.',
    );
  }

  const context = await loadGenerationContext(database, businessId);
  if (!context) {
    return apiError(
      'AI_PROVIDER_UNAVAILABLE',
      'The writing assistant is unavailable right now. You can still write your own review.',
    );
  }

  // Check the customer choice before rate-limit consumption, quota reservation or model work.
  // The business context comes from the resolved QR/slug, never from browser-supplied context.
  const selection = validateSelectedServices(body.selected_services, context.business.services);
  if (!selection.ok) return apiError('VALIDATION_FAILED', selection.message);

  // AC-032, and before anything expensive: a denied request must not reach the provider, and
  // must not consume the free quota either. Four dimensions in one atomic decision — session
  // burst, session hourly, adaptive IP prefix, and paid abuse observation for Pro tenants.
  // Runs for every caller, with or without a session. It used to sit behind `if (session)`,
  // which meant a client that simply omitted the dh_anon cookie reached the AI provider with
  // no burst, hourly, IP-prefix or paid-abuse check applied — leaving the tenant's draft quota
  // as the only thing standing between a script and their year's allowance. The session-keyed
  // dimensions drop out for such a caller; the prefix-keyed and business-keyed ones do not.
  const decision = await rateLimiter().publicGeneration({
    businessId,
    anonymousSessionId: session?.sessionId ?? null,
    ip: clientIp(request),
    pepper: env().HASH_PEPPER,
    plan: await loadPlan(database, businessId),
    adminThrottle: controls.throttle,
  });

  if (isDenied(decision)) {
    await recordEvent(database, {
      businessId,
      sessionId: session?.sessionId ?? null,
      qrCodeId,
      name: 'ai_generate_failure',
      properties: { error_class: decision.code, provider: 'rate_limit' },
    });

    return apiError(
      decision.code,
      'You have requested several drafts already. Please wait a moment and try again.',
      { retryAfterSeconds: decision.retryAfterSeconds },
    );
  }

  const previousDrafts = session ? await loadPreviousDrafts(database, session.sessionId) : [];
  const provider = selectProvider(providerKeys());
  const generator = buildGenerator(database, provider);

  const outcome = await generator.generate({
    businessId,
    request: {
      business: context.business,
      reviewMode: context.reviewMode,
      previousDrafts,
      generationNumber: previousDrafts.length + 1,
      draftLanguage: context.draftLanguage,
      ...(selection.services.length > 0 ? { selectedServices: selection.services } : {}),
      // Stable across the retries inside this request, different between customers. A visitor
      // without the cookie gets a per-request id: still varied, just not repeatable.
      variationSeed: session?.sessionId ?? crypto.randomUUID(),
    },
    promptVersion: context.promptVersion,
    timeoutMs: env().AI_REQUEST_TIMEOUT_MS,
  });

  if (!outcome.ok) {
    // Server log only — the customer still gets the fixed message below. Without this line a
    // wrong key or an unknown model id is indistinguishable from the provider being down: the
    // adapter's (already redacted, AC-030) reason was dropped here and nothing ever printed it.
    if (outcome.failure.code === 'AI_PROVIDER_UNAVAILABLE') {
      console.warn('[ai] generation failed', {
        provider: provider.name,
        error_class: outcome.failure.errorClass,
        message: outcome.failure.message,
      });
    } else if (outcome.failure.code === 'AI_OUTPUT_REJECTED') {
      console.warn('[ai] draft rejected', {
        provider: provider.name,
        rejections: outcome.failure.rejections,
      });
    }
    await recordEvent(database, {
      businessId,
      sessionId: session?.sessionId ?? null,
      qrCodeId,
      name: 'ai_generate_failure',
      // The provider that actually ran, not a literal. This said 'openai' unconditionally,
      // so every stub failure was recorded as an OpenAI failure and any cost or reliability
      // dashboard built on this event was reporting a vendor that had never been called.
      properties: { error_class: outcome.failure.code, provider: provider.name },
    });
    return failureResponse(outcome.failure.code);
  }

  const { draft } = outcome;

  // AC-014: a customer who ends up with no usable draft must not lose a generation. The
  // reservation was committed inside the generator, so if the draft cannot be persisted here
  // it has to be handed back explicitly — otherwise a transient database error silently burns
  // one of a Free tenant's ten lifetime drafts and shows the customer an error anyway. An
  // uncaught throw here was also the one place a public endpoint answered a bare 500 instead
  // of the documented error envelope.
  let row: { id: string } | undefined;
  try {
    [row] = await database
      .insert(aiGenerations)
      .values({
        businessId,
        anonymousSessionId: session?.sessionId ?? null,
        qrCodeId,
        reviewModeId: context.reviewModeId,
        parentGenerationId: body.previous_generation_id ?? null,
        promptVersionId: draft.promptVersionId,
        model: draft.model,
        generationNumber: previousDrafts.length + 1,
        reviewText: draft.reviewText,
        inputTokens: draft.inputTokens,
        outputTokens: draft.outputTokens,
        providerRequestId: draft.providerRequestId,
        similarityScore: draft.similarityScore.toFixed(4),
        countedTowardQuota: draft.countedTowardQuota,
      })
      .returning({ id: aiGenerations.id });
  } catch (error) {
    console.error('[ai] could not persist a generated draft', safeError(error));
  }

  if (!row) {
    await releaseQuota(database, outcome.reservation);
    return apiError('INTERNAL_ERROR', 'Could not save your draft. Please try again.');
  }

  await recordEvent(database, {
    businessId,
    sessionId: session?.sessionId ?? null,
    qrCodeId,
    name: 'ai_generate_success',
    properties: {
      generation_id: row.id,
      model: draft.model,
      latency_ms: draft.latencyMs,
      quota_type: draft.quotaType,
      selected_services: selection.services,
    },
  });

  return NextResponse.json({
    generation_id: row.id,
    review_text: draft.reviewText,
    prompt_version: context.promptVersion.version,
    selected_services: selection.services,
    // The client must not enable Copy without this (AC-008, ADR-008).
    requires_experience_confirmation: true,
  });
}

function failureResponse(code: string): NextResponse {
  switch (code) {
    case 'PLAN_QUOTA_EXHAUSTED':
      // Flow E step 3: a business-safe message. It must not suggest the business has done
      // anything wrong, and the direct review link stays available on the page.
      return apiError(
        'PLAN_QUOTA_EXHAUSTED',
        'The writing assistant is unavailable right now. You can still write your own review.',
      );
    case 'AI_OUTPUT_REJECTED':
      return apiError(
        'AI_OUTPUT_REJECTED',
        'We could not produce a suitable draft. Please try again.',
      );
    case 'BUSINESS_NOT_ACTIVE':
    case 'SUBSCRIPTION_NOT_ACTIVE':
      return apiError('BUSINESS_NOT_ACTIVE', 'This review page is not available.');
    default:
      return apiError(
        'AI_PROVIDER_UNAVAILABLE',
        'The writing assistant is unavailable right now. You can still write your own review.',
      );
  }
}

/** Server-emitted funnel events. AC-035: an analytics failure never fails the request. */
async function recordEvent(
  database: ReturnType<typeof db>,
  input: {
    businessId: string;
    sessionId: string | null;
    qrCodeId: string | null;
    name: string;
    properties: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await database.insert(analyticsEvents).values({
      businessId: input.businessId,
      anonymousSessionId: input.sessionId,
      qrCodeId: input.qrCodeId,
      eventName: input.name,
      properties: { ...input.properties, business_id: input.businessId },
    });
  } catch (error) {
    console.warn('[analytics] server event failed', error);
  }
}
