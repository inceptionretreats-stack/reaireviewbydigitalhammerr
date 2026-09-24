import type { LandingDemo } from '@/lib/landing-demo';
import type { CommercialTerms } from '@/lib/commercial-terms';
import { HomeMarketingPage } from '@/components/marketing/HomeMarketingPage';

export type { LandingDemo } from '@/lib/landing-demo';

export function LandingPage({ demo, terms }: { demo: LandingDemo | null; terms: CommercialTerms }) {
  return <HomeMarketingPage demo={demo} terms={terms} />;
}
