import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { analyticsEvents } from '@ai-review/db';
import { db } from '@/lib/db';
import { resolveBySlug } from '@/lib/public-business';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import { FeedbackForm } from '@/components/FeedbackForm';
import styles from '@/components/PrivateFeedback.module.css';

/**
 * GET /{slug}/feedback — FB-01, private feedback.
 *
 * Reachable directly, from the review flow and from the public profile, by every visitor
 * (FB-01-01, AC-024). Nothing on the way in asks how the visit went, because no sentiment or
 * star rating is ever collected (D-009, AC-006) — so there is no path by which an unhappy
 * customer could be steered here and away from Google, which is what
 * 13_Security_Privacy_Compliance.md rules 3 and 6 exist to prevent.
 */

/**
 * Dynamic for the same reason as the profile page: a suspended tenant must stop serving
 * immediately, and the business name shown here is read live rather than from a build.
 */
export const dynamic = 'force-dynamic';

export default async function PrivateFeedbackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolution = await resolveBySlug(db(), slug);

  if (!resolution.ok) {
    // Flow J: a suspended or unpublished tenant gets a controlled page, not a 404.
    if (resolution.reason === 'BUSINESS_NOT_ACTIVE') return <UnavailablePage />;
    notFound();
  }

  // Flow I: a retired slug keeps working for its retention window, on this route too.
  if ('redirectTo' in resolution) redirect(`${resolution.redirectTo}/feedback`);
  if (!('config' in resolution)) notFound();

  const { config } = resolution;
  await recordFeedbackOpen(config.businessId);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <h1>Private feedback for {config.name}</h1>
          <p>This goes straight to {config.name} and is not posted anywhere publicly.</p>
        </header>
        {/* The route param, not config.slug: this page was reached BY that slug, so it is the
          authoritative value and cannot be null the way a QR-resolved tenant's can. */}
        <FeedbackForm slug={slug} businessName={config.name} />
      </div>
    </main>
  );
}

function UnavailablePage() {
  return (
    <main className={styles.page}>
      <div className={`${styles.card} ${styles.unavailable}`}>
        <p>This feedback page is not available at the moment.</p>
        <p>Please ask the business for an up-to-date link.</p>
      </div>
    </main>
  );
}

/**
 * private_feedback_open, emitted on render rather than on the link that led here.
 *
 * The taxonomy's trigger is "Private feedback form opened", and only this page knows that
 * happened: a customer can arrive from the review flow, from the profile page, from a shared
 * link or by pressing Back. Emitting on render is the only placement under which
 * private_feedback_submit cannot exceed private_feedback_open in the funnel.
 *
 * AC-035: never lets an analytics failure affect the page. Skipped without an anonymous
 * session, since anonymous_session_id is a required property of this event.
 */
async function recordFeedbackOpen(businessId: string): Promise<void> {
  try {
    const headerList = await headers();
    const session = await resolveAnonymousSession(
      new Request('https://internal', { headers: headerList }),
      businessId,
    );
    if (!session) return;

    await db()
      .insert(analyticsEvents)
      .values({
        businessId,
        anonymousSessionId: session.sessionId,
        eventName: 'private_feedback_open',
        properties: { business_id: businessId, anonymous_session_id: session.sessionId },
      });
  } catch (error) {
    console.warn('[analytics] private_feedback_open failed', error);
  }
}
