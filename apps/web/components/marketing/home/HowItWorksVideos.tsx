import { HowItWorksClip } from './HowItWorksClip';
import styles from './HowItWorksVideos.module.css';

const STEPS = [
  {
    id: 'scan',
    title: 'Scan or Tap',
    caption: 'Scan the QR code to get started.',
  },
  {
    id: 'draft',
    title: 'Ai Drafts a Review',
    caption: 'Let Ai draft a review you can edit.',
  },
  {
    id: 'publish',
    title: 'Copy, Paste & Post',
    caption: 'Copy, paste & post it yourself.',
  },
] as const;

export function HowItWorksVideos() {
  return (
    <section
      className={styles.section}
      id="how-it-works"
      data-how-it-works
      aria-labelledby="home-steps-title"
    >
      <header className={styles.heading}>
        <h2 id="home-steps-title">
          How it <span>works</span>
        </h2>
        <p data-how-intro>Bas QR scan karo, Ai se review banao aur Google par share karo.</p>
      </header>

      <ol className={styles.grid} data-how-grid role="list">
        {STEPS.map((step, index) => (
          <li className={styles.card} data-how-step key={step.id}>
            <div className={styles.copy}>
              <h3 className={styles.stepLabel} data-how-step-title>
                Step {index + 1}
              </h3>
            </div>
            <p className={styles.stepCaption} data-how-step-caption>
              {step.caption}
            </p>
            <div className={styles.media}>
              <HowItWorksClip id={step.id} title={step.title} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
