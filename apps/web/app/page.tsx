import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { loadLandingDemo } from '@/lib/landing-demo';
import { loadCommercialTerms } from '@/lib/commercial-terms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ai Review by Digital Hammerr',
  description:
    'Turn a QR scan into a review your customer edits, confirms and posts themselves on Google.',
};

export default async function HomePage() {
  // Price and allowances come from platform_settings, so an admin price change reaches the
  // hero and the plan cards without a deploy.
  const [demo, terms] = await Promise.all([loadLandingDemo(), loadCommercialTerms()]);
  return <LandingPage demo={demo} terms={terms} />;
}
