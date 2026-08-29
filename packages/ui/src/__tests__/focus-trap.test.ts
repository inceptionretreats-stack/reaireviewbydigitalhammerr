// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFocusTrap, getFocusableElements } from '../lib/focus-trap';

/**
 * The DOM half of the dialog behaviour, tested without React so that a regression points at the
 * trap rather than at a component's effects.
 */

function mount(html: string): HTMLElement {
  const container = document.createElement('div');
  container.tabIndex = -1;
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

function tabEvent(shiftKey = false) {
  return { key: 'Tab', shiftKey, preventDefault: vi.fn() };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('getFocusableElements', () => {
  it('returns the reachable controls in document order', () => {
    const container = mount(`
      <a href="/one">one</a>
      <button type="button">two</button>
      <input />
      <select></select>
      <textarea></textarea>
      <div tabindex="0">five</div>
    `);

    expect(getFocusableElements(container).map((el) => el.tagName)).toEqual([
      'A',
      'BUTTON',
      'INPUT',
      'SELECT',
      'TEXTAREA',
      'DIV',
    ]);
  });

  it('skips disabled controls, anchors with no href, and tabindex="-1"', () => {
    const container = mount(`
      <button type="button" disabled>no</button>
      <input disabled />
      <a>no href</a>
      <div tabindex="-1">no</div>
      <button type="button">yes</button>
    `);

    const focusable = getFocusableElements(container);

    expect(focusable).toHaveLength(1);
    expect(focusable[0]?.textContent).toBe('yes');
  });

  /** A control inside a hidden subtree is not reachable, so tabbing must not land on it. */
  it('skips controls hidden from assistive technology or from rendering', () => {
    const container = mount(`
      <div hidden><button type="button">hidden</button></div>
      <div aria-hidden="true"><button type="button">aria-hidden</button></div>
      <button type="button">visible</button>
    `);

    const focusable = getFocusableElements(container);

    expect(focusable).toHaveLength(1);
    expect(focusable[0]?.textContent).toBe('visible');
  });
});

describe('createFocusTrap', () => {
  it('ignores keys other than Tab', () => {
    const container = mount('<button type="button">a</button>');
    const event = { key: 'a', shiftKey: false, preventDefault: vi.fn() };

    expect(createFocusTrap(container).handleTab(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('wraps forwards from the last control and backwards from the first', () => {
    const container = mount(`
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    `);
    const [first, middle, last] = getFocusableElements(container);
    const trap = createFocusTrap(container);

    last?.focus();
    const forwards = tabEvent();
    expect(trap.handleTab(forwards)).toBe(true);
    expect(forwards.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(first);

    first?.focus();
    const backwards = tabEvent(true);
    expect(trap.handleTab(backwards)).toBe(true);
    expect(document.activeElement).toBe(last);

    middle?.focus();
    const middleTab = tabEvent();
    expect(trap.handleTab(middleTab)).toBe(false);
    expect(middleTab.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(middle);
  });

  it('recaptures focus that has left the container', () => {
    const container = mount('<button type="button">inside</button>');
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    const event = tabEvent();
    expect(createFocusTrap(container).handleTab(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(getFocusableElements(container)[0]);
  });

  it('recaptures backwards to the last control', () => {
    const container = mount(`
      <button type="button">first</button>
      <button type="button">last</button>
    `);
    document.body.focus();

    createFocusTrap(container).handleTab(tabEvent(true));

    expect(document.activeElement?.textContent).toBe('last');
  });

  /** A dialog with nothing focusable inside still must not leak focus to the page behind it. */
  it('holds focus on the container when it contains nothing focusable', () => {
    const container = mount('<p>Nothing to focus here.</p>');
    const event = tabEvent();

    expect(createFocusTrap(container).handleTab(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(container);
  });

  it('focusFirst moves focus to the first control, or to the container when there is none', () => {
    const withControl = mount('<button type="button">only</button>');
    createFocusTrap(withControl).focusFirst();
    expect(document.activeElement?.textContent).toBe('only');

    const withoutControl = mount('<p>text</p>');
    createFocusTrap(withoutControl).focusFirst();
    expect(document.activeElement).toBe(withoutControl);
  });
});
