import { NextResponse, type NextRequest } from 'next/server';
import { migrationMaintenanceResponse } from './lib/migration-maintenance';

/**
 * Mints the anonymous visitor token.
 *
 * This lives here because a React Server Component cannot write cookies — Next permits that
 * only from proxy/middleware, a Route Handler or a Server Action. The QR landing page is an
 * RSC, so minting there threw at runtime and took out the product's primary entry point.
 *
 * Uses Web Crypto. Next.js 16 Proxy runs in the Node.js runtime. Nothing here touches the
 * database; the session row is created lazily by
 * whichever request first needs it (see lib/anonymous-session.ts).
 *
 * Named proxy.ts per the Next.js 16 convention that replaces middleware.ts.
 */

const COOKIE_NAME = 'dh_anon';
const TTL_DAYS = 30;
const TOKEN_BYTES = 32;
const AUTH_ALIAS_HOST = 'ai-review-dh.vercel.app';
const AUTH_CANONICAL_ORIGIN = 'https://aireview.digitalhammerr.com';
const AUTH_PAGES = new Set(['/login', '/signup', '/signup/google']);

function mintToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // base64url — safe in a cookie value without escaping.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default function proxy(request: NextRequest): NextResponse {
  const maintenance = migrationMaintenanceResponse(request);
  if (maintenance) return maintenance;

  // Google Identity Services permits the canonical production origin, not the legacy Vercel
  // alias. Move only vendor auth page visits there; customer QR links keep their own origin.
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    request.nextUrl.hostname === AUTH_ALIAS_HOST &&
    AUTH_PAGES.has(request.nextUrl.pathname)
  ) {
    return NextResponse.redirect(
      new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, AUTH_CANONICAL_ORIGIN),
      307,
    );
  }

  // Preserve the old matcher's anonymous-cookie scope now that the migration gate needs to
  // intercept every route. APIs, authenticated subroutes, and Next assets still pass unchanged
  // when maintenance is off. This also avoids setting cookies on exempt static reads.
  if (
    /^\/(?:_next\/(?:static|image)|favicon\.ico|api\/|app\/|admin\/)/.test(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }
  if (request.cookies.get(COOKIE_NAME)) return NextResponse.next();

  const token = mintToken();
  const requestHeaders = new Headers(request.headers);
  const existingCookies = requestHeaders.get('cookie');
  requestHeaders.set(
    'cookie',
    `${existingCookies ? `${existingCookies}; ` : ''}${COOKIE_NAME}=${token}`,
  );

  // Set-Cookie only reaches the browser with the response. Forward the same token to the RSC
  // request as well so the very first QR page load can create the anonymous session and record
  // its scan instead of silently losing that event.
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TTL_DAYS * 24 * 60 * 60,
    path: '/',
  });

  return response;
}

export const config = {
  // Keep this literal and comprehensive: API/cron/webhook requests, page GETs (which can
  // write analytics), prefetch/RSC requests, and POST Server Actions all need the gate.
  matcher: ['/:path*'],
};
