import { Card, StatusBadge } from '@ai-review/ui';
import { describeBusinessStatus, formatDate } from '../presentation';
import type { AccountSettings } from './account';

/**
 * SET-01's "Business status" field — informational, which is why this is not a client component.
 *
 * The status is read, not set: DRAFT becomes ACTIVE by publishing (ONB-05), and SUSPENDED or CLOSED
 * is an admin decision with an audited reason behind it (Flow J, ADMIN-02-03). A control here would
 * either do nothing or quietly undo a suspension.
 *
 * `describeBusinessStatus` is shared with the dashboard rather than reworded, so a tenant is never
 * called "Live" on one screen and "Published" on another.
 *
 * There is deliberately no close-account button. Flow J describes closure as a soft-delete with a
 * grace period before purge, SET-01's button list does not include it, and no endpoint implements
 * it — a button that only looked like it worked would be worse than the sentence below saying who
 * to ask.
 */

export interface BusinessStatusCardProps {
  business: AccountSettings['business'];
}

export function BusinessStatusCard({ business }: BusinessStatusCardProps) {
  const status = describeBusinessStatus(business.status);
  // AMENDMENT-004 / AC-026: dates render in the business's own timezone, formatted on the server so
  // it does not depend on where the owner's laptop thinks it is.
  const liveSince = status.isPubliclyLive
    ? formatDate(business.publishedAt, business.timezone)
    : null;

  return (
    <Card
      title="Business status"
      titleAs="h2"
      description={business.name}
      footer={liveSince ? `Live since ${liveSince}.` : undefined}
    >
      <div className="flex flex-col gap-3">
        {/* Badge plus sentence: the state is a word and a glyph, never a colour on its own. */}
        <StatusBadge status={status.badge} label={status.label} className="self-start" />
        <p className="text-sm text-ink-muted">{status.note}</p>
        <p className="text-sm text-ink-muted">
          Closing a business or an account is handled by Digital Hammerr — there is no button for it
          here. Get in touch and we will take you through it.
        </p>
      </div>
    </Card>
  );
}
