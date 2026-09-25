/**
 * Class fragments for links that carry the weight of a button.
 *
 * The kit's `Button` renders a `<button>`, which is correct for it: a button performs an action.
 * Every primary control on this screen navigates instead — continue setup, open the public page
 * — and a navigation has to be an `<a>`. Not for tidiness: an anchor is announced as a link, is
 * openable in a new tab, and works with middle-click and copy-link, none of which a
 * `button onClick={router.push}` can do. AC-037 is about keyboard operation, and hijacking
 * navigation into a button is how that quietly breaks.
 *
 * The values mirror `Button`'s primary and secondary variants plus the shared `FOCUS_RING` and
 * `TOUCH_TARGET` from `@ai-review/ui`. Every class name is written out in full, because Tailwind
 * discovers them by scanning source text — a name interpolated from a variable would never be
 * generated, and that failure surfaces as unstyled markup rather than as a build error.
 */

const SHARED =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border px-4 ' +
  'text-base font-semibold no-underline transition-colors ' +
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const PRIMARY_LINK =
  SHARED + ' border-transparent bg-accent text-on-accent hover:bg-accent-hover';

export const SECONDARY_LINK = SHARED + ' border-line-strong bg-bg text-ink hover:bg-surface';

/**
 * An ordinary inline link that navigates (used on the Ai screens).
 *
 * An `<a>` and not a `Button`, because it navigates: an anchor is announced as a link, opens in a
 * new tab, and works with middle-click and copy-link, none of which a `button onClick={push}` does.
 * Hijacking navigation into a button is one of the quiet ways AC-037 breaks.
 */
export const TEXT_LINK =
  'rounded font-semibold text-accent underline underline-offset-4 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
