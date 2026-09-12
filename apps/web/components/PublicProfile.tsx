'use client';

import { useCallback, useState } from 'react';
import styles from './PublicProfile.module.css';

/**
 * PUB-01 — the public business trust/link page.
 *
 * Everything this component receives is already resolved: the server picked the enabled
 * sections, put them in stored order and built each href. That split is deliberate rather
 * than tidiness.
 *
 *  - AC-020 requires disabled or empty sections to be ABSENT from the HTML, not hidden. If
 *    href resolution happened here, a section with no usable target would have to be filtered
 *    in the browser, which means it exists in the markup for at least one frame and is
 *    trivially recoverable from the RSC payload. Sections that cannot render never leave the
 *    server (see resolveSection in app/[slug]/page.tsx).
 *  - AC-033 sets a p75 LCP of 2.5s on Indian 4G. The only reason this is a client component
 *    at all is the click beacon, so it carries no data fetching, no formatting library and no
 *    dashboard code.
 *
 * There is deliberately no star rating, no sentiment prompt and no "how was your visit?"
 * branch anywhere on this page (D-009, AC-006). Private feedback is reachable from here on
 * equal footing with Review Us (D-010, 13_Security_Privacy_Compliance.md rule 6).
 */

const EVENTS_ENDPOINT = '/api/v1/public/events';

export type ProfileSectionType =
  | 'GOOGLE_REVIEW'
  | 'WHATSAPP'
  | 'CALL'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'WEBSITE'
  | 'DIRECTIONS'
  | 'CUSTOM';

export interface ProfileSection {
  /** business_links.id — the analytics dimension behind DASH-01's "Top link clicks". */
  id: string;
  type: ProfileSectionType;
  label: string;
  /** Resolved and scheme-checked server-side; never assembled in the browser. */
  href: string;
  opensInNewTab: boolean;
}

export interface PublicProfileProps {
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  sections: readonly ProfileSection[];
}

export function PublicProfile({
  slug,
  name,
  description,
  logoUrl,
  coverUrl,
  sections,
}: PublicProfileProps) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const showLogo = logoUrl !== null && failedLogo !== logoUrl;
  const showCover = coverUrl !== null && failedCover !== coverUrl;

  const trackLinkClick = useCallback(
    (section: ProfileSection) => {
      const body = JSON.stringify({
        name: 'profile_link_click',
        slug,
        // business_id and anonymous_session_id are NOT sent: the events route injects them
        // from server-resolved state, so a forged payload cannot write into another tenant.
        // link_id is a tenant-local row id and is stored under the resolved business either
        // way, which is why it is safe to take from the client.
        properties: { link_type: section.type, link_id: section.id },
      });

      // PUB-01-03 / AC-035: the click must navigate immediately. sendBeacon hands the request
      // to the browser, which delivers it even as the document is torn down; the keepalive
      // fetch covers browsers where sendBeacon is unavailable or refuses to queue.
      try {
        if (typeof navigator.sendBeacon === 'function') {
          const queued = navigator.sendBeacon(
            EVENTS_ENDPOINT,
            new Blob([body], { type: 'application/json' }),
          );
          if (queued) return;
        }

        void fetch(EVENTS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // An analytics failure is never surfaced to the customer.
      }
    },
    [slug],
  );

  return (
    <main className={styles.page}>
      <span className={`${styles.backdropOrb} ${styles.backdropOrbOne}`} aria-hidden="true" />
      <span className={`${styles.backdropOrb} ${styles.backdropOrbTwo}`} aria-hidden="true" />

      <article className={styles.profileCard}>
        <header className={styles.hero}>
          {/*
            A configured cover remains the LCP candidate and is loaded eagerly. Plain <img> is
            intentional: S3_PUBLIC_BASE_URL varies by environment, so next/image would require a
            remotePatterns entry that can drift from the runtime asset host.
          */}
          {showCover ? (
            <img
              src={coverUrl}
              alt=""
              width={1200}
              height={400}
              fetchPriority="high"
              decoding="async"
              className={styles.cover}
              onError={() => setFailedCover(coverUrl)}
            />
          ) : null}
          <span className={styles.heroShade} aria-hidden="true" />
          <span className={styles.heroRing} aria-hidden="true" />
          <span className={styles.heroSpark} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>

          <div className={styles.logoFrame}>
            {showLogo ? (
              <img
                src={logoUrl}
                alt=""
                width={104}
                height={104}
                loading="lazy"
                decoding="async"
                className={styles.logo}
                onError={() => setFailedLogo(logoUrl)}
              />
            ) : (
              <span className={styles.logoFallback} aria-hidden="true">
                {businessInitials(name)}
              </span>
            )}
            <span className={styles.logoBadge} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
        </header>

        <section className={styles.identity}>
          <p className={styles.eyebrow}>Your experience matters</p>
          <h1 className={styles.name}>{name}</h1>
          {description ? <p className={styles.description}>{description}</p> : null}
        </section>

        {/*
          AC-020: only server-resolved sections reach this list. Nothing here is visually hidden
          or disabled; an incomplete section remains absent from both the HTML and RSC payload.
        */}
        {sections.length > 0 ? (
          <nav className={styles.linkNav} aria-label={`Links for ${name}`}>
            <ul className={styles.linkList}>
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    className={`${styles.profileLink} ${
                      section.type === 'GOOGLE_REVIEW'
                        ? styles.profileLinkPrimary
                        : styles.profileLinkSecondary
                    }`}
                    href={section.href}
                    {...(section.opensInNewTab
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    onClick={() => trackLinkClick(section)}
                  >
                    <span className={styles.linkLead}>
                      <span className={styles.linkIcon} aria-hidden="true">
                        <SectionIcon type={section.type} />
                      </span>
                      <span>{section.label}</span>
                    </span>
                    <span className={styles.linkArrow} aria-hidden="true">
                      <ArrowIcon external={section.opensInNewTab} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {/*
          FB-01-01 and AC-024: private feedback is always a full-sized action, never hidden behind
          a rating or sentiment branch.
        */}
        <div className={styles.feedbackWrap}>
          <a className={styles.feedbackLink} href={`/${slug}/feedback`}>
            <span className={styles.feedbackIcon} aria-hidden="true">
              <FeedbackIcon />
            </span>
            <span>Send private feedback</span>
            <span className={styles.feedbackArrow} aria-hidden="true">
              <ArrowIcon external={false} />
            </span>
          </a>
        </div>

        <footer className={styles.brandFooter}>
          <span className={styles.brandGlyph} aria-hidden="true">
            <i />
            <i />
          </span>
          <span className={styles.brandWords}>
            <small>By</small>
            <strong>Digital Hammerr</strong>
          </span>
        </footer>
      </article>
    </main>
  );
}

function businessInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'DH';
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : (words[0]?.[1] ?? '');
  return `${first}${last}`.toLocaleUpperCase().slice(0, 2);
}

function SectionIcon({ type }: { type: ProfileSectionType }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (type) {
    case 'GOOGLE_REVIEW':
      return (
        <svg {...common}>
          <path d="M4 5.5h16v11H9l-5 3v-14Z" />
          <path d="m8.5 11 2 2 4.7-4.7" />
        </svg>
      );
    case 'WHATSAPP':
      return (
        <svg {...common}>
          <path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z" />
          <path d="M9 8.4c.7 2.3 2.3 3.9 4.7 4.7l1.2-1.1 1.7.8c-.1 1.2-1.1 2.2-2.4 2.2-3.5-.2-7-3.6-7.2-7.2 0-1.3 1-2.3 2.2-2.4l.8 1.7L9 8.4Z" />
        </svg>
      );
    case 'CALL':
      return (
        <svg {...common}>
          <path d="M7.2 3.8 4.8 5c-.7.4-1 1.2-.8 2 1.5 6.4 6.6 11.5 13 13 .8.2 1.6-.1 2-.8l1.2-2.4-4.1-2-1.2 1.5c-3.1-1.2-5.9-4-7.2-7.2l1.5-1.2-2-4.1Z" />
        </svg>
      );
    case 'INSTAGRAM':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.6" r=".8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'FACEBOOK':
      return (
        <svg {...common}>
          <path d="M14.5 21v-8h2.8l.5-3h-3.3V8.2c0-.9.4-1.7 1.8-1.7H18V3.8c-.8-.1-1.7-.3-2.5-.3-2.6 0-4.3 1.6-4.3 4.4V10H8.4v3h2.8v8" />
        </svg>
      );
    case 'DIRECTIONS':
      return (
        <svg {...common}>
          <path d="m12 3 9 9-9 9-9-9 9-9Z" />
          <path d="M8 13h7m0 0-2.5-2.5M15 13l-2.5 2.5" />
        </svg>
      );
    case 'WEBSITE':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.5 12h17M12 3c2.2 2.5 3.4 5.5 3.4 9S14.2 18.5 12 21c-2.2-2.5-3.4-5.5-3.4-9S9.8 5.5 12 3Z" />
        </svg>
      );
    case 'CUSTOM':
      return (
        <svg {...common}>
          <path d="m9.5 14.5 5-5" />
          <path d="M7.4 16.6 5.8 18.2a2.8 2.8 0 0 1-4-4l3.4-3.4a2.8 2.8 0 0 1 4 0" />
          <path d="m14.8 13.2a2.8 2.8 0 0 0 4 0l3.4-3.4a2.8 2.8 0 0 0-4-4l-1.6 1.6" />
        </svg>
      );
  }
}

function ArrowIcon({ external }: { external: boolean }) {
  return external ? (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 14 14 6m-5 0h5v5" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m7 4 6 6-6 6" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5.5h16v11H9l-5 3v-14Z" />
      <path d="M8 10h8m-8 3h5" />
    </svg>
  );
}
