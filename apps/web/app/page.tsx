import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { loadLandingDemo } from '@/lib/landing-demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ai Review by Digital Hammerr',
  description:
    'Turn a QR scan into a review your customer edits, confirms and posts themselves on Google.',
};

export default async function HomePage() {
  const demo = await loadLandingDemo();
  return <LandingPage demo={demo} />;
}
