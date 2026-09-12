import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { QrStandeePreview } from '@/components/qr/QrStandeePreview';
import type { LandingDemo } from '@/lib/landing-demo';
import { MarketingSectionNav, type MarketingSectionLink } from './MarketingSectionNav';
import styles from './MarketingSite.module.css';

export type MarketingIconName =
  | 'analytics'
  | 'arrow'
  | 'check'
  | 'copy'
  | 'draft'
  | 'edit'
  | 'feedback'
  | 'phone'
  | 'profile'
  | 'qr'
  | 'shield';

const NAVIGATION: readonly MarketingSectionLink[] = [
  { href: '/#home', label: 'Home', id: 'home', accent: 'blue' },
  { href: '/#how-it-works', label: 'How it works', id: 'how-it-works', accent: 'yellow' },
  { href: '/#pricing', label: 'Pricing', id: 'pricing', accent: 'green' },
];

export function MarketingIcon({ name, size = 24 }: { name: MarketingIconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'analytics':
      return (
        <svg {...common}>
          <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...common}>
          <path d="M5 12h14m-5-5 5 5-5 5" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </svg>
      );
    case 'draft':
      return (
        <svg {...common}>
          <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v5h5M9 13h6M9 17h4" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...common}>
          <path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
          <path d="m13.8 7.2 3 3" />
        </svg>
      );
    case 'feedback':
      return (
        <svg {...common}>
          <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <path d="M8 10h8m-8 3h5" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...common}>
          <rect x="6" y="2" width="12" height="20" rx="3" />
          <path d="M10 5h4m-3 14h2" />
        </svg>
      );
    case 'profile':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 21a7 7 0 0 1 14 0" />
        </svg>
      );
    case 'qr':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3zm4 4h3v3h-3zm0-4h3m-7 7h2" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v5.5c0 4.6 3 7.9 7.5 9.5 4.5-1.6 7.5-4.9 7.5-9.5V6L12 3Z" />
          <path d="m8.5 12 2.2 2.2 4.8-5" />
        </svg>
      );
  }
}

export function MarketingBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className={styles.brandCopy}>
        <strong>Ai Review</strong>
        {!compact ? <small>by Digital Hammerr</small> : null}
      </span>
    </span>
  );
}

function MarketingHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.brandLink} href="/" aria-label="Ai Review home">
          <MarketingBrand />
        </Link>
        <MarketingSectionNav items={NAVIGATION} />
        <div className={styles.accountNav}>
          <Link className={styles.signInLink} href="/login">
            Sign in
          </Link>
          <Link className={styles.headerCta} href="/signup">
            Create account
          </Link>
        </div>
      </div>
    </header>
  );
}

function MarketingFooter({ demo }: { demo?: LandingDemo | null }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerIntro}>
          <MarketingBrand />
          <p>A clearer way for real customers to write and share genuine reviews.</p>
        </div>
        <nav className={styles.footerNav} aria-label="Footer navigation">
          {NAVIGATION.map((item) => (
            <Link key={item.id} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.footerAccount}>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Create account</Link>
          {demo ? <Link href={`/${demo.slug}`}>Example page</Link> : null}
        </div>
      </div>
      <div className={styles.footerBottom}>
        <span>Ai Review by Digital Hammerr</span>
        <span>Customers always control what they post.</span>
      </div>
    </footer>
  );
}

export function MarketingShell({
  children,
  demo = null,
}: {
  children: ReactNode;
  demo?: LandingDemo | null;
}) {
  return (
    <div className={styles.site}>
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter demo={demo} />
    </div>
  );
}

export function ActionLink({
  href,
  children,
  secondary = false,
  tone = 'blue',
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
  tone?: 'blue' | 'red' | 'green';
}) {
  const toneClass = tone === 'red' ? styles.redButton : tone === 'green' ? styles.greenButton : '';

  return (
    <Link
      className={secondary ? styles.secondaryButton : `${styles.primaryButton} ${toneClass}`}
      href={href}
    >
      <span>{children}</span>
      <MarketingIcon name="arrow" size={18} />
    </Link>
  );
}

export function ReviewerVisual({ demo }: { demo?: LandingDemo | null }) {
  return (
    <div className={styles.reviewerVisual} data-has-demo={Boolean(demo)} data-hero-visual>
      <div className={styles.heroImageSurface} data-hero-media="image">
        <Image
          className={styles.heroImage}
          src="/marketing/customer-review-hero-v4.png"
          alt="Customer showing an editable Ai-written review draft on her phone"
          fill
          preload
          sizes="(max-width: 820px) calc(100vw - 36px), (max-width: 1100px) 58vw, 800px"
        />
        <span className={styles.colorRail} aria-hidden="true" />
      </div>
      {demo ? (
        <div
          className={styles.heroStandeeWrap}
          data-hero-qr
          role="group"
          aria-label="Live review demo"
        >
          <QrStandeePreview
            businessName={demo.name}
            qrSrc={demo.qrDataUri}
            className={styles.heroStandee}
          />
          <Link className={styles.liveDemoLink} href={`/r/${demo.code}`}>
            <span>Open live demo</span>
            <MarketingIcon name="arrow" size={15} />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function TrustBand() {
  return (
    <section className={styles.trustBand} aria-label="Review safeguards">
      <span className={styles.trustIcon}>
        <MarketingIcon name="shield" size={32} />
      </span>
      <div>
        <h2>Built for trust, not shortcuts.</h2>
        <p>Every customer gets the same honest path, with private feedback always available.</p>
        <ul>
          <li>They post it themselves</li>
          <li>No rating is requested</li>
          <li>We never claim it was submitted</li>
          <li>Every draft stays editable—no forced merchant wording</li>
        </ul>
      </div>
      <Link href="#how-it-works">
        Review the three steps <MarketingIcon name="arrow" size={17} />
      </Link>
    </section>
  );
}

export function MarketingCallToAction({
  title = 'Ready to make every visit easier to share?',
  body = 'Create your account in minutes and keep the customer in control.',
}: {
  title?: string;
  body?: string;
}) {
  return (
    <section className={styles.finalSection}>
      <div className={styles.finalCta}>
        <span className={styles.finalShapeBlue} aria-hidden="true" />
        <span className={styles.finalShapeRed} aria-hidden="true" />
        <span className={styles.finalShapeYellow} aria-hidden="true" />
        <span className={styles.finalShapeGreen} aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        <ActionLink href="/signup">Create your account</ActionLink>
      </div>
    </section>
  );
}

export { styles as marketingStyles };
