import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingDetails } from '@/components/marketing/PricingDetails';
import { PublicInformationPage } from '@/components/marketing/PublicInformationPage';

export const metadata: Metadata = {
  title: 'Free plan details | Ai Review by Digital Hammerr',
  description: 'Free draft allowance, business scope, regeneration and account information.',
};

export default function FreePlanDetailsPage() {
  return (
    <PublicInformationPage
      title="Free plan details"
      intro="₹0 to get started. See what is included, how drafts are counted and what happens when your allowance runs out."
      path="/legal/pricing/free"
    >
      <p>
        <Link href="/#pricing">← Back to pricing</Link>
      </p>
      <PricingDetails plan="Free" />
      <p>
        <Link href="/legal/pricing/pro">Compare with the Pro plan →</Link>
      </p>
    </PublicInformationPage>
  );
}
