/**
 * The view model REQ-01's screen hands to its client half.
 *
 * Timestamps travel twice, once as an ISO instant for `<time dateTime>` and once as a string already
 * formatted in the business's timezone. Formatting is done wherever the row is created — on the
 * server for history, in the browser for a request just prepared — because a client component that
 * formatted an instant during hydration would be comparing Node's ICU output with the browser's, and
 * a mismatch there is a hydration error over a date separator. `components/dashboard/presentation.ts`
 * makes the same choice for the same reason.
 */

export interface CustomerOption {
  id: string;
  name: string;
  /** E.164 where CRM-01-03 normalized it. Shown so the owner can confirm who they are messaging. */
  mobile: string;
}

export interface RequestRowView {
  id: string;
  customerId: string;
  customerName: string;
  preparedAtIso: string;
  preparedAtLabel: string;
  /** Non-null only once the owner has said they sent it themselves (AC-023). */
  markedSentAtIso: string | null;
  markedSentAtLabel: string | null;
  /** First open of the tracked link. The furthest thing this product can observe (D-028, AC-025). */
  firstClickedAtIso: string | null;
  firstClickedAtLabel: string | null;
  /** Exactly what was prepared, including the tracked link, so it can be copied again verbatim. */
  renderedMessage: string;
  /** Recovered from the message; null when the owner's template left `{review_link}` out. */
  reviewLink: string | null;
  /** null when the stored mobile is not one WhatsApp can open (REQ-01-01, "where valid"). */
  whatsappUrl: string | null;
}
