import type { Metadata } from 'next';
import { HomeMarketingPage } from '@/components/marketing/home/HomeMarketingPage';
import { loadLandingDemo } from '@/lib/marketing/landing-demo';
import { loadCommercialTerms } from '@/lib/marketing/commercial-terms';

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
  return <HomeMarketingPage demo={demo} terms={terms} />;
}
