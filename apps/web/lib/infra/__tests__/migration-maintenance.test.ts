import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextRequest, type NextResponse } from 'next/server';
// This installed Next version still exports the matcher utility under its legacy name.
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import proxy, { config } from '@/proxy';

const ORIGIN = 'https://aireview.digitalhammerr.com';

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), init);
}

function expectStopped(response: NextResponse): void {
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('120');
  expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
  expect(response.headers.get('cdn-cache-control')).toBe('no-store');
  expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
  expect(response.headers.get('x-robots-tag')).toContain('noindex');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('x-middleware-next')).toBeNull();
  expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  expect(response.headers.get('location')).toBeNull();
}

afterEach(() => vi.unstubAllEnvs());

describe('canonical Google auth origin', () => {
  beforeEach(() => vi.stubEnv('MIGRATION_MAINTENANCE', '0'));

  it.each(['/login', '/signup', '/signup/google'])(
    'redirects the legacy Vercel alias auth page %s to the authorized domain',
    (path) => {
      const response = proxy(
        new NextRequest(`https://ai-review-dh.vercel.app${path}?source=legacy`),
      );
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        `https://aireview.digitalhammerr.com${path}?source=legacy`,
      );
      expect(response.headers.get('set-cookie')).toBeNull();
    },
  );

  it('keeps QR pages on their original host and leaves the canonical auth page alone', () => {
    const qr = proxy(new NextRequest('https://ai-review-dh.vercel.app/r/example'));
    const signup = proxy(new NextRequest(`${ORIGIN}/signup`));
    expect(qr.headers.get('location')).toBeNull();
    expect(signup.headers.get('location')).toBeNull();
  });
});

describe('migration maintenance coverage', () => {
  beforeEach(() => vi.stubEnv('MIGRATION_MAINTENANCE', '1'));

  it('matches and blocks every current page and route-handler path, including Server Actions', () => {
    // Inventory filenames only; never import route modules or connect to external services.
    const app = fileURLToPath(new URL('../../../app/', import.meta.url));
    const paths = readdirSync(app, { recursive: true })
      .filter((name): name is string => typeof name === 'string')
      .filter((name) => /(?:^|[\\/])(?:page|route)\.tsx?$/.test(name))
      .map((name) => {
        const segments = name.replaceAll('\\', '/').split('/').slice(0, -1);
        return (
          '/' +
          segments
            .filter((segment) => !segment.startsWith('('))
            .map((segment) => (segment.startsWith('[') ? 'example' : segment))
            .join('/')
        );
      });
    expect(paths.length).toBeGreaterThan(50);
    for (const path of new Set(paths)) {
      expect(doesProxyMatch({ config, nextConfig: {}, url: path }), path).toBe(true);
      expectStopped(proxy(request(path)));
      expectStopped(
        proxy(request(path, { method: 'POST', headers: { 'next-action': 'example' } })),
      );
    }
  });

  it.each([
    '/',
    '/app',
    '/app/profile',
    '/admin',
    '/admin/settings',
    '/onboarding/business',
    '/login',
    '/r/example',
    '/r/req/example',
    '/example/review',
    '/example/feedback',
    '/api/cron/health',
    '/api/cron/maintenance',
    '/api/cron/subscriptions',
    '/api/v1/webhooks/razorpay',
    '/api/v1/public/review/generate',
    '/api/v1/public/events',
    '/api/v1/auth/signup',
    '/api/v1/subscription/checkout',
    '/api/v1/qr/example/download',
    '/api/export.json',
    '/example.png',
    '/marketing/review',
    '/_next/data/build/app.json',
    '/_next/image?url=%2Fapi%2Fv1%2Fqr%2Fexample%2Fdownload&w=640&q=75',
  ])('blocks reads, prefetched reads, and every write method on %s', (path) => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expectStopped(proxy(request(path, { method })));
    }
    const headers = { 'next-router-prefetch': '1', purpose: 'prefetch', rsc: '1' };
    expect(doesProxyMatch({ config, nextConfig: {}, url: path, headers })).toBe(true);
    expectStopped(proxy(request(path, { headers })));
  });

  it('returns a readable standalone HTML page without echoing request data', async () => {
    const response = proxy(request('/customer-secret?token=private-token'));
    expectStopped(response);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const body = await response.text();
    expect(body).toContain("<h1>We'll be back shortly.</h1>");
    expect(body).toContain('Ai Review by Digital Hammerr');
    expect(body).not.toMatch(/customer-secret|private-token|<script|https?:\/\//);
  });

  it.each<{ path: string; method: string; headers: Record<string, string> }>([
    { path: '/api/v1/account', method: 'GET', headers: {} },
    { path: '/api/v1/webhooks/razorpay', method: 'POST', headers: { accept: 'text/html' } },
    { path: '/app/settings', method: 'POST', headers: { 'next-action': 'private-action' } },
    { path: '/', method: 'GET', headers: { accept: 'application/json' } },
  ])('returns a retryable JSON error for $method $path', async ({ path, method, headers }) => {
    const response = proxy(request(path, { method, headers }));
    expectStopped(response);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      error: {
        code: 'MAINTENANCE',
        message:
          'Ai Review is temporarily unavailable for a scheduled update. Please try again shortly.',
      },
      retry_after_seconds: 120,
    });
  });

  it.each(['/', '/api/v1/account'])('returns no response body for HEAD %s', async (path) => {
    const response = proxy(request(path, { method: 'HEAD' }));
    expectStopped(response);
    expect(await response.text()).toBe('');
  });

  it('does not allow cookies, auth, query flags, or internal-looking headers to bypass the gate', async () => {
    const response = proxy(
      request('/app/profile?MIGRATION_MAINTENANCE=0&bypass=1', {
        headers: {
          cookie: 'dh_anon=private-cookie; session=private-session; maintenance=0',
          authorization: 'Bearer private-token',
          'x-maintenance-bypass': '1',
          'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy',
          'x-vercel-protection-bypass': 'private-bypass',
        },
      }),
    );
    expectStopped(response);
    expect(await response.text()).not.toMatch(/private-|bypass|MIGRATION_MAINTENANCE/);
  });

  it.each(['GET', 'HEAD'])('allows only generated static asset reads: %s', (method) => {
    const response = proxy(request('/_next/static/chunks/app.js', { method }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'never exempts %s requests just because they use a static asset path',
    (method) => expectStopped(proxy(request('/_next/static/chunks/app.js', { method }))),
  );

  it('does not exempt a Server Action header on a static read', () => {
    expectStopped(
      proxy(request('/_next/static/chunks/app.js', { headers: { 'next-action': 'x' } })),
    );
  });

  it('does not exempt static-looking prefix collisions', () => {
    expectStopped(proxy(request('/_next/static-api/write')));
    expectStopped(proxy(request('/_next/static')));
    expectStopped(proxy(request('/_next/static/../data/build/app.json')));
  });
});

describe('normal proxy behavior when migration maintenance is off', () => {
  beforeEach(() => vi.stubEnv('MIGRATION_MAINTENANCE', undefined));

  it.each([undefined, '', '0', 'false', 'true', '01'])('is off for flag %s', (flag) => {
    vi.stubEnv('MIGRATION_MAINTENANCE', flag);
    const response = proxy(request('/r/example'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('retry-after')).toBeNull();
    expect(response.cookies.get('dh_anon')?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each([
    '/api/v1/auth/signup',
    '/api/cron/maintenance',
    '/api/v1/webhooks/razorpay',
    '/app/settings',
    '/admin/settings',
    '/_next/static/chunks/app.js',
    '/_next/image',
    '/favicon.ico',
  ])('does not add an anonymous cookie to a previously excluded route: %s', (path) => {
    const response = proxy(request(path));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
  });

  it('preserves the existing cookie without replacing or forwarding it again', () => {
    const response = proxy(
      request('/r/example', { headers: { cookie: 'dh_anon=existing-token' } }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
  });

  it.each(['https://merchant.example', 'http://127.0.0.1:3000'])(
    'preserves host and cookie forwarding on %s',
    (origin) => {
      const input = new NextRequest(`${origin}/r/example`, {
        headers: { cookie: 'existing=value' },
      });
      const originalUrl = input.nextUrl.href;
      const response = proxy(input);
      const token = response.cookies.get('dh_anon')?.value;
      expect(input.nextUrl.href).toBe(originalUrl);
      expect(response.headers.get('x-middleware-request-cookie')).toBe(
        `existing=value; dh_anon=${token}`,
      );
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
      expect(response.headers.get('cookie')).toBeNull();
      expect(response.headers.get('set-cookie')).toContain('HttpOnly');
      expect(response.headers.get('set-cookie')).toContain('SameSite=lax');
    },
  );

  it('reads the server flag per invocation', () => {
    expect(proxy(request('/api/v1/account')).status).toBe(200);
    vi.stubEnv('MIGRATION_MAINTENANCE', '1');
    expectStopped(proxy(request('/api/v1/account')));
    vi.stubEnv('MIGRATION_MAINTENANCE', '0');
    expect(proxy(request('/api/v1/account')).status).toBe(200);
  });
});
