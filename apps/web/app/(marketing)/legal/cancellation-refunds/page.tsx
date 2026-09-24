import type { Metadata } from 'next';
import Link from 'next/link';
import {
  PublicContactLink,
  PublicInformationPage,
} from '@/components/marketing/legal/PublicInformationPage';

export const metadata: Metadata = {
  title: 'Cancellation and refunds | Ai Review by Digital Hammerr',
  description: 'Manual annual renewal, plan expiry and how to ask about cancellation or a refund.',
};

export default function CancellationRefundsPage() {
  return (
    <PublicInformationPage
      title="Cancellation and refunds"
      intro="Understand how annual billing ends and how to raise a billing request. No login is needed to read this page or contact us."
      path="/legal/cancellation-refunds"
    >
      <section>
        <h2>No automatic annual charge</h2>
        <p>
          The standard Pro plan is a one-time payment of ₹999 for a 12-calendar-month period. A
          further payment is needed to renew. The current checkout does not automatically charge you
          for another year.
        </p>
        <p>
          If you do not want another paid period, do not renew. This is different from requesting
          early closure or a refund for a payment already made.
        </p>
      </section>
      <section>
        <h2>When a paid period ends</h2>
        <p>
          Unused Pro drafts do not roll over. After expiry, the business can use only any remaining
          Free drafts from its original allowance. The Free allowance does not reset. Customers can
          still open Google and write their own review when Ai drafting is unavailable.
        </p>
        <p>
          Expiry is not the same as deleting your account or its stored data. For closure or
          deletion, use the <Link href="/legal/contact">contact page</Link>.
        </p>
      </section>
      <section>
        <h2>Early cancellation or a refund request</h2>
        <p>
          Contact <PublicContactLink /> with your account email, business name, payment reference,
          payment date and the reason for your request. Do not include passwords, one-time codes or
          full card details.
        </p>
        <p>
          There is no self-service refund or early-cancellation button in the current merchant
          dashboard. Sending an email does not itself cancel the plan or confirm that a refund has
          been approved.
        </p>
      </section>
      <section>
        <h2>Confirm eligibility before purchase</h2>
        <p>
          A plan-specific refund window, eligibility rule and processing deadline have not yet been
          confirmed for this page. Please obtain written clarification from Digital Hammerr before
          purchasing if these terms affect your decision. We do not promise automatic refunds or
          claim that every payment is non-refundable.
        </p>
        <p>
          This information does not limit any rights that apply under law. An approved refund may
          also affect the associated paid access; ask for the effect on your plan when your request
          is reviewed.
        </p>
      </section>
      <section>
        <h2>Payment problems</h2>
        <p>
          If you believe you were charged twice or paid without receiving access, send the payment
          references to <PublicContactLink />. A bank debit or pending payment alone should not be
          treated as confirmation that Pro is active.
        </p>
        <p>
          Read the <Link href="/#pricing">full plan details</Link> or{' '}
          <Link href="/legal/terms">Terms of service</Link>.
        </p>
      </section>
    </PublicInformationPage>
  );
}
