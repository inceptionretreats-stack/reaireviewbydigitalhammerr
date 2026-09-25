import { Card } from '@ai-review/ui';
import type { SectionType } from '@/lib/profile/sections';
import styles from './ProfilePreview.module.css';

/**
 * PROFILE-01's `preview` state: what a visitor gets, rendered from what is stored.
 *
 * Deliberately shows the *saved* page rather than the unsaved form. The public page renders from the
 * database, so previewing the boxes on screen would show the owner a page that does not exist yet —
 * and the one thing a preview must never do is disagree with the thing it is previewing. When there
 * are unsaved edits the panel says so instead of quietly including them.
 *
 * Which sections appear is decided by `rendersPublicly` (see `sections.ts`), the editor's mirror of
 * AC-020: a hidden section, or one with nothing to point at, is *absent* here exactly as it is absent
 * from the public HTML — not greyed out, not struck through.
 *
 * Nothing here is interactive. The buttons are `<div>`s, not links: this is a picture of a page, and
 * a real anchor would invite the owner to click through and would make the preview part of their own
 * public analytics. The private-feedback row is shown as permanent because it is — D-010 and AC-024
 * offer it to every visitor unconditionally, and no setting on this screen can remove it.
 */

export interface PreviewSection {
  id: string;
  type: SectionType;
  label: string;
}

export interface ProfilePreviewProps {
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  /** Already filtered and ordered by the editor, so this component makes no decisions. */
  sections: readonly PreviewSection[];
  /** How many stored sections a visitor does not see, so their absence reads as a choice. */
  hiddenCount: number;
  hasUnsavedChanges: boolean;
  publicUrl: string | null;
  isLive: boolean;
}

export function ProfilePreview({
  name,
  description,
  logoUrl,
  coverUrl,
  sections,
  hiddenCount,
  hasUnsavedChanges,
  publicUrl,
  isLive,
}: ProfilePreviewProps) {
  return (
    <div className="flex flex-col gap-4">
      {hasUnsavedChanges && (
        <p role="status" className="text-sm font-medium text-ink">
          This is your saved page. Save your changes to see them here.
        </p>
      )}

      <Card
        title="Preview"
        titleAs="h2"
        description={
          isLive
            ? 'This is what a visitor sees on your public page.'
            : 'This is what a visitor will see once you publish your page.'
        }
        footer={
          <>
            {publicUrl !== null && <span className="break-all">{publicUrl}</span>}
            {hiddenCount > 0 && (
              <p className="mt-1">
                {hiddenCount === 1
                  ? '1 section is hidden or has no link, so it is not on your page at all.'
                  : `${hiddenCount} sections are hidden or have no link, so they are not on your page at all.`}
              </p>
            )}
          </>
        }
      >
        {/* A phone-width column, because that is how nearly every visitor arrives. */}
        <div className={styles.previewShell}>
          <header className={styles.hero}>
            {coverUrl !== null && (
              <img src={coverUrl} alt="" width={1200} height={400} className={styles.cover} />
            )}
            <span className={styles.heroShade} aria-hidden="true" />
            <span className={styles.heroRing} aria-hidden="true" />
            <span className={styles.heroSpark} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>

            <div className={styles.logoFrame}>
              {/*
              Decorative in the same way as on the public page: the business name follows immediately
              as text, so alt text here would have a screen reader announce it twice.
            */}
              {logoUrl !== null ? (
                <img src={logoUrl} alt="" width={72} height={72} className={styles.logo} />
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

          <div className={styles.identity}>
            <p className={styles.eyebrow}>Your experience matters</p>
            <p className={styles.name}>{name}</p>
            {description !== null && description !== '' && (
              <p className={styles.description}>{description}</p>
            )}
          </div>

          {sections.length > 0 ? (
            <ul role="list" className={styles.linkList}>
              {sections.map((section) => (
                <li key={section.id}>
                  {/*
                    Review Us is emphasised wherever the owner placed it, matching the public page:
                    emphasis follows the section type, not its position (D-015).
                  */}
                  <div
                    className={`${styles.profileLink} ${
                      section.type === 'GOOGLE_REVIEW'
                        ? styles.profileLinkPrimary
                        : styles.profileLinkSecondary
                    }`}
                  >
                    <span className={styles.linkLead}>
                      <span className={styles.linkIcon} aria-hidden="true">
                        <SectionIcon type={section.type} />
                      </span>
                      <span>{section.label}</span>
                    </span>
                    <span className={styles.linkArrow} aria-hidden="true">
                      <ArrowIcon external={section.type !== 'CALL'} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyState}>
              No buttons yet. Add a link to a section and switch it on, and it appears here.
            </p>
          )}

          <div className={styles.feedbackLink}>
            <span className={styles.feedbackIcon} aria-hidden="true">
              <FeedbackIcon />
            </span>
            <span>Send private feedback</span>
            <span className={styles.feedbackArrow} aria-hidden="true">
              <ArrowIcon external={false} />
            </span>
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
        </div>
      </Card>

      <p className="text-sm text-ink-muted">
        Every visitor is also offered private feedback, which is always available and is not
        something this screen can switch off (D-010).
      </p>
    </div>
  );
}

function businessInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'DH';
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : (words[0]?.[1] ?? '');
  return `${first}${last}`.toLocaleUpperCase().slice(0, 2);
}

function SectionIcon({ type }: { type: SectionType }) {
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
