import Image from 'next/image';
import type { LandingDemo } from '@/lib/landing-demo';
import { HeroAiAccent } from './HeroAiAccent';
import { PricingPlanCards } from './PricingMarketingPage';
import { ReviewStoryVideo } from './ReviewStoryVideo';
import { ROBOT_IMAGE, RobotClaimBand } from './RobotClaimBand';
import {
  ActionLink,
  MarketingShell,
  ReviewerVisual,
  TrustBand,
  marketingStyles as styles,
} from './MarketingSite';

const HERO_FLOW_STEPS = [
  { label: 'SCAN', tone: 'green' },
  { label: 'COPY', tone: 'blue' },
  { label: 'PASTE', tone: 'yellow' },
  { label: 'REVIEW', tone: 'red' },
] as const;

const HOW_IT_WORKS_STEPS = [
  {
    icon: '🧮',
    title: 'Scan or Tap',
    body: 'Customer scans your QR code or taps your NFC card at the counter. No app download needed.',
  },
  {
    icon: 'robot',
    title: 'Ai Writes the Review',
    body: 'In under 3 seconds, Ai creates a genuine-sounding review based on your business type. Sounds like a real person wrote it.',
  },
  {
    icon: '✅',
    title: 'One Tap to Post',
    body: 'Customer copies the review and is instantly redirected to your Google page. Done in 10 seconds.',
  },
] as const;

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
              <span className={styles.heroWordRed}>REVIEW</span> <HeroAiAccent />
            </span>{' '}
            <span className={styles.heroHeadlineLine}>
              <span className={styles.heroWordYellow}>LIKH</span>{' '}
              <span className={styles.heroWordGreen}>DEGA</span>
            </span>
          </h1>
          <div className={styles.heroMicrocopy}>
            <span>Share your experience.</span>
            <strong>Help others choose us!</strong>
          </div>
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
                  {step.label}
                </li>
              ))}
            </ol>
            <p className={styles.heroTrustLine} data-hero-trust-line>
              <span>Real reviews.</span> <strong>Real trust.</strong> <em>Real growth.</em>
            </p>
          </div>
        </div>
        <ReviewerVisual demo={demo} />
      </section>

      <section className={styles.homeSteps} id="how-it-works" aria-labelledby="home-steps-title">
        <header className={styles.stepsHeading}>
          <span className={styles.stepsEyebrow}>How it works</span>
          <h2 id="home-steps-title">
            <span>Simple for You.</span>
            <span>Effortless for Customers.</span>
          </h2>
        </header>

        <ol className={styles.stepPreview}>
          {HOW_IT_WORKS_STEPS.map((step, index) => (
            <li key={step.title}>
              <span className={styles.stepNumber} aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className={styles.stepPreviewIcon} aria-hidden="true">
                {step.icon === 'robot' ? (
                  <Image
                    className={styles.stepRobot}
                    src={ROBOT_IMAGE}
                    alt=""
                    width={74}
                    height={89}
                  />
                ) : (
                  step.icon
                )}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        className={styles.storyShowcase}
        id="review-journey"
        aria-labelledby="story-showcase-title"
      >
        <div className={styles.storyShowcaseCopy}>
          <span className={styles.storyEyebrow}>See it in motion</span>
          <h2 id="story-showcase-title">The whole review journey, brought to life.</h2>
          <p>
            Follow a quick scan into an editable draft, a customer-made revision, and a final
            handoff to Google that always stays in their control.
          </p>
          <ActionLink href="/signup">Create your review flow</ActionLink>
        </div>

        <ReviewStoryVideo />
      </section>

      <TrustBand />

      <section className={styles.homePricing} id="pricing" aria-labelledby="pricing-title">
        <header className={styles.pricingIntro}>
          <span>Pricing</span>
          <h2 id="pricing-title">Start with Free. Move to Pro when you need more.</h2>
          <p>No card to begin. Free includes ten drafts; Pro includes 2,000 drafts per year.</p>
        </header>
        <PricingPlanCards />
      </section>

      <RobotClaimBand />
    </MarketingShell>
  );
}
