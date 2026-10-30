/**
 * The owner mobile app (apps/mobile) as an API client.
 *
 * A native app sends no Origin header and cannot hold an HttpOnly cookie the way a browser does,
 * so it can neither pass verifyCsrf's Origin check nor use the session cookie. Instead it:
 *
 * - marks every request with `X-Client: ai-review-mobile`, and
 * - once signed in, sends the same opaque session token the cookie would carry, as
 *   `Authorization: Bearer <token>`.
 *
 * Both are non-simple request headers. A cross-site page cannot attach either without a CORS
 * preflight, and this application grants no CORS, so they give the same guarantee the Origin
 * check gives for browsers. The token is a row in the same sessions table as a browser session:
 * revocation, "sign out other devices" and the password-change sweep reach the app unchanged.
 */

export const MOBILE_CLIENT_HEADER = 'x-client';
export const MOBILE_CLIENT_ID = 'ai-review-mobile';

export function isMobileClient(headers: Headers): boolean {
  return headers.get(MOBILE_CLIENT_HEADER) === MOBILE_CLIENT_ID;
}

/** The bearer token on the request, or null when it carries none. */
export function bearerToken(headers: Headers): string | null {
  const value = headers.get('authorization');
  if (!value) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

/** What the app receives in place of Set-Cookie. */
export function mobileSessionBody(session: { token: string; expiresAt: Date }): {
  token: string;
  expires_at: string;
} {
  return { token: session.token, expires_at: session.expiresAt.toISOString() };
}
