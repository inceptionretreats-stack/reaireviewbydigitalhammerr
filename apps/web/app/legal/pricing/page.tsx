import type { Metadata } from 'next';
import { PricingPlanDetailsPage } from '@/components/marketing/PricingPlanDetailsPage';

export const metadata: Metadata = {
  title: 'Free and Pro plan details | Ai Review by Digital Hammerr',
  description:
    'Compare Free and Pro Ai Review plans, draft allowances, billing, regeneration, expiry and customer controls in one place.',
};

export default function Page() {
  return <PricingPlanDetailsPage />;
}
