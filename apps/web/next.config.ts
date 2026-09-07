import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * One .env for the whole repository.
 *
 * Next only reads env files from its own project directory, so this app used to carry a copy of
 * the root .env. Two files holding the same secrets drift, and they did: a key cleared at the root
 * stayed live here, so the dev server called a real provider with a placeholder credential and
 * every generation timed out looking like an outage.
 *
 * Loaded before the config object so the values are in process.env by the time anything reads
 * them. Like `node --env-file`, this leaves already-set variables alone, so a real deployment's
 * environment still wins and a missing file is not an error.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No root .env — a deployment that supplies configuration through the real environment.
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Domain logic lives in workspace packages and is compiled by Next rather than pre-built,
  // so the web app and the worker share exactly one implementation (ADR-AMEND-A).
  transpilePackages: [
    '@ai-review/core',
    '@ai-review/db',
    '@ai-review/config',
    '@ai-review/contracts',
    '@ai-review/analytics',
    '@ai-review/ui',
  ],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default config;
