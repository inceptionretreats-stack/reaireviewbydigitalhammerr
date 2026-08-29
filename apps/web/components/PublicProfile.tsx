'use client';

import { useCallback, type CSSProperties } from 'react';

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

const PRIMARY_LINK = 'btn btn-primary';
const SECONDARY_LINK = 'btn btn-secondary';

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
    <div className="stack">
      {/*
        The cover is the largest above-the-fold element and therefore the LCP candidate, so it
        is loaded eagerly at high priority. Lazy-loading it would be the single most effective
        way to fail AC-033. aspect-ratio plus the width/height attributes reserve its box
        before it arrives, so the heading below does not jump (CLS).

        Plain <img> rather than next/image: the asset host comes from S3_PUBLIC_BASE_URL and
        varies per environment, and next/image would need a matching remotePatterns entry in
        next.config.ts — a file this module must not touch, and a runtime 400 if it drifts.
      */}
      {coverUrl && (
        <img
          src={coverUrl}
          alt=""
          width={1200}
          height={400}
          fetchPriority="high"
          decoding="async"
          style={COVER_STYLE}
        />
      )}

      <div className="identity">
        {/*
          Both images are decorative: the business name follows immediately as text, so alt
          text here would make a screen reader announce the name twice (AC-037). The logo is
          small and secondary to the cover, so it is the one piece of optional media that is
          lazy-loaded.
        */}
        {logoUrl && (
          <img src={logoUrl} alt="" width={72} height={72} loading="lazy" decoding="async" />
        )}
        <h1>{name}</h1>
        {description && <p className="muted">{description}</p>}
      </div>

      {/*
        AC-020: this list contains only sections the server could fully resolve. There is no
        `hidden` attribute, no `display: none` and no disabled state anywhere in this file —
        an absent section is absent from the document.
      */}
      {sections.length > 0 && (
        <nav aria-label={`Links for ${name}`}>
          <ul style={LIST_STYLE}>
            {sections.map((section) => (
              <li key={section.id} style={ITEM_STYLE}>
                <a
                  // Review Us is the page's primary action wherever the owner placed it, so
                  // emphasis follows the section type rather than its position (D-015).
                  className={section.type === 'GOOGLE_REVIEW' ? PRIMARY_LINK : SECONDARY_LINK}
                  href={section.href}
                  {...(section.opensInNewTab
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                  onClick={() => trackLinkClick(section)}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/*
        FB-01-01 and AC-024: private feedback is offered to every visitor, unconditionally.
        It is not behind a sentiment question, because none is ever asked.
      */}
      <a className="btn btn-text" href={`/${slug}/feedback`}>
        Send private feedback
      </a>
    </div>
  );
}

/**
 * Inline styles, not utility classes.
 *
 * apps/web ships a hand-written stylesheet (app/globals.css) and no Tailwind entrypoint, so
 * utility class names would render as unstyled markup. These three rules are the only ones the
 * public profile needs beyond the shared vocabulary, and they reuse the same custom properties
 * as the stylesheet so the palette — and therefore the AA contrast AC-038 requires — stays in
 * one place.
 */
const COVER_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 'auto',
  aspectRatio: '3 / 1',
  objectFit: 'cover',
  borderRadius: 'var(--radius)',
};

const LIST_STYLE: CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };

const ITEM_STYLE: CSSProperties = { marginTop: '0.75rem' };
