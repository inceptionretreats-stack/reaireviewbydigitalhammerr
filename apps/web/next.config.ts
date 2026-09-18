import { networkInterfaces } from 'node:os';
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
 * Include the exact local addresses as well as APP_BASE_URL so loopback and LAN previews can
 * hydrate when `next dev` binds to 0.0.0.0. No wildcard origins or QR base-URL changes are needed.
 */
function devOrigins(): string[] {
  const origins = new Set(['localhost', '127.0.0.1']);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) origins.add(address.address);
    }
  }
  const base = process.env['APP_BASE_URL'];
  if (!base) return [...origins];
  try {
    // Next expects bare hostnames here. Including the port makes tunneled/LAN dev origins miss the
    // allowlist even though APP_BASE_URL is otherwise correct.
    origins.add(new URL(base).hostname);
    return [...origins];
  } catch {
    return [...origins];
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
    '@ai-review/worker',
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
