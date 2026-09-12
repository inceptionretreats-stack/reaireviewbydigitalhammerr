import { NextResponse, type NextRequest } from 'next/server';

/**
 * Mints the anonymous visitor token.
 *
 * This lives here because a React Server Component cannot write cookies — Next permits that
 * only from proxy/middleware, a Route Handler or a Server Action. The QR landing page is an
 * RSC, so minting there threw at runtime and took out the product's primary entry point.
 *
 * Uses Web Crypto, not node:crypto: this runs in the Edge runtime, where Node built-ins are
 * unavailable. Nothing here touches the database; the session row is created lazily by
 * whichever request first needs it (see lib/anonymous-session.ts).
 *
 * Named proxy.ts per the Next.js 16 convention that replaces middleware.ts.
 */

const COOKIE_NAME = 'dh_anon';
const TTL_DAYS = 30;
const TOKEN_BYTES = 32;

function mintToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // base64url — safe in a cookie value without escaping.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default function proxy(request: NextRequest): NextResponse {
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
  // Public surfaces only. The dashboard and admin carry their own authenticated session and
  // gain nothing from an anonymous token.
  matcher: ['/r/:path*', '/((?!_next/static|_next/image|favicon.ico|api/|app/|admin/).*)'],
};
