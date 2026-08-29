import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { analyticsEvents } from '@ai-review/db';
import { normalizeQrCode } from '@ai-review/core';
import { db } from '@/lib/db';
import { resolveByQrCode } from '@/lib/public-business';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import { ReviewFlow } from '@/components/ReviewFlow';

/**
 * GET /r/{qrCode} — the dynamic QR landing (ADR-002, D-007, Flow C).
 *
 * The scanned code is opaque and permanent, but everything it resolves to is read fresh here,
 * which is what lets a business change its Google URL, slug, review mode or custom domain
 * without reprinting a single standee (D-026, AC-017).
 *
 * It lands directly on the review experience — no interstitial, no questionnaire (D-007).
 */
export default async function QrLandingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const database = db();
  const resolution = await resolveByQrCode(database, normalizeQrCode(code));

  if (!resolution.ok) {
    // QR-01-02: a disabled standee gets a controlled, business-safe page rather than a 404 —
    // someone is standing in front of it right now.
    if (resolution.reason === 'QR_DISABLED' || resolution.reason === 'BUSINESS_NOT_ACTIVE') {
      return <UnavailablePage />;
    }
    notFound();
  }

  if (!('config' in resolution)) notFound();
  const { config } = resolution;

  // Reads the token minted by middleware; never writes a cookie, which an RSC cannot do.
  // A visitor without the cookie still gets the page — only the analytics tie is lost (AC-035).
  const headerList = await headers();
  const session = await resolveAnonymousSession(
    new Request('https://internal', { headers: headerList }),
    config.businessId,
  );

  if (session) {
    await recordScan(database, config, session.sessionId);
  }

  return (
    <main className="shell">
      <ReviewFlow
        business={{
          slug: config.slug,
          name: config.name,
          logoUrl: config.logoUrl,
          reviewUrl: config.reviewUrl,
          reviewPlatformLabel: config.reviewPlatformLabel,
        }}
        qrCode={normalizeQrCode(code)}
      />
    </main>
  );
}

function UnavailablePage() {
  return (
    <main className="shell">
      <div className="notice">
        <p>This review page is not available at the moment.</p>
        <p className="muted">Please ask the business for an up-to-date link.</p>
      </div>
    </main>
  );
}

async function recordScan(
  database: ReturnType<typeof db>,
  config: { businessId: string; qrCodeId: string | null; qrSourceLabel: string | null },
  sessionId: string,
): Promise<void> {
  try {
    await database.insert(analyticsEvents).values([
      {
        businessId: config.businessId,
        anonymousSessionId: sessionId,
        qrCodeId: config.qrCodeId,
        eventName: 'qr_scan',
        properties: {
          business_id: config.businessId,
          anonymous_session_id: sessionId,
          qr_code_id: config.qrCodeId,
          source_label: config.qrSourceLabel,
        },
      },
      {
        businessId: config.businessId,
        anonymousSessionId: sessionId,
        qrCodeId: config.qrCodeId,
        eventName: 'review_page_view',
        properties: {
          business_id: config.businessId,
          anonymous_session_id: sessionId,
          qr_code_id: config.qrCodeId,
        },
      },
    ]);
  } catch {
    // AC-035: a scan must render even if the analytics pipeline is degraded.
  }
}
