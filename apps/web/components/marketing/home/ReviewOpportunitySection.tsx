import localFont from 'next/font/local';
import styles from './ReviewOpportunitySection.module.css';

const headingFont = localFont({
  src: '../../../assets/fonts/inter-latin-800-normal.woff',
  variable: '--font-opportunity-heading',
  weight: '800',
  display: 'swap',
  preload: false,
  fallback: ['Arial', 'sans-serif'],
});

const BARRIERS = [
  { title: 'Lost Trust', emoji: '💔' },
  { title: 'Lost Sales', emoji: '📉' },
  { title: 'Lost Customers', emoji: '🚶' },
] as const;

export function ReviewOpportunitySection() {
  return (
    <section
      id="review-opportunity"
      className={styles.section}
      aria-labelledby="review-opportunity-title"
      data-review-opportunity
    >
      <h2 id="review-opportunity-title" className={`${styles.heading} ${headingFont.variable}`}>
        Ignoring reviews is like turning customers away at your door
      </h2>
      <p className={styles.description}>
        Give customers an easier way to share their experience. With Ai Review, they scan your QR,
        choose their services and edit an Ai-assisted draft before posting it themselves on Google.
      </p>
      <ul className={styles.points} aria-label="Why customer reviews matter">
        {BARRIERS.map(({ title, emoji }, index) => (
          <li className={styles.point} key={title} data-review-opportunity-item>
            <span className={styles.emoji} aria-hidden="true" data-review-opportunity-emoji>
              {emoji}
            </span>
            <h3>{title}</h3>
            {index < BARRIERS.length - 1 ? (
              <svg
                className={styles.connector}
                data-review-opportunity-arrow
                width="76"
                height="44"
                viewBox="0 0 76 44"
                fill="none"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M5 28C22 10 46 10 67 26M54 27l14 1-2-14" />
              </svg>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
