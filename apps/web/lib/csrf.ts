import { env } from './env';

/**
 * CSRF defence for cookie-authenticated mutations (13_Security_Privacy_Compliance.md).
 *
 * Two layers, because each covers the other's gap.
 *
 * SameSite=Lax on the session cookie is the first: it stops the browser attaching the cookie to
 * a cross-site POST at all, which is the mechanism classic CSRF depends on. It is not
 * sufficient alone — Lax still permits top-level GET navigation, and a stale browser may not
 * enforce it — so it is not the only control.
 *
 * An Origin check is the second, and it is the one that actually runs here. Every browser sends
 * Origin on a cross-origin POST, and forging it requires code execution on the client, at which
 * point CSRF is not the attacker's problem. A double-submit token would add a third layer, but
 * it protects against the same forged-form attack these two already refuse, at the cost of
 * threading a token through every form.
 *
 * Public endpoints are deliberately exempt: they carry no session and no authority, so there is
 * nothing for a forged request to abuse beyond the rate limiter, which is keyed independently.
 */

export type CsrfResult = { ok: true } | { ok: false; reason: string };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function verifyCsrf(request: Request): CsrfResult {
  if (SAFE_METHODS.has(request.method)) return { ok: true };

  const origin = request.headers.get('origin');

  // A same-origin fetch from a modern browser always sends Origin on a mutation. Its absence
  // on a state-changing request is not a browser we should be trusting.
  if (!origin) {
    return { ok: false, reason: 'missing Origin header on a state-changing request' };
  }

  const expected = allowedOrigins();
  if (!expected.has(normalizeOrigin(origin))) {
    return { ok: false, reason: 'Origin does not match this application' };
  }

  return { ok: true };
}

/**
 * The origins a mutation may come from.
 *
 * Custom tenant domains (D-024) are NOT included: they serve the public renderer only, and no
 * authenticated mutation is ever issued from one. Widening this to accept them would mean any
 * hostname a tenant can point at us becomes a trusted origin for the dashboard.
 */
function allowedOrigins(): Set<string> {
  const origins = new Set<string>([normalizeOrigin(env().APP_BASE_URL)]);

  if (env().NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return origins;
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value.replace(/\/$/, '');
  }
}
