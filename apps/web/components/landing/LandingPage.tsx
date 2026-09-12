import type { LandingDemo } from '@/lib/landing-demo';
import { HomeMarketingPage } from '@/components/marketing/HomeMarketingPage';

export type { LandingDemo } from '@/lib/landing-demo';

export function LandingPage({ demo }: { demo: LandingDemo | null }) {
  return <HomeMarketingPage demo={demo} />;
}
