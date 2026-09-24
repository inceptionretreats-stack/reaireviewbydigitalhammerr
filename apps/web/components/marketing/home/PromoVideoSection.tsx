import localFont from 'next/font/local';
import styles from './PromoVideoSection.module.css';

const headingFont = localFont({
  src: '../../../assets/fonts/inter-latin-800-normal.woff',
  variable: '--font-promo-heading',
  weight: '800',
  display: 'swap',
  preload: false,
  fallback: ['Arial', 'sans-serif'],
});

export function PromoVideoSection() {
  return (
    <section
      className={styles.section}
      id="review-video"
      aria-labelledby="review-video-title"
      data-promo-section
    >
      <h2 id="review-video-title" className={`${styles.heading} ${headingFont.variable}`}>
        <span className={styles.headingLine}>Stop Losing Customers Because</span>{' '}
        <span className={styles.headingLine}>
          of Bad or Missing{' '}
          <span className={styles.highlight}>
            Reviews
            <svg
              className={styles.underline}
              viewBox="0 0 290 22"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6 16C87 3 198 2 282 14" />
            </svg>
            <svg
              className={styles.spark}
              viewBox="0 0 42 42"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M9 20L15 5M20 25L35 14M24 36L38 33" />
            </svg>
          </span>
        </span>
      </h2>
      <div className={styles.frame}>
        <video
          className={styles.video}
          width="1280"
          height="720"
          controls
          playsInline
          preload="none"
          poster="/marketing/ai-review-promo-poster.webp"
          aria-label="Ai Review promotional video"
          data-promo-video
        >
          <source src="/marketing/ai-review-promo.mp4" type="video/mp4" />
          Your browser does not support video playback.
        </video>
      </div>
    </section>
  );
}
