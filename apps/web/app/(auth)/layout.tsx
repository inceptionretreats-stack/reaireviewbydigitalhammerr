import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from '@/components/auth/AuthShell.module.css';

/** Shared, responsive shell for every signed-out account screen. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.authPage}>
      <main className={styles.authShell}>
        <section className={styles.formPanel}>
          <header className={styles.formHeader}>
            <Link href="/" className={styles.brandLink} aria-label="Ai Review home">
              <span className={styles.brand}>
                <span className={styles.brandMark} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.brandCopy}>
                  <strong>Ai Review</strong>
                  <small>by Digital Hammerr</small>
                </span>
              </span>
            </Link>

            <Link href="/" className={styles.homeLink}>
              Back to website
            </Link>
          </header>

          <div className={styles.formContent}>{children}</div>

          <footer className={styles.formFooter}>
            Ai writing help for genuine customer feedback. Customers always review and post for
            themselves.
          </footer>
        </section>

        <aside className={styles.mediaPanel} aria-label="Ai robot review story">
          <div className={styles.mediaSticky}>
            <div className={styles.mediaCanvas} data-auth-color-rail>
              <div className={styles.mediaArtwork}>
                <Image
                  src="/marketing/robot-reviewing-auth-v1.png"
                  alt="A friendly Ai robot holding a phone at a café table"
                  fill
                  preload
                  sizes="(max-width: 560px) 100vw, (max-width: 1050px) 560px, 54vw"
                  className={styles.mediaImage}
                  data-motion-accent="auth-image"
                />
              </div>

              <div className={styles.mediaCopy}>
                <h2>Make every visit easier to put into words.</h2>
                <p>A cleaner path from an in-person visit to thoughtful, authentic feedback.</p>
              </div>

              <div className={styles.mediaCard} data-motion-accent="auth-review-card">
                <span className={styles.mediaCardIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path
                      d="m6.5 12.5 3.2 3.2 7.8-8.2"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span>
                  <strong>The customer stays in control</strong>
                  <small>
                    They can edit the draft, confirm their visit, and choose whether to post.
                  </small>
                </span>
              </div>

              <span
                className={`${styles.tick} ${styles.tickBlue}`}
                data-motion-accent="auth-tick"
                aria-hidden="true"
              />
              <span
                className={`${styles.tick} ${styles.tickRed}`}
                data-motion-accent="auth-tick"
                aria-hidden="true"
              />
              <span
                className={`${styles.tick} ${styles.tickYellow}`}
                data-motion-accent="auth-tick"
                aria-hidden="true"
              />
              <span
                className={`${styles.tick} ${styles.tickGreen}`}
                data-motion-accent="auth-tick"
                aria-hidden="true"
              />
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
