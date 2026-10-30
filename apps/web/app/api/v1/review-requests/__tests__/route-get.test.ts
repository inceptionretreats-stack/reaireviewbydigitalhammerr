import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  loadRecentRequests: vi.fn(),
  requireTenant: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: () => ({}) }));
vi.mock('@/lib/env', () => ({ env: () => ({ APP_BASE_URL: 'https://app.example' }) }));
vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn() }));
vi.mock('@/lib/api-error', async () => import('../../../../../lib/api-error'));
vi.mock('@/lib/require-tenant', () => ({
  requireTenant: mocks.requireTenant,
  requireActiveTenant: vi.fn(),
}));
vi.mock('../service', async () => ({
  ...(await vi.importActual<typeof import('../service')>('../service')),
  loadRecentRequests: mocks.loadRecentRequests,
}));

import { GET } from '../route';

const TOKEN = 'a'.repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTenant.mockResolvedValue({
    ok: true,
    context: { session: { userId: 'owner-id' }, businessId: 'business-id' },
  });
});

describe('GET /api/v1/review-requests', () => {
  it('lists recent requests with the tracked and WhatsApp links the web screen derives', async () => {
    const message = `Hi Asha, please review us: https://app.example/r/req/${TOKEN}`;
    mocks.loadRecentRequests.mockResolvedValueOnce([
      {
        id: 'request-1',
        customerId: 'customer-1',
        customerName: 'Asha',
        customerMobile: '+919876543210',
        renderedMessage: message,
        preparedAt: new Date('2026-10-01T10:00:00.000Z'),
        markedSentAt: null,
        firstClickedAt: new Date('2026-10-02T10:00:00.000Z'),
        lastClickedAt: null,
      },
    ]);

    const response = await GET(new NextRequest('https://app.example/api/v1/review-requests'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.loadRecentRequests).toHaveBeenCalledWith(expect.anything(), 'business-id');
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({
      id: 'request-1',
      customer: { id: 'customer-1', name: 'Asha', mobile: '+919876543210' },
      rendered_message: message,
      review_link: `https://app.example/r/req/${TOKEN}`,
      prepared_at: '2026-10-01T10:00:00.000Z',
      marked_sent_at: null,
      first_clicked_at: '2026-10-02T10:00:00.000Z',
      last_clicked_at: null,
    });
    expect(body.requests[0].whatsapp_url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
  });

  it('refuses a caller without a session', async () => {
    const { apiError } = await import('../../../../../lib/api-error');
    mocks.requireTenant.mockResolvedValueOnce({
      ok: false,
      response: apiError('AUTH_REQUIRED', 'Please sign in and try again.'),
    });

    const response = await GET(new NextRequest('https://app.example/api/v1/review-requests'));

    expect(response.status).toBe(401);
    expect(mocks.loadRecentRequests).not.toHaveBeenCalled();
  });
});
