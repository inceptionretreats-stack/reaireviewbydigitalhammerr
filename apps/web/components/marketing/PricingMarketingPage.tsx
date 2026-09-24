import localFont from 'next/font/local';
import {
  ActionLink,
  MarketingCallToAction,
  MarketingIcon,
  MarketingShell,
  marketingStyles as styles,
} from './MarketingSite';
import { PricingDetailsLink } from './PricingDetails';

const priceFont = localFont({
  src: '../../assets/fonts/inter-latin-600-normal.woff',
  variable: '--font-plan-price',
  weight: '600',
  display: 'swap',
  preload: false,
  fallback: ['Arial', 'sans-serif'],
});

const FREE_FEATURES = [
  '10 Ai drafts per business',
  'Branded QR and business page',
  'Private feedback and analytics',
];

const PRO_FEATURES = [
  '2,000 Ai drafts per year',
  'Everything included in Free',
  '12-month draft allowance',
];

const INCLUDED = [
  {
    accent: 'red',
    icon: 'edit' as const,
    title: 'Always editable',
    body: 'Customers keep the final word.',
  },
  {
    accent: 'green',
    icon: 'shield' as const,
    title: 'No rating gate',
    body: 'Everyone sees the same path.',
  },
  {
    accent: 'yellow',
    icon: 'feedback' as const,
    title: 'Private feedback',
    body: 'Open to every customer.',
  },
  {
    accent: 'blue',
    icon: 'qr' as const,
    title: 'Print-ready QR',
    body: 'Branded for your business.',
  },
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

export function PricingPlanCards() {
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
          <FeatureChecks items={FREE_FEATURES} />
        </div>
        <PricingDetailsLink plan="Free" />
      </article>

      <article className={`${styles.planCard} ${styles.proPlan}`} data-accent="green">
        <div className={styles.planName}>
          <h3>Pro</h3>
          <p>More capacity for your business.</p>
        </div>
        <p className={`${styles.price} ${priceFont.variable}`}>
          <small className={styles.currency}>₹</small>999 <span>/ year</span>
        </p>
        <p className={styles.planBilling}>Billed annually</p>
        <ActionLink href="/signup">Create account</ActionLink>
        <div className={styles.planDetails}>
          <h4>What’s included</h4>
          <FeatureChecks items={PRO_FEATURES} />
        </div>
        <PricingDetailsLink plan="Pro" />
      </article>
    </div>
  );
}

export function PricingMarketingPage() {
  return (
    <MarketingShell>
      <section className={`${styles.pageHeading} ${styles.pricingHeading}`}>
        <div>
          <h1>Start free. Grow when it makes sense.</h1>
          <p>No card to begin, no complicated comparison and nothing hidden behind a demo.</p>
        </div>
        <ActionLink href="/signup">Create your account</ActionLink>
      </section>

      <PricingPlanCards />

      <section className={styles.includedSection}>
        <div className={styles.includedIntro}>
          <h2>Good product boundaries are included in every plan.</h2>
          <p>
            Upgrading adds capacity. It never changes who controls the review or who can share
            private feedback.
          </p>
        </div>
        <div className={styles.includedList}>
          {INCLUDED.map((item) => (
            <article key={item.title} data-accent={item.accent}>
              <span>
                <MarketingIcon name={item.icon} size={23} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.pricingAnswer}>
        <div>
          <h2>Can I try the customer experience before paying?</h2>
          <p>
            Yes. Free includes the complete mobile-first journey and ten drafts, so you can set up
            the experience before deciding whether you need Pro.
          </p>
        </div>
        <ActionLink href="/signup">Start with Free</ActionLink>
      </section>

      <MarketingCallToAction
        title="Start with the complete experience, for free."
        body="Create your account today. Upgrade only when the extra capacity is useful."
      />
    </MarketingShell>
  );
}
