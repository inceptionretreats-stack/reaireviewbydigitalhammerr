/**
 * Keyboard focus containment for `Modal` and `Drawer` (AC-037).
 *
 * Framework-free DOM code so it can be tested directly rather than only through a rendered
 * component, matching the split used elsewhere in the repo between rules and their host.
 *
 * Visibility is judged from attributes (`hidden`, `inert`, `aria-hidden`, `disabled`) rather
 * than from layout. Geometry would be the more accurate test in a browser, but `offsetParent`
 * and `getClientRects()` report nothing under jsdom, which would make the trap untestable —
 * and an element that is laid out to zero size inside an open dialog is a styling bug rather
 * than a case the trap should be silently absorbing.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

function isReachable(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  return element.closest('[hidden],[inert],[aria-hidden="true"]') === null;
}

export function getFocusableElements(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isReachable,
  );
}

export interface FocusTrap {
  /** Handles Tab / Shift+Tab. Returns true when it moved focus and the event was consumed. */
  handleTab(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>): boolean;
  /** Moves focus into the trap. Used on open and when focus is found to have escaped. */
  focusFirst(): void;
}

export function createFocusTrap(container: HTMLElement): FocusTrap {
  const activeElement = (): Element | null => container.ownerDocument.activeElement;

  const focusFirst = (): void => {
    const focusable = getFocusableElements(container);
    const target = focusable[0];
    if (target) {
      target.focus();
      return;
    }

    // A dialog with nothing focusable inside still must not leak focus to the page behind it,
    // so the container itself takes focus. Callers give it tabindex="-1" for exactly this.
    container.focus();
  };

  const handleTab = (
    event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  ): boolean => {
    if (event.key !== 'Tab') return false;

    const focusable = getFocusableElements(container);
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return true;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // Non-null: `focusable.length > 0` was just established, so both ends exist.
    if (!first || !last) return false;

    const current = activeElement();

    // Focus outside the container (browser restored it elsewhere, or the container itself
    // holds it) is pulled back to whichever end the user is heading towards.
    if (current === null || !container.contains(current)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return true;
    }

    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
      return true;
    }

    if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
      return true;
    }

    return false;
  };

  return { handleTab, focusFirst };
}
