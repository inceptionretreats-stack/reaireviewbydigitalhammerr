import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ListChecks, LockKeyhole, Pencil, QrCode } from 'lucide-react';
import { ReviewBenefitsDraft } from './ReviewBenefitsDraft';
import styles from './ReviewBenefits.module.css';

const highlights = [
  { label: 'Branded QR', Icon: QrCode, tone: 'blue' },
  { label: 'Service-based drafts', Icon: ListChecks, tone: 'red' },
  { label: 'Editable words', Icon: Pencil, tone: 'yellow' },
  { label: 'Private feedback', Icon: LockKeyhole, tone: 'green' },
] as const;

const steps = [
  {
    title: 'Start with a scan',
    description: 'Customers scan your QR and choose the service(s) they actually used.',
  },
  {
    title: 'Shape a personal draft',
    description: 'Ai helps turn their selections into an editable draft they can make their own.',
  },
  {
    title: 'Customer decides',
    description:
      'They can copy and post their review on Google or send private feedback. Nothing posts automatically.',
  },
] as const;

export function ReviewBenefits() {
  return (
    <section
      className={styles.section}
      id="why-ai-review"
      aria-labelledby="review-benefits-title"
      data-review-benefits
    >
      <div className={styles.inner} data-benefits-grid>
        <div className={styles.content}>
          <div className={styles.brandRule} aria-hidden="true" />
          <p className={styles.eyebrow}>Why Ai Review</p>
          <h2 id="review-benefits-title">A simpler path from visit to review.</h2>
          <p className={styles.intro}>
            Customers share what happened in their own words—with Ai there to help.
          </p>

          <ul className={styles.highlights} aria-label="Ai Review features">
            {highlights.map(({ label, Icon, tone }) => (
              <li className={styles.highlight} data-tone={tone} key={label}>
                <Icon aria-hidden="true" size={19} strokeWidth={2} />
                <span>{label}</span>
              </li>
            ))}
          </ul>

          <ol className={styles.steps} aria-label="From scan to review">
            {steps.map(({ title, description }, index) => (
              <li className={styles.step} data-review-benefit key={title}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3>{title}</h3>
                  <p data-benefit-description>{description}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className={styles.actions}>
            <Link className={styles.primaryLink} href="/signup">
              Create your free QR <ArrowRight aria-hidden="true" size={22} strokeWidth={2} />
            </Link>
            <Link className={styles.secondaryLink} href="#how-it-works">
              See how it works <ArrowRight aria-hidden="true" size={18} strokeWidth={2} />
            </Link>
          </div>
        </div>

        <div className={styles.media}>
          <Image
            className={styles.photo}
            src="/marketing/benefits-local-shop-v1.webp"
            alt="Two people talking across a local shop counter"
            fill
            loading="eager"
            sizes="(max-width: 760px) 100vw, (max-width: 1200px) 48vw, 720px"
          />
          <div className={styles.draftCard}>
            <ReviewBenefitsDraft />
          </div>
          <p className={styles.disclosure}>Illustrative draft preview, not a customer result.</p>
        </div>
      </div>
    </section>
  );
}
