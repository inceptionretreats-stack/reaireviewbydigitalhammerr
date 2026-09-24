import type { LandingDemo } from '@/lib/landing-demo';
import { BusinessAudienceStrip } from './BusinessAudienceStrip';
import { HeroAiAccent } from './HeroAiAccent';
import { HowItWorksVideos } from './HowItWorksVideos';
import { PricingPlanCards } from './PricingMarketingPage';
import { PromoVideoSection } from './PromoVideoSection';
import { ReviewOpportunitySection } from './ReviewOpportunitySection';
import { RobotClaimBand } from './RobotClaimBand';
import { ReviewBenefits } from './ReviewBenefits';
import { FaqSection } from './FaqSection';
import {
  ActionLink,
  MarketingShell,
  HeroVideoVisual,
  marketingStyles as styles,
} from './MarketingSite';

const HERO_FLOW_STEPS = [
  { label: 'Scan', tone: 'green', icon: 'scan' },
  { label: 'Ai draft', tone: 'blue', icon: 'draft' },
  { label: 'Copy', tone: 'blue', icon: 'copy' },
  { label: 'Paste', tone: 'yellow', icon: 'clipboard' },
  { label: 'Review', tone: 'red', icon: 'star' },
] as const;

function HeroFlowIcon({ name }: { name: (typeof HERO_FLOW_STEPS)[number]['icon'] }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'scan' ? (
        <path d="M8 4H5a1 1 0 0 0-1 1v3m12-4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m12-4v3a1 1 0 0 1-1 1h-3" />
      ) : null}
      {name === 'draft' ? (
        <>
          <path d="M11 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M8 12h5m-5 4h8" />
          <path d="m18 2 1.3 3.7L23 7l-3.7 1.3L18 12l-1.3-3.7L13 7l3.7-1.3L18 2Z" />
        </>
      ) : null}
      {name === 'copy' ? (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      ) : null}
      {name === 'clipboard' ? (
        <>
          <path d="M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="8" y="2" width="8" height="6" rx="2" />
        </>
      ) : null}
      {name === 'star' ? (
        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
      ) : null}
    </svg>
  );
}

export function HomeMarketingPage({ demo }: { demo: LandingDemo | null }) {
  return (
    <MarketingShell demo={demo}>
      <section className={styles.homeHero} id="home">
        <div className={styles.homeHeroCopy} data-hero-message>
          <p className={styles.heroKicker} data-hero-kicker>
            Aap bas scan karo...
          </p>
          <h1 className={styles.heroHeadline}>
            <span className={styles.heroHeadlineLine}>
              <span className={styles.heroWordReview}>Review</span> <HeroAiAccent />
            </span>{' '}
            <span className={styles.heroHeadlineLine}>
              <span className={styles.heroWordLikh}>likh</span>{' '}
              <span className={styles.heroWordGreen}>dega</span>
            </span>
          </h1>
          <p className={styles.heroDescription} data-hero-description>
            Review Likhna Ab Easy Hai — AI Hai Na.
          </p>
          <div className={styles.heroActions}>
            <ActionLink href="/signup">Create your free QR</ActionLink>
          </div>

          <div className={styles.heroPromise}>
            <ol className={styles.heroFlow} data-hero-flow aria-label="Review process" role="list">
              {HERO_FLOW_STEPS.map((step) => (
                <li
                  className={styles.heroFlowStep}
                  data-hero-flow-step
                  data-tone={step.tone}
                  key={step.label}
                >
                  <span className={styles.heroFlowIcon} data-hero-flow-icon aria-hidden="true">
                    <HeroFlowIcon name={step.icon} />
                  </span>
                  <span className={styles.heroFlowLabel}>{step.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <HeroVideoVisual />
      </section>

      <BusinessAudienceStrip />

      <ReviewOpportunitySection />

      <HowItWorksVideos />

      <PromoVideoSection />

      <ReviewBenefits />

      <section className={styles.homePricing} id="pricing" aria-labelledby="pricing-title">
        <header className={styles.pricingIntro}>
          <h2 id="pricing-title">Simple pricing. Built for your business.</h2>
          <p>Start with Free. Upgrade when you need more.</p>
        </header>
        <PricingPlanCards />
      </section>

      <RobotClaimBand />
      <FaqSection />
    </MarketingShell>
  );
}
