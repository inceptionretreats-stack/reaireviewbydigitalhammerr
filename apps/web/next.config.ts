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

/**
 * The host the app is actually reached on.
 *
 * Next's dev server blocks its own internal endpoints (`/_next/*`, `/__nextjs*`) when the
 * request carries an Origin it does not recognise, and its allowlist is localhost plus whatever
 * is listed here. Over a tunnel that means a working page but a dead HMR socket and dev overlay.
 * Derived from APP_BASE_URL rather than hard-coded so it follows `pnpm tunnel` automatically.
 */
function devOrigins(): string[] {
  const base = process.env['APP_BASE_URL'];
  if (!base) return [];
  try {
    // Next expects bare hostnames here. Including the port makes tunneled/LAN dev origins miss the
    // allowlist even though APP_BASE_URL is otherwise correct.
    return [new URL(base).hostname];
  } catch {
    return [];
  }
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(),

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
