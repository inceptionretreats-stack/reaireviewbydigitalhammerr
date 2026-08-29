import type { NextConfig } from 'next';

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
