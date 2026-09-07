/**
 * The two class fragments the AI screens share.
 *
 * `components/dashboard/link-styles.ts` already holds the button-weight link styles and these
 * belong beside them; that file was outside this change, so they live here for now (a concern).
 *
 * Both are written out in full rather than composed from variables, for the reason `link-styles.ts`
 * gives: Tailwind discovers class names by scanning source text, so a name assembled at runtime is
 * never generated, and that failure surfaces as unstyled markup rather than as a build error.
 */

/**
 * An ordinary inline link that navigates.
 *
 * An `<a>` and not a `Button`, because it navigates: an anchor is announced as a link, opens in a
 * new tab, and works with middle-click and copy-link, none of which a `button onClick={push}` does.
 * Hijacking navigation into a button is one of the quiet ways AC-037 breaks.
 */
export const TEXT_LINK =
  'rounded font-semibold text-accent underline underline-offset-4 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * The example draft on AI-01, quoted rather than shown in an editable box: here it is a sample of
 * what a customer would be offered, and the box they actually type in belongs to the public flow.
 */
export const DRAFT_QUOTE =
  'rounded-card border border-line bg-surface p-3 text-sm whitespace-pre-line text-ink';
