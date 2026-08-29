'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { createFocusTrap } from './focus-trap';

/**
 * Shared modal behaviour for `Modal` and `Drawer`: focus containment, Escape, focus restoration
 * and background scroll locking (AC-037).
 *
 * The keydown handler is returned rather than attached to `document`. Focus is inside the panel
 * for as long as the dialog is open, so the event reaches the panel by bubbling; a document
 * listener would additionally have to reason about which of several open dialogs owns the key,
 * which is the usual source of "Escape closes the wrong one".
 */

export interface DialogBehaviourOptions {
  open: boolean;
  onClose: () => void;
  /** The element carrying `role="dialog"`. Focus is trapped inside it. */
  panelRef: RefObject<HTMLElement | null>;
  /** Where focus should land on open. Defaults to the first focusable element in the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
}

export interface DialogBehaviour {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function useDialogBehaviour(options: DialogBehaviourOptions): DialogBehaviour {
  const { open, onClose, panelRef, initialFocusRef, closeOnEscape = true } = options;

  // Read through a ref inside the effect so that a caller passing an inline arrow for onClose
  // does not tear down and re-run focus management on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    if (!panel) return;

    const doc = panel.ownerDocument;
    const previouslyFocused = doc.activeElement;

    const initial = initialFocusRef?.current;
    if (initial) {
      initial.focus();
    } else {
      createFocusTrap(panel).focusFirst();
    }

    return () => {
      // Returning focus to the control that opened the dialog is the half of the pattern that
      // is usually missing; without it a keyboard user restarts from the top of the document.
      // `isConnected` guards the case where that control was itself removed by the dialog's
      // action (deleting the row whose button opened it).
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open, panelRef, initialFocusRef]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const body = panel?.ownerDocument.body ?? null;
    if (!body) return;

    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [open, panelRef]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const panel = panelRef.current;
      if (!panel) return;

      if (closeOnEscape && event.key === 'Escape') {
        // Stopped here so an Escape aimed at this dialog cannot also close a parent dialog or
        // cancel an editing state on the page behind it.
        event.stopPropagation();
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      createFocusTrap(panel).handleTab(event);
    },
    [closeOnEscape, panelRef],
  );

  return { onKeyDown };
}
