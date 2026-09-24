import { beforeAll, describe, expect, it } from 'vitest';

/**
 * CSRF origin checking (13_Security_Privacy_Compliance.md).
 *
 * Imported dynamically after the environment is populated, because lib/infra/env.ts validates and
 * caches on first call — a static import would bind the module before these values exist.
 */
let verifyCsrf: (request: Request) => { ok: boolean; reason?: string };

const APP_ORIGIN = 'https://ai-review-dh.vercel.app';
const CUSTOM_APP_ORIGIN = 'https://aireview.digitalhammerr.com';

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    APP_BASE_URL: APP_ORIGIN,
    API_BASE_URL: `${APP_ORIGIN}/api/v1`,
    CSRF_TRUSTED_ORIGINS: CUSTOM_APP_ORIGIN,
    SESSION_SECRET: 'a'.repeat(32),
    APP_ENCRYPTION_KEY: 'b'.repeat(32),
    HASH_PEPPER: 'c'.repeat(32),
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    OPENAI_API_KEY: 'd'.repeat(32),
    OPENAI_DEFAULT_MODEL: 'gpt-5.6-luna',
    S3_BUCKET: 'assets',
    EMAIL_FROM: 'no-reply@digitalhammerr.com',
    // AMENDMENT-029: production refuses to boot without the cron secret.
    CRON_SECRET: 'e'.repeat(32),
  });

  ({ verifyCsrf } = await import('../csrf'));
});

function mutation(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(`${APP_ORIGIN}/api/v1/auth/login`, { method, headers });
}

describe('verifyCsrf', () => {
  it('accepts a same-origin mutation', () => {
    expect(verifyCsrf(mutation({ origin: APP_ORIGIN })).ok).toBe(true);
  });

  it('accepts signup from the explicitly configured custom app domain', () => {
    const request = new Request(`${CUSTOM_APP_ORIGIN}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { origin: CUSTOM_APP_ORIGIN },
    });
    expect(verifyCsrf(request).ok).toBe(true);
  });

  it.each([
    'https://other-app.vercel.app',
    'https://evil.ai-review-dh.vercel.app',
    'https://evil.aireview.digitalhammerr.com',
    'http://aireview.digitalhammerr.com',
    'https://aireview.digitalhammerr.com:8443',
    'https://aireview.digitalhammerr.com.evil.example',
  ])('does not extend explicit app trust to %s', (origin) => {
    expect(verifyCsrf(mutation({ origin })).ok).toBe(false);
  });

  it('does not trust an origin just because request and forwarded hosts match it', () => {
    const request = new Request('https://untrusted.vercel.app/api/v1/auth/signup', {
      method: 'POST',
      headers: {
        origin: 'https://untrusted.vercel.app',
        host: 'untrusted.vercel.app',
        'x-forwarded-host': 'untrusted.vercel.app',
        'x-forwarded-proto': 'https',
      },
    });
    expect(verifyCsrf(request).ok).toBe(false);
  });

  it('accepts an origin differing only by a trailing slash or path', () => {
    expect(verifyCsrf(mutation({ origin: `${APP_ORIGIN}/` })).ok).toBe(true);
  });

  it('rejects a cross-site mutation', () => {
    const result = verifyCsrf(mutation({ origin: 'https://evil.example' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match/i);
  });

  /**
   * A browser always sends Origin on a cross-origin mutation, so its absence on a
   * state-changing request is not a client to extend trust to.
   */
  it('rejects a mutation with no Origin header', () => {
    const result = verifyCsrf(mutation());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing Origin/i);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through without an Origin', (method) => {
    expect(verifyCsrf(mutation({}, method)).ok).toBe(true);
  });

  /**
   * A tenant custom domain (D-024) serves the public renderer only. Trusting it as an origin for
   * authenticated mutations would make any hostname a tenant can point at us a trusted origin
   * for the dashboard.
   */
  it('does not trust a tenant custom domain', () => {
    expect(verifyCsrf(mutation({ origin: 'https://review.somecustomer.com' })).ok).toBe(false);
  });

  it('rejects a subdomain of the app origin', () => {
    expect(verifyCsrf(mutation({ origin: 'https://evil.review.digitalhammerr.com' })).ok).toBe(
      false,
    );
  });

  it('rejects the same host over plain http', () => {
    expect(verifyCsrf(mutation({ origin: 'http://review.digitalhammerr.com' })).ok).toBe(false);
  });

  it('rejects localhost in production', () => {
    expect(verifyCsrf(mutation({ origin: 'http://localhost:3000' })).ok).toBe(false);
  });
});
