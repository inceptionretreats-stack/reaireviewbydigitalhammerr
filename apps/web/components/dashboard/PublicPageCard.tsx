import { Card, EmptyState } from '@ai-review/ui';
import { CopyLinkButton } from './CopyLinkButton';
import { SECONDARY_LINK } from './link-styles';

/**
 * The tenant's canonical public address (PUB-01), which is the one thing an owner comes here to
 * fetch — it goes on a standee, a bill, a WhatsApp message.
 *
 * Copy and Open appear only once the business is live, because `lib/public-business.ts` resolves
 * only an ACTIVE tenant: handing over a link that answers "unavailable" is worse than saying it is
 * not live yet. The reserved address is still shown while in draft, since it is chosen in ONB-01
 * and an owner reasonably wants to see what they claimed.
 *
 * Only the primary slug is ever shown. Retired slugs keep redirecting for their retention window
 * (Flow I, AMENDMENT-005), but presenting one as the address is how it ends up printed.
 */

export interface PublicPageCardProps {
  /** Absolute URL, or null while ONB-01 has not reserved a slug. */
  publicUrl: string | null;
  isLive: boolean;
  /** What the current business status means, from `describeBusinessStatus`. */
  statusNote: string;
  /** Formatted `businesses.published_at`, when the page is live. */
  liveSince: string | null;
}

export function PublicPageCard({ publicUrl, isLive, statusNote, liveSince }: PublicPageCardProps) {
  if (!publicUrl) {
    return (
      <Card title="Your public page" titleAs="h2">
        <EmptyState
          title="No web address yet"
          description={
            <>
              You choose your address in the first setup step. It becomes your public page and the
              destination every QR code points at.
            </>
          }
        />
      </Card>
    );
  }

  return (
    <Card
      title="Your public page"
      titleAs="h2"
      description={statusNote}
      footer={liveSince ? `Live since ${liveSince}.` : undefined}
    >
      {/* break-all because a long slug on a narrow phone must wrap rather than widen the page. */}
      <p>
        <code className="rounded-control bg-surface px-2 py-1 font-mono text-sm break-all text-ink">
          {publicUrl}
        </code>
      </p>

      {isLive && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href={publicUrl} target="_blank" rel="noreferrer" className={SECONDARY_LINK}>
            Open page
            {/* The new tab is announced rather than left as a surprise change of context. */}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <CopyLinkButton value={publicUrl} what="your public page address" />
        </div>
      )}
    </Card>
  );
}
