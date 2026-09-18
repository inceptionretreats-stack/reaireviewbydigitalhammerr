import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingDetails } from '@/components/marketing/PricingDetails';
import { PublicInformationPage } from '@/components/marketing/PublicInformationPage';

export const metadata: Metadata = {
  title: 'Pro plan details | Ai Review by Digital Hammerr',
  description:
    'Annual pricing, draft allowance, regeneration, expiry, taxes and renewal explained.',
};

export default function ProPlanDetailsPage() {
  return (
    <PublicInformationPage
      title="Pro plan details"
      intro="The standard Pro plan is ₹999 for 12 calendar months. Read the allowance, billing and renewal details before purchasing."
      path="/legal/pricing/pro"
    >
      <p>
        <Link href="/#pricing">← Back to pricing</Link>
      </p>
      <PricingDetails plan="Pro" />
      <p>
        <Link href="/legal/pricing/free">Compare with the Free plan →</Link>
      </p>
    </PublicInformationPage>
  );
}
