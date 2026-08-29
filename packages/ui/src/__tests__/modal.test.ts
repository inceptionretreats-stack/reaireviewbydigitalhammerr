// @vitest-environment jsdom

import { createElement as h, createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../components/Modal';

/**
 * AC-037 for the two dialogs. A modal that does not trap focus lets a keyboard user tab into
 * the page behind it and operate controls they cannot see; one that does not restore focus on
 * close drops them back at the top of the document. Both are silent failures — everything looks
 * right on screen — so they are pinned here.
 */

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

interface HarnessOptions {
  open?: boolean;
  onClose?: () => void;
  dismissOnBackdrop?: boolean;
}

const modal = (options: HarnessOptions = {}) =>
  h(Modal, {
    open: options.open ?? true,
    onClose: options.onClose ?? (() => undefined),
    title: 'Edit customer',
    dismissOnBackdrop: options.dismissOnBackdrop,
    children: h(
      'div',
      null,
      h('button', { type: 'button' }, 'First'),
      h('button', { type: 'button' }, 'Second'),
    ),
    footer: h('button', { type: 'button' }, 'Save'),
  });

const button = (name: string) => screen.getByRole('button', { name });

describe('Modal', () => {
  it('exposes a labelled modal dialog', () => {
    render(modal());

    const dialog = screen.getByRole('dialog', { name: 'Edit customer' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('renders nothing while closed', () => {
    render(modal({ open: false }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus into the dialog on open', () => {
    render(modal());

    expect(document.activeElement).toBe(button('Close'));
  });

  it('honours an explicit initial focus target', () => {
    const ref = createRef<HTMLInputElement>();

    render(
      h(Modal, {
        open: true,
        onClose: () => undefined,
        title: 'Edit customer',
        initialFocusRef: ref,
        children: h('input', { ref, 'aria-label': 'Customer name' }),
      }),
    );

    expect(document.activeElement).toBe(ref.current);
  });

  it('wraps focus forwards from the last control to the first', () => {
    render(modal());

    const save = button('Save');
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });

    expect(document.activeElement).toBe(button('Close'));
  });

  it('wraps focus backwards from the first control to the last', () => {
    render(modal());

    const close = button('Close');
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(button('Save'));
  });

  /** The trap must only intervene at the two ends, or it breaks ordinary tabbing inside. */
  it('leaves a Tab in the middle of the dialog alone', () => {
    render(modal());

    const first = button('First');
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab' });

    expect(document.activeElement).toBe(first);
  });

  it('pulls focus back when it has escaped the dialog', () => {
    render(modal());

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });

    expect(document.activeElement).toBe(button('Close'));
    outside.remove();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(modal({ onClose }));

    fireEvent.keyDown(button('First'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on any other key', () => {
    const onClose = vi.fn();
    render(modal({ onClose }));

    fireEvent.keyDown(button('First'), { key: 'Enter' });
    fireEvent.keyDown(button('First'), { key: ' ' });
    fireEvent.keyDown(button('First'), { key: 'Tab' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(modal({ onClose }));

    fireEvent.click(button('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click by default and not when that is turned off', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(modal({ onClose }));

    const backdrop = container.querySelector('div[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(modal({ onClose, dismissOnBackdrop: false }));
    fireEvent.click(container.querySelector('div[aria-hidden="true"]') as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to whatever opened it', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { rerender } = render(modal());
    expect(document.activeElement).not.toBe(trigger);

    rerender(modal({ open: false }));

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('locks and restores background scrolling', () => {
    document.body.style.overflow = 'auto';

    const { rerender } = render(modal());
    expect(document.body.style.overflow).toBe('hidden');

    rerender(modal({ open: false }));
    expect(document.body.style.overflow).toBe('auto');
  });
});
