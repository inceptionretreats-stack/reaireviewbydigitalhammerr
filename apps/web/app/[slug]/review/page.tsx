import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { loadPublicServices, resolveBySlug } from '@/lib/public-business';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import { loadLatestDraft } from '@/lib/generation-service';
import { ReviewFlow } from '@/components/ReviewFlow';
import styles from '@/components/CustomerReview.module.css';

/**
 * GET /{slug}/review — the same customer experience as the QR route, reached by link.
 *
 * REV-01 lists both entry points. They share one component so the confirmation gate and the
 * absence of any star rating cannot diverge between them.
 */
export default async function SlugReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolution = await resolveBySlug(db(), slug);

  if (!resolution.ok) notFound();

  // Flow I: a retired slug keeps working as a redirect for its retention window.
  if ('redirectTo' in resolution) redirect(`${resolution.redirectTo}/review`);
  if (!('config' in resolution)) notFound();

  const { config } = resolution;
  const database = db();
  const session = await resolveAnonymousSession(
    new Request('https://internal', { headers: await headers() }),
    config.businessId,
  );
  const [services, existingDraft] = await Promise.all([
    loadPublicServices(database, config.businessId),
    session ? loadLatestDraft(database, session.sessionId) : Promise.resolve(null),
  ]);

  return (
    <main className={styles.page}>
      <ReviewFlow
        business={{
          slug: config.slug ?? slug,
          name: config.name,
          logoUrl: config.logoUrl,
          reviewUrl: config.reviewUrl,
          reviewPlatformLabel: config.reviewPlatformLabel,
          services,
        }}
        initialDraft={existingDraft}
      />
    </main>
  );
}
