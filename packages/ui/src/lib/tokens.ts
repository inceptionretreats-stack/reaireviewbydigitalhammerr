/**
 * Class fragments shared by every interactive primitive.
 *
 * These exist as constants rather than being repeated per component because AC-037 (visible
 * focus on every primary action) and the 44x44 minimum touch target in
 * `18_UI_UX_Design_System_Brief.md` are properties of the *kit*, not of any one component. A
 * single definition means a new primitive cannot quietly ship without them, and a change to the
 * focus treatment cannot half-apply.
 */

/** AC-037. Mirrors the `outline: 3px / offset 2px` treatment in apps/web/app/globals.css. */
export const FOCUS_RING =
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * 44x44 CSS px is the design brief's minimum for primary mobile controls (WCAG 2.2 SC 2.5.8
 * asks for 24x24; the brief is stricter, so the brief wins). `min-h-11` is 2.75rem = 44px.
 */
export const TOUCH_TARGET = 'min-h-11';

/** Shared shell for text-entry controls: input, textarea, select, tag input. */
export const CONTROL_SURFACE =
  'w-full rounded-control border border-line-strong bg-bg px-3 py-2 text-ink ' +
  'placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-muted';

/**
 * Invalid state. The red border is paired with an icon and message in `InlineError`, never used
 * alone — 18_UI_UX_Design_System_Brief.md forbids conveying status by colour only.
 */
export const CONTROL_INVALID =
  'aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft';

/**
 * The same ring driven by a `peer` input, for controls whose real `<input>` is `sr-only` and
 * whose visible surface is a sibling (`Toggle`).
 *
 * Spelled out as a literal rather than derived from `FOCUS_RING` at runtime: Tailwind extracts
 * class names by scanning source text, so a class produced by `String.replaceAll` would never
 * be generated.
 */
export const PEER_FOCUS_RING =
  'peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent';
