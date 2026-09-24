import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  session: vi.fn(),
  controls: vi.fn(),
  context: vi.fn(),
  previous: vi.fn(),
  plan: vi.fn(),
  limit: vi.fn(),
  throttle: vi.fn(),
  provider: vi.fn(),
  build: vi.fn(),
  generate: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: () => ({ insert: mocks.insert }) }));
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
  rateLimiter: () => ({ publicGeneration: mocks.limit, businessThrottle: mocks.throttle }),
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
  mocks.throttle.mockResolvedValue({ allowed: true });
  mocks.provider.mockReturnValue({ name: 'test' });
  mocks.build.mockReturnValue({ generate: mocks.generate });
  mocks.generate.mockResolvedValue({
    ok: true,
    draft: {
      reviewText: 'This is an editable draft about the services selected by this customer.',
      promptVersionId: 'prompt',
      model: 'test-model',
      inputTokens: 100,
      outputTokens: 50,
      providerRequestId: 'test-request',
      similarityScore: 0,
      countedTowardQuota: true,
      latencyMs: 1,
      quotaType: 'FREE',
    },
  });
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
        business_id: 'attacker-business',
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
  });

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
      { qr_code: {} },
      { qr_code: 'code', previous_generation_id: 'not-a-uuid' },
    ].map((body) => ({ body })),
  )('returns validation, not a runtime error, for malformed bodies (%j)', async ({ body }) => {
    expect((await POST(request(body))).status).toBe(422);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
