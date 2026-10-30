import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  MemoryQuotaStore,
  QuotaService,
  ReviewGenerator,
  StubAiProvider,
  type GenerateOptions,
  type GeneratedDraft,
} from '@ai-review/core';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  session: vi.fn(),
  controls: vi.fn(),
  context: vi.fn(),
  previous: vi.fn(),
  plan: vi.fn(),
  limit: vi.fn(),
  cookieFreeLimit: vi.fn(),
  provider: vi.fn(),
  build: vi.fn(),
  generate: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  lookupLimit: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: () => ({ insert: mocks.insert, select: mocks.select }) }));
vi.mock('@/lib/env', () => ({ env: () => ({ HASH_PEPPER: 'test', AI_REQUEST_TIMEOUT_MS: 8000 }) }));
vi.mock('@/lib/resolve-public-ref', () => ({ resolvePublicRef: mocks.resolve }));
vi.mock('@/lib/anonymous-session', () => ({ resolveAnonymousSession: mocks.session }));
vi.mock('@/lib/api-error', async () => import('../../../../../../../lib/api-error'));
vi.mock(
  '@/lib/customer-services',
  async () => import('../../../../../../../lib/customer-services'),
);
vi.mock('@/lib/generation-service', () => ({
  loadAiControls: mocks.controls,
  loadGenerationContext: mocks.context,
  loadPlan: mocks.plan,
  loadPreviousDrafts: mocks.previous,
  providerKeys: () => ({}),
  selectProvider: mocks.provider,
  buildGenerator: mocks.build,
}));
vi.mock('@/lib/rate-limit', () => ({
  clientIp: () => 'test-ip',
  isDenied: (decision: { allowed: boolean }) => !decision.allowed,
  rateLimiter: () => ({
    publicGeneration: mocks.limit,
    cookieFreeGeneration: mocks.cookieFreeLimit,
  }),
}));

import { POST } from '../route';

const context = {
  business: {
    name: 'Test studio',
    category: 'Services',
    city: null,
    description: null,
    services: ['SEO', 'Web development'],
    contextTerms: [],
  },
  reviewMode: null,
  reviewModeId: null,
  draftLanguage: 'en',
  promptVersion: { id: 'prompt', version: '1.1.0' },
};

const draft: GeneratedDraft = {
  reviewText: 'This is an editable draft about the services selected by this customer.',
  output: {
    review_text: 'This is an editable draft about the services selected by this customer.',
    used_context_terms: [],
    claim_risk: 'low',
    internal_quality_notes: [],
  },
  promptVersionId: 'prompt',
  model: 'test-model',
  inputTokens: 100,
  outputTokens: 50,
  providerRequestId: 'test-request',
  similarityScore: 0,
  countedTowardQuota: true,
  latencyMs: 1,
  quotaType: 'FREE',
  providerCalls: 1,
};
const PARENT_ID = '11111111-1111-4111-8111-111111111111';

function request(body: unknown): NextRequest {
  return new NextRequest('https://example.test/api/v1/public/review/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({
    ok: true,
    ref: { businessId: 'resolved-business', qrCodeId: 'resolved-qr' },
  });
  mocks.session.mockResolvedValue({ sessionId: 'anonymous-test' });
  mocks.controls.mockResolvedValue({ suspended: false, throttle: undefined });
  mocks.context.mockResolvedValue(structuredClone(context));
  mocks.previous.mockResolvedValue([]);
  mocks.plan.mockResolvedValue('FREE');
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.cookieFreeLimit.mockResolvedValue({ allowed: true });
  mocks.provider.mockReturnValue({ name: 'test' });
  mocks.build.mockReturnValue({ generate: mocks.generate });
  mocks.generate.mockImplementation(async (options: GenerateOptions) => {
    await options.persistDraft?.(draft);
    return { ok: true, draft };
  });
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ limit: mocks.lookupLimit });
  mocks.lookupLimit.mockResolvedValue([{ id: PARENT_ID }]);
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([{ id: 'generation-id' }]);
});

describe('public generation service selection boundary', () => {
  it.each([
    { qr_code: 'code' },
    { qr_code: 'code', selected_services: [] },
    { qr_code: 'code', selected_services: ['Injected instructions'] },
    { qr_code: 'code', selected_services: ['SEO', 'Another business service'] },
    { qr_code: 'code', selected_services: null },
    { qr_code: 'code', selected_services: Array(31).fill('SEO') },
  ])(
    'rejects invalid choices before rate-limit consumption, provider selection or quota (%j)',
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(mocks.limit).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.build).not.toHaveBeenCalled();
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(mocks.insert).not.toHaveBeenCalled();
    },
  );

  it('resolves the business server-side and passes only canonical customer choices', async () => {
    const response = await POST(
      request({
        qr_code: 'code',
        selected_services: ['Web development', 'SEO', 'SEO'],
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith({ qrCode: 'code', slug: undefined });
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'resolved-business',
        request: expect.objectContaining({ selectedServices: ['SEO', 'Web development'] }),
      }),
    );
    expect(await response.json()).toMatchObject({
      generation_id: 'generation-id',
      selected_services: ['SEO', 'Web development'],
      requires_experience_confirmation: true,
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'resolved-business', reviewText: draft.reviewText }),
    );
  });

  it('accepts a parent only when its id, business and anonymous session all match', async () => {
    const response = await POST(
      request({ qr_code: 'code', previous_generation_id: PARENT_ID, selected_services: ['SEO'] }),
    );

    expect(response.status).toBe(200);
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ parentGenerationId: PARENT_ID, businessId: 'resolved-business' }),
    );
    const predicate = mocks.where.mock.calls[0]?.[0];
    expect(predicate).toBeDefined();
    const query = new PgDialect().sqlToQuery(predicate);
    expect(query.sql).toContain('"ai_generations"."id" = $1');
    expect(query.sql).toContain('"ai_generations"."business_id" = $2');
    expect(query.sql).toContain('"ai_generations"."anonymous_session_id" = $3');
    expect(query.params).toEqual([PARENT_ID, 'resolved-business', 'anonymous-test']);
  });

  it('rejects a parent outside the current business and session after rate limiting', async () => {
    mocks.lookupLimit.mockResolvedValue([]);

    const response = await POST(
      request({ qr_code: 'code', previous_generation_id: PARENT_ID, selected_services: ['SEO'] }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(mocks.limit).toHaveBeenCalledOnce();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('does not look up a parent when the rate limiter denies the request', async () => {
    mocks.limit.mockResolvedValue({
      allowed: false,
      code: 'PUBLIC_RATE_LIMITED',
      retryAfterSeconds: 30,
    });

    const response = await POST(
      request({ qr_code: 'code', previous_generation_id: PARENT_ID, selected_services: ['SEO'] }),
    );

    expect(response.status).toBe(429);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it('applies the cookie-free limit and business throttle before parent validation', async () => {
    mocks.session.mockResolvedValue(null);
    mocks.controls.mockResolvedValue({
      suspended: false,
      throttle: { perHour: 5, untilMs: Date.now() + 60_000 },
    });
    mocks.cookieFreeLimit.mockResolvedValue({
      allowed: false,
      code: 'FAIR_USE_THROTTLED',
      retryAfterSeconds: 30,
    });

    const response = await POST(
      request({ qr_code: 'code', previous_generation_id: PARENT_ID, selected_services: ['SEO'] }),
    );

    expect(response.status).toBe(429);
    expect(mocks.cookieFreeLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'resolved-business',
        adminThrottle: expect.objectContaining({ perHour: 5 }),
      }),
    );
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('limits a cookie-free visitor even when no admin throttle is configured', async () => {
    mocks.session.mockResolvedValue(null);
    mocks.cookieFreeLimit.mockResolvedValue({
      allowed: false,
      code: 'PUBLIC_RATE_LIMITED',
      retryAfterSeconds: 20,
    });

    const response = await POST(request({ qr_code: 'code', selected_services: ['SEO'] }));

    expect(response.status).toBe(429);
    expect(mocks.cookieFreeLimit).toHaveBeenCalledWith({
      businessId: 'resolved-business',
      ip: 'test-ip',
      pepper: 'test',
      plan: 'FREE',
      adminThrottle: undefined,
    });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('still creates a draft for a cookie-free visitor below the network limit', async () => {
    mocks.session.mockResolvedValue(null);

    const response = await POST(request({ qr_code: 'code', selected_services: ['SEO'] }));

    expect(response.status).toBe(200);
    expect(mocks.cookieFreeLimit).toHaveBeenCalledOnce();
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ anonymousSessionId: null }),
    );
  });

  it('rejects a parent when the browser has no anonymous session', async () => {
    mocks.session.mockResolvedValue(null);

    const response = await POST(
      request({ qr_code: 'code', previous_generation_id: PARENT_ID, selected_services: ['SEO'] }),
    );

    expect(response.status).toBe(422);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.cookieFreeLimit).toHaveBeenCalledOnce();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(['insert rejects', 'insert returns no row'])(
    'returns reserved quota when the draft %s',
    async (failure) => {
      const store = new MemoryQuotaStore();
      store.seed('resolved-business', { mode: 'FREE', used: 0, limit: 10 });
      mocks.context.mockResolvedValue({
        ...context,
        promptVersion: {
          ...context.promptVersion,
          model: 'test-model',
          systemPrompt: 'Write an honest, editable review draft.',
          maxOutputTokens: 320,
          reasoningEffort: 'none',
          outputSchema: {},
        },
      });
      mocks.build.mockReturnValue(
        new ReviewGenerator(new StubAiProvider(), new QuotaService(store)),
      );
      if (failure === 'insert rejects') {
        mocks.returning.mockRejectedValueOnce(new Error('insert failed'));
      } else {
        mocks.returning.mockResolvedValueOnce([]);
      }

      const response = await POST(request({ qr_code: 'code', selected_services: ['SEO'] }));

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
      expect(store.usage('resolved-business')).toBe(0);
    },
  );

  it.each([{ selection: undefined }, { selection: [] }])(
    'retains the general flow when the business has no configured services (%j)',
    async ({ selection }) => {
      mocks.context.mockResolvedValue({
        ...context,
        business: { ...context.business, services: [] },
      });
      const response = await POST(
        request({
          slug: 'test',
          ...(selection === undefined ? {} : { selected_services: selection }),
        }),
      );
      expect(response.status).toBe(200);
      expect(mocks.generate.mock.calls[0]?.[0].request.selectedServices).toBeUndefined();
      expect(await response.json()).toMatchObject({ selected_services: [] });
    },
  );

  it('keeps the rate limit before quota/provider work for a valid selection', async () => {
    mocks.limit.mockResolvedValue({
      allowed: false,
      code: 'PUBLIC_RATE_LIMITED',
      retryAfterSeconds: 30,
    });
    const response = await POST(request({ qr_code: 'code', selected_services: ['SEO'] }));
    expect(response.status).toBe(429);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(
    [
      null,
      [],
      'invalid',
      {},
      { qr_code: {} },
      { qr_code: 'code', previous_generation_id: 'not-a-uuid' },
      { qr_code: 'code', previous_generation_id: null },
      { qr_code: 'code', business_id: 'attacker-business', selected_services: ['SEO'] },
    ].map((body) => ({ body })),
  )('returns validation, not a runtime error, for malformed bodies (%j)', async ({ body }) => {
    expect((await POST(request(body))).status).toBe(422);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
