import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp } from '../rate-limit';

afterEach(() => vi.unstubAllEnvs());

describe('clientIp trusted ingress', () => {
  it('ignores caller-supplied Cloudflare headers on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      clientIp(
        new Request('https://example.com', {
          headers: {
            'cf-connecting-ip': '1.2.3.4',
            'x-vercel-forwarded-for': '203.0.113.5',
            'x-forwarded-for': '192.0.2.7',
          },
        }),
      ),
    ).toBe('203.0.113.5');
  });

  it('uses Vercel-overwritten x-forwarded-for when the platform variant is absent', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      clientIp(
        new Request('https://example.com', {
          headers: {
            'x-forwarded-for': '2001:db8::1',
          },
        }),
      ),
    ).toBe('2001:db8::1');
  });

  it.each(['', 'not-an-ip', '1.2.3.4, 5.6.7.8'])(
    'rejects invalid platform addresses: %s',
    (value) => {
      vi.stubEnv('VERCEL', '1');
      expect(
        clientIp(
          new Request('https://example.com', {
            headers: {
              'x-vercel-forwarded-for': value,
              'cf-connecting-ip': '1.2.3.4',
            },
          }),
        ),
      ).toBe('');
    },
  );

  it('does not trust arbitrary proxy headers on an unconfigured production host', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(
      clientIp(
        new Request('https://example.com', {
          headers: {
            'cf-connecting-ip': '1.2.3.4',
            'x-forwarded-for': '1.2.3.4',
          },
        }),
      ),
    ).toBe('');
  });

  it('supports the existing local Cloudflare tunnel and development proxy', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(
      clientIp(
        new Request('http://localhost', {
          headers: {
            'cf-connecting-ip': '203.0.113.5',
          },
        }),
      ),
    ).toBe('203.0.113.5');
    expect(
      clientIp(
        new Request('http://localhost', {
          headers: {
            'x-forwarded-for': '127.0.0.1, 192.0.2.7',
          },
        }),
      ),
    ).toBe('127.0.0.1');
  });
});
