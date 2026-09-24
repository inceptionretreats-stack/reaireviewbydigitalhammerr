import Link from 'next/link';
import { EmptyState } from '@ai-review/ui';
import {
  DEFAULT_FEEDBACK_FILTERS,
  feedbackScreenHref,
  type FeedbackFilters,
} from '@/lib/feedback/filters';
import type { PublicFormState } from '@/lib/feedback/row';
import { PRIMARY_LINK, SECONDARY_LINK } from '../link-styles';

/**
 * FB-02's `empty` state — two of them, because "we have never received any" and "none matches what
 * you asked for" are different facts and only one of them is about the merchant's filters.
 *
 * The first is the normal state of a business that published yesterday, so it explains what private
 * feedback is and how a customer reaches it rather than reporting no results. The framing matters
 * beyond tone: there is no sentiment question anywhere in the customer flow (D-009, AC-006), so
 * private feedback is offered to every visitor equally (D-010, AC-024, Flow G step 1). An inbox that
 * called these "complaints" or "unhappy customers" would describe a product that does not exist, and
 * would push an owner towards the diversion 13_Security_Privacy_Compliance.md rule 3 forbids.
 */

export interface NoFeedbackYetProps {
  /**
   * Whether the public form is actually reachable, and its address when it is.
   *
   * Decided by `publicFormState` from the tenant's lifecycle, not from whether a slug exists: ONB-01
   * reserves the slug at the identity save, so a DRAFT business has an address that serves the
   * Flow J unavailable page. Sending an owner there while hiding "publish your page" misdirects
   * exactly the business this state was written for.
   */
  publicForm: PublicFormState;
}

export function NoFeedbackYet({ publicForm }: NoFeedbackYetProps) {
  return (
    <EmptyState
      title="No private feedback yet"
      description={
        <span className="flex flex-col gap-3 text-start">
          <span>
            Private feedback is the second choice on your public review page. Anyone who visits can
            write to you instead of, or as well as, going to Google — it is offered to every
            visitor, not only to people who had a bad experience. Nobody is asked to rate you first.
          </span>
          <span>
            Whatever they write arrives here. It is never published, and only your business can read
            it. If they leave a name or a mobile number, those appear on this screen and nowhere
            else.
          </span>
          <span>
            An empty inbox is completely normal for a new business, and it does not mean anything is
            wrong with your page.
          </span>
          {publicForm.kind === 'draft' && (
            <span>
              Your page is not published yet, so there is nowhere for a customer to write to you.
              Publish it to start receiving messages — you can finish setup from the dashboard.
            </span>
          )}
          {publicForm.kind === 'not-serving' && (
            // No cause given, because this screen does not know it. SUSPENDED, CLOSED and an
            // ACTIVE business with no address all land here, and "publish your page" would be
            // false for the first two.
            <span>
              Your public page is not serving customers at the moment, so nobody can reach the form.
              Your dashboard shows where things stand.
            </span>
          )}
        </span>
      }
      action={
        publicForm.kind === 'live' ? (
          // Opens the real form, not a mock-up: the fastest way for an owner to understand what
          // their customer is offered is to look at it. Only ever rendered for an ACTIVE tenant,
          // so the link cannot land on the Flow J unavailable page.
          <a
            href={publicForm.url}
            target="_blank"
            rel="noopener noreferrer"
            className={PRIMARY_LINK}
          >
            See what your customers see
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <Link href="/app" className={PRIMARY_LINK}>
            Go to your dashboard
          </Link>
        )
      }
    />
  );
}

export interface NoMatchingFeedbackProps {
  filters: FeedbackFilters;
}

export function NoMatchingFeedback({ filters }: NoMatchingFeedbackProps) {
  return (
    <EmptyState
      title="No messages match these filters"
      description={
        <span className="flex flex-col gap-3 text-start">
          {/*
            Says only what this screen can see. The counts behind it are scoped to the selected
            dates (`inbox.ts` selectCounts), so a total of zero in a range is no evidence that
            anything ever arrived — telling a brand-new business it "has received feedback before"
            would be inventing a fact about its data.
          */}
          <span>
            Nothing here matches the dates and status you selected. Try widening the dates or
            changing the status.
          </span>
          {filters.status === 'inbox' && (
            // Said explicitly, because the default view hides archived messages and an owner who
            // has archived everything would otherwise read this as their feedback being gone.
            <span>
              Your inbox shows new and read messages. Anything you archived is still there under the
              Archived filter — archiving never deletes a customer&rsquo;s message.
            </span>
          )}
        </span>
      }
      action={
        <Link href={feedbackScreenHref(DEFAULT_FEEDBACK_FILTERS)} className={SECONDARY_LINK}>
          Clear filters
        </Link>
      }
    />
  );
}
