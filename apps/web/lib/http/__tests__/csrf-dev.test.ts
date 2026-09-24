import { describe, expect, it, vi } from 'vitest';

vi.mock('../../infra/env', () => ({
  env: () => ({
    NODE_ENV: 'development',
    APP_BASE_URL: 'http://localhost:3000',
    CSRF_TRUSTED_ORIGINS: [],
  }),
}));

import { verifyCsrf } from '../csrf';

describe('development preview CSRF origins', () => {
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3100',
    'http://127.0.0.1:3100',
  ])('allows local preview forms at %s', (origin) => {
    const request = new Request(`${origin}/api/v1/auth/google`, {
      method: 'POST',
      headers: { origin },
    });
    expect(verifyCsrf(request).ok).toBe(true);
  });

  it('does not trust a different local port or external host', () => {
    for (const origin of ['http://localhost:3200', 'https://evil.example']) {
      const request = new Request('http://localhost:3100/api/v1/auth/google', {
        method: 'POST',
        headers: { origin },
      });
      expect(verifyCsrf(request).ok).toBe(false);
    }
  });
});
