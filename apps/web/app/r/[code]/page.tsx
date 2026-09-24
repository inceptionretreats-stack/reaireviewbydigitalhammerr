import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { analyticsEvents } from '@ai-review/db';
import { normalizeQrCode } from '@ai-review/core';
import { db } from '@/lib/db';
import { loadPublicServices, resolveByQrCode } from '@/lib/public-business';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import { loadLatestDraft } from '@/lib/generation-service';
import { ReviewFlow } from '@/components/ReviewFlow';
import styles from '@/components/CustomerReview.module.css';

/**
 * GET /r/{qrCode} — the dynamic QR landing (ADR-002, D-007, Flow C).
 *
 * The scanned code is opaque and permanent, but everything it resolves to is read fresh here,
 * which is what lets a business change its Google URL, slug, review mode or custom domain
 * without reprinting a single standee (D-026, AC-017).
 *
 * It lands on the customer review experience, starting with services they actually used.
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

  // Refreshes reuse the existing draft; a first visit chooses services before spending quota.
  const [existingDraft, services] = await Promise.all([
    session ? loadLatestDraft(database, session.sessionId) : Promise.resolve(null),
    loadPublicServices(database, config.businessId),
  ]);

  return (
    <main className={styles.page}>
      <ReviewFlow
        business={{
          slug: config.slug,
          name: config.name,
          logoUrl: config.logoUrl,
          reviewUrl: config.reviewUrl,
          reviewPlatformLabel: config.reviewPlatformLabel,
          services,
        }}
        qrCode={normalizeQrCode(code)}
        initialDraft={existingDraft}
      />
    </main>
  );
}

function UnavailablePage() {
  return (
    <main className={styles.page}>
      <div className={`${styles.card} ${styles.unavailable}`}>
        <p>This review page is not available at the moment.</p>
        <p className={styles.helper}>Please ask the business for an up-to-date link.</p>
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
