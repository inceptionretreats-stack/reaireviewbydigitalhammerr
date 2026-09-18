import Link from 'next/link';
import styles from './PricingDetails.module.css';

const SHARED_DETAILS = [
  {
    title: 'One business profile',
    text: 'Each plan and draft allowance belongs to one business profile with one primary Google review destination. A multi-location bundle is not included.',
  },
  {
    title: 'What counts as a draft?',
    text: 'Each successful customer generation or regeneration uses one draft. Editing, copying and opening Google do not use another draft. Regeneration has no separate per-use monetary charge.',
  },
  {
    title: 'Retries and previews',
    text: 'Internal generation retries count as part of the same request. Provider failures and rejected outputs release their allowance reservation; merchant test previews do not use customer drafts. Contact us if a failed request leaves an incorrect usage count.',
  },
] as const;

const FREE_DETAILS = [
  {
    title: 'Free allowance',
    text: '10 Ai drafts in total per business profile. There is no monthly or yearly reset, and no scheduled expiry for unused Free drafts.',
  },
  ...SHARED_DETAILS,
  {
    title: 'When drafts run out',
    text: 'Further Ai drafting stops after the 10-draft allowance. Customers can still open Google and write their own review. Upgrade to Pro only if you need more Ai drafts.',
  },
  {
    title: 'No payment or renewal',
    text: 'Free costs ₹0 and does not require a card. There is no paid renewal to cancel. Contact us if you want to close your account or request data deletion.',
  },
] as const;

const PRO_DETAILS = [
  {
    title: 'Pro allowance and expiry',
    text: '₹999 covers 12 calendar months and 2,000 Ai drafts for that paid period. Unused Pro drafts do not roll over into the next paid period. See your account for the exact dates.',
  },
  ...SHARED_DETAILS,
  {
    title: 'When drafts run out',
    text: 'Further Ai drafting stops at the allowance limit. Customers can still open Google and write their own review. When Pro expires, only any unused Free drafts remain; the Free allowance does not restart.',
  },
  {
    title: 'Payment and taxes',
    text: '₹999 is the standard advertised annual price. Confirm the payable total in checkout before paying. The checkout does not add a separate tax surcharge; where applicable, tax is shown within the total on the invoice. Check your order and invoice for the seller’s tax details.',
  },
  {
    title: 'Renewal and cancellation',
    text: 'Renewal requires another annual payment; there is no automatic recurring charge. To stop future renewal, do not purchase another period. Contact us for an account-closure, early-cancellation or refund request.',
  },
] as const;

export function PricingDetails({ plan }: { plan: 'Free' | 'Pro' }) {
  const details = plan === 'Free' ? FREE_DETAILS : PRO_DETAILS;

  return (
    <section className={styles.content} aria-label={`${plan} pricing details`}>
      <p className={styles.intro}>
        Your allowance counts Ai drafts, not published Google reviews. Posting is always the
        customer’s choice.
      </p>
      <dl className={styles.grid}>
        {details.map((detail) => (
          <div key={detail.title}>
            <dt>{detail.title}</dt>
            <dd>{detail.text}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.links}>
        {plan === 'Pro' ? (
          <Link href="/legal/cancellation-refunds">Cancellation and refunds</Link>
        ) : null}
        <Link href="/legal/contact">
          {plan === 'Pro' ? 'Ask a billing question' : 'Contact us'}
        </Link>
      </div>
    </section>
  );
}

export function PricingDetailsLink({ plan }: { plan: 'Free' | 'Pro' }) {
  return (
    <div className={styles.cardMore}>
      <Link href={`/legal/pricing/${plan.toLowerCase()}`} className={styles.cardLink}>
        <span>
          Show more<span className={styles.srOnly}> about the {plan} plan</span>
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      </Link>
    </div>
  );
}
