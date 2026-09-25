import Link from 'next/link';
import styles from './PricingDetailsLink.module.css';

export function PricingDetailsLink({ plan }: { plan: 'Free' | 'Pro' }) {
  return (
    <div className={styles.cardMore}>
      <Link href="/legal/pricing" className={styles.cardLink}>
        <span>
          Show more<span className={styles.srOnly}> about the {plan} plan</span>
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      </Link>
    </div>
  );
}
