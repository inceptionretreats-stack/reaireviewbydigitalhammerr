import Link from 'next/link';
import type { CommercialTerms } from '@/lib/commercial-terms';
import localFont from 'next/font/local';
import { MarketingShell } from './MarketingSite';
import styles from './PricingPlanDetailsPage.module.css';

const priceFont = localFont({
  src: '../../assets/fonts/inter-latin-600-normal.woff',
  variable: '--font-pricing-detail-price',
  weight: '600',
  display: 'swap',
  preload: false,
  fallback: ['Arial', 'sans-serif'],
});

const FREE_DETAILS = (t: CommercialTerms) =>
  [
    {
      title: 'Allowance and expiry',
      text: `Free includes ${t.freeDraftsLabel} Ai drafts in total per business profile. There is no monthly or yearly reset, and no scheduled expiry for unused Free drafts.`,
    },
    {
      title: 'When drafts run out',
      text: `Further Ai drafting stops after the ${t.freeDraftsLabel}-draft allowance. Customers can still open Google and write their own review. Upgrade to Pro only if you need more Ai drafts.`,
    },
    {
      title: 'Payment and renewal',
      text: 'Free costs ₹0 and does not require a card. There is no paid renewal to cancel. Contact us if you want to close your account or request data deletion.',
    },
  ] as const;

const PRO_DETAILS = (t: CommercialTerms) =>
  [
    {
      title: 'Allowance and expiry',
      text: `The standard Pro price is ${t.priceLabel} for 12 calendar months and ${t.proDraftsLabel} Ai drafts for that paid period. Unused Pro drafts do not roll over into the next paid period. See your account for the exact dates.`,
    },
    {
      title: 'When drafts run out',
      text: 'Further Ai drafting stops at the allowance limit. Customers can still open Google and write their own review. When Pro expires, only any unused Free drafts remain; the Free allowance does not restart.',
    },
    {
      title: 'Payment and taxes',
      text: `${t.priceLabel} is the standard advertised annual price. Confirm the payable total in checkout before paying. The checkout does not add a separate tax surcharge; where applicable, tax is shown within the total on the invoice. Check your order and invoice for the seller’s tax details.`,
    },
    {
      title: 'Renewal and cancellation',
      text: 'Renewal requires another annual payment; there is no automatic recurring charge. To stop future renewal, do not purchase another period. Contact us for an account-closure, early-cancellation or refund request.',
    },
  ] as const;

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

const COMPARISON = (t: CommercialTerms) =>
  [
    { feature: 'Standard price', free: '₹0', pro: `${t.priceLabel} for 12 months` },
    {
      feature: 'Ai draft allowance',
      free: `${t.freeDraftsLabel} total`,
      pro: `${t.proDraftsLabel} per paid period`,
    },
    {
      feature: 'Unused draft expiry',
      free: 'No scheduled expiry',
      pro: 'At the end of the paid period',
    },
    { feature: 'Business profiles', free: 'One', pro: 'One' },
    { feature: 'Primary Google review destination', free: 'One', pro: 'One' },
    { feature: 'Branded QR and business page', free: 'Included', pro: 'Included' },
    { feature: 'Customer-editable Ai drafts', free: 'Included', pro: 'Included' },
    { feature: 'Private feedback and journey analytics', free: 'Included', pro: 'Included' },
    { feature: 'Regeneration', free: 'Uses one draft', pro: 'Uses one draft' },
    { feature: 'Renewal', free: 'Not applicable', pro: 'Another payment required' },
    { feature: 'Posting to Google', free: 'Customer’s choice', pro: 'Customer’s choice' },
  ] as const;

function PlanDetails({
  plan,
  price,
  period,
  allowance,
  billing,
  details,
}: {
  plan: 'Free' | 'Pro';
  price: string;
  period?: string;
  allowance: string;
  billing: string;
  details: ReadonlyArray<{ title: string; text: string }>;
}) {
  const id = plan.toLowerCase();

  return (
    <article id={id} className={styles.plan} aria-labelledby={`${id}-plan-title`}>
      <div className={styles.planHeader}>
        <h2 id={`${id}-plan-title`}>{plan} plan</h2>
        <p className={styles.price}>
          {price}
          {period ? <span>{period}</span> : null}
        </p>
        <p className={styles.allowance}>{allowance}</p>
        <p className={styles.billing}>{billing}</p>
      </div>
      <dl className={styles.planTerms}>
        {details.map(({ title, text }) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function PricingPlanDetailsPage({ terms }: { terms: CommercialTerms }) {
  return (
    <MarketingShell>
      <div className={`${styles.page} ${priceFont.variable}`}>
        <header className={styles.pageHeader}>
          <Link href="/#pricing" className={styles.backLink} aria-label="← Back to pricing">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M19 12H5m6 6-6-6 6-6" />
            </svg>
            <span>Back to pricing</span>
          </Link>
          <h1>Free and Pro plan details</h1>
          <p>Everything included, how drafts are counted, and what happens when you need more.</p>
        </header>

        <section className={styles.planGrid} aria-label="Free and Pro plan details">
          <PlanDetails
            plan="Free"
            price="₹0"
            allowance={`${terms.freeDraftsLabel} Ai drafts in total`}
            billing="No card needed to begin"
            details={FREE_DETAILS(terms)}
          />
          <PlanDetails
            plan="Pro"
            price={terms.priceLabel}
            period="/ year"
            allowance={`${terms.proDraftsLabel} Ai drafts for 12 months`}
            billing="Manual renewal; no automatic charge"
            details={PRO_DETAILS(terms)}
          />
        </section>

        <section className={styles.comparisonSection} aria-labelledby="comparison-title">
          <div className={styles.sectionHeading}>
            <h2 id="comparison-title">Compare the plans</h2>
          </div>
          <div
            className={styles.tableScroll}
            role="region"
            aria-label="Scrollable plan comparison"
            tabIndex={0}
          >
            <table aria-label="Free and Pro plan comparison" className={styles.comparisonTable}>
              <thead>
                <tr>
                  <th scope="col">Included</th>
                  <th scope="col">Free</th>
                  <th scope="col">Pro</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON(terms).map(({ feature, free, pro }) => (
                  <tr key={feature}>
                    <th scope="row">{feature}</th>
                    <td>{free}</td>
                    <td>{pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.customerChoice}>
            Your allowance counts Ai drafts, not published Google reviews. Posting is always the
            customer’s choice.
          </p>
        </section>

        <section className={styles.sharedSection} aria-labelledby="shared-title">
          <div className={styles.sharedHeading}>
            <h2 id="shared-title">Good to know, whichever plan you choose.</h2>
            <p>These rules apply to both Free and Pro.</p>
          </div>
          <dl className={styles.sharedTerms}>
            {SHARED_DETAILS.map(({ title, text }) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <nav className={styles.helpLinks} aria-label="Pricing help">
          <Link href="/legal/cancellation-refunds">Cancellation and refunds</Link>
          <Link href="/legal/contact">Ask a billing question</Link>
        </nav>
      </div>
    </MarketingShell>
  );
}
