import localFont from 'next/font/local';
import type { CommercialTerms } from '@/lib/marketing/commercial-terms';
import { ActionLink, MarketingIcon, marketingStyles as styles } from '../site/MarketingSite';
import { PricingDetailsLink } from './PricingDetailsLink';

const priceFont = localFont({
  src: '../../../assets/fonts/inter-latin-600-normal.woff',
  variable: '--font-plan-price',
  weight: '600',
  display: 'swap',
  preload: false,
  fallback: ['Arial', 'sans-serif'],
});

const FREE_FEATURES = (t: CommercialTerms) => [
  `${t.freeDraftsLabel} Ai drafts per business`,
  'Branded QR and business page',
  'Private feedback and analytics',
];

const PRO_FEATURES = (t: CommercialTerms) => [
  `${t.proDraftsLabel} Ai drafts per year`,
  'Everything included in Free',
  '12-month draft allowance',
];

function FeatureChecks({ items }: { items: string[] }) {
  return (
    <ul className={styles.planFeatures}>
      {items.map((item) => (
        <li key={item}>
          <span>
            <MarketingIcon name="check" size={16} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function PricingPlanCards({ terms }: { terms: CommercialTerms }) {
  return (
    <div className={styles.pricingSection} aria-label="Pricing plans">
      <article className={`${styles.planCard} ${styles.freePlan}`} data-accent="yellow">
        <div className={styles.planName}>
          <h3>Free</h3>
          <p>Try the complete review loop.</p>
        </div>
        <p className={`${styles.price} ${priceFont.variable}`}>
          <small className={styles.currency}>₹</small>0
        </p>
        <p className={styles.planBilling}>No card needed to begin</p>
        <ActionLink href="/signup" secondary>
          Create free account
        </ActionLink>
        <div className={styles.planDetails}>
          <h4>What’s included</h4>
          <FeatureChecks items={FREE_FEATURES(terms)} />
        </div>
        <PricingDetailsLink plan="Free" />
      </article>

      <article className={`${styles.planCard} ${styles.proPlan}`} data-accent="green">
        <div className={styles.planName}>
          <h3>Pro</h3>
          <p>More capacity for your business.</p>
        </div>
        <p className={`${styles.price} ${priceFont.variable}`}>
          <small className={styles.currency}>₹</small>
          {terms.priceLabel.replace('₹', '')} <span>/ year</span>
        </p>
        <p className={styles.planBilling}>Billed annually</p>
        <ActionLink href="/signup">Create account</ActionLink>
        <div className={styles.planDetails}>
          <h4>What’s included</h4>
          <FeatureChecks items={PRO_FEATURES(terms)} />
        </div>
        <PricingDetailsLink plan="Pro" />
      </article>
    </div>
  );
}
