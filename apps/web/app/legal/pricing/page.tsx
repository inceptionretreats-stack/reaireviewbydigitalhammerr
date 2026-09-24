import type { Metadata } from 'next';
import { PricingPlanDetailsPage } from '@/components/marketing/PricingPlanDetailsPage';
import { loadCommercialTerms } from '@/lib/commercial-terms';

export const metadata: Metadata = {
  title: 'Free and Pro plan details | Ai Review by Digital Hammerr',
  description:
    'Compare Free and Pro Ai Review plans, draft allowances, billing, regeneration, expiry and customer controls in one place.',
};

export const runtime = 'nodejs';
// The advertised price and allowances come from platform_settings, so this page follows an
// admin's change rather than a deploy.
export const dynamic = 'force-dynamic';

export default async function Page() {
  return <PricingPlanDetailsPage terms={await loadCommercialTerms()} />;
}
