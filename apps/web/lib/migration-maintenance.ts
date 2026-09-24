import { NextResponse, type NextRequest } from 'next/server';

const RETRY_AFTER_SECONDS = 120;
const MESSAGE =
  'Ai Review is temporarily unavailable for a scheduled update. Please try again shortly.';

// Standalone HTML deliberately does not render a layout, fetch assets, or access the database.
// No request values or deployment configuration are interpolated into either response format.
const MAINTENANCE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>We'll be back shortly | Ai Review</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px;
      background: #f5f7fb; color: #14233b; font: 18px/1.6 system-ui, sans-serif; }
    main { width: 100%; max-width: 580px; padding: clamp(24px, 6vw, 48px); background: #fff;
      border: 1px solid #dce2ea; border-radius: 20px; border-top: 4px solid #1967d2; }
    .brand { margin: 0 0 24px; color: #1967d2; font-weight: 700; }
    h1 { margin: 0 0 16px; font-size: clamp(28px, 6vw, 40px); line-height: 1.15; }
    p { margin: 0 0 16px; }
    .note { margin: 0; color: #536174; font-size: 16px; }
  </style>
</head>
<body>
  <main>
    <p class="brand">Ai Review by Digital Hammerr</p>
    <h1>We'll be back shortly.</h1>
    <p>We're making a scheduled update. Please try again in a few minutes.</p>
    <p class="note">Account access and review tools are temporarily paused.</p>
  </main>
</body>
</html>`;

/**
 * Operational migration gate, off unless this server's environment is exactly "1".
 * Read per request, before cookie minting or any application handler. No caller-controlled
 * header/cookie/query bypass. Deploy this flag on every reachable production deployment;
 * it does not stop already-running requests or independently scheduled worker processes.
 */
export function migrationMaintenanceResponse(request: NextRequest): NextResponse | null {
  if (process.env['MIGRATION_MAINTENANCE'] !== '1') return null;

  const readMethod = request.method === 'GET' || request.method === 'HEAD';
  const serverAction = request.headers.has('next-action');
  // Only generated immutable assets are exempt, and only for reads. Do not allow all file
  // extensions or /_next/*: application/data routes and Server Actions must remain blocked.
  if (readMethod && !serverAction && request.nextUrl.pathname.startsWith('/_next/static/')) {
    return null;
  }

  const apiPath =
    request.nextUrl.pathname === '/api' || request.nextUrl.pathname.startsWith('/api/');
  const json =
    apiPath ||
    !readMethod ||
    serverAction ||
    request.headers.get('accept')?.includes('application/json') === true;
  const headers = {
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
    Pragma: 'no-cache',
    Expires: '0',
    'Retry-After': String(RETRY_AFTER_SECONDS),
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
  const body = json
    ? JSON.stringify({
        error: { code: 'MAINTENANCE', message: MESSAGE },
        retry_after_seconds: RETRY_AFTER_SECONDS,
      })
    : MAINTENANCE_HTML;

  return new NextResponse(request.method === 'HEAD' ? null : body, { status: 503, headers });
}
