// @vitest-environment jsdom

import { createElement as h, useState, type FormEvent, type FormEventHandler } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field, type FieldControlProps } from '../components/Field';
import { TagInput } from '../components/TagInput';
import type { TagRules } from '../lib/tags';

/**
 * The AI context terms control (ONB-04 / AI-01, 0-30 items).
 *
 * Rendered through `Field` here rather than standalone, because that composition is how it is
 * used and because the label/describedby handover between the two is the part most likely to
 * break. The rules themselves are covered directly in tags.test.ts.
 */

afterEach(cleanup);

interface HarnessProps {
  initial?: readonly string[];
  rules?: TagRules;
  onSubmit?: FormEventHandler<HTMLFormElement>;
}

function Harness({ initial = [], rules, onSubmit }: HarnessProps) {
  const [tags, setTags] = useState<readonly string[]>(initial);

  return h(
    'form',
    { onSubmit },
    h(Field, {
      label: 'Context terms',
      hint: 'Optional',
      children: (control: FieldControlProps) =>
        h(TagInput, { ...control, value: tags, onChange: setTags, rules }),
    }),
  );
}

const input = () => screen.getByLabelText(/Context terms/);
const chips = () => screen.queryAllByRole('listitem');
// The chip's first span holds the term; the rest of its text is the remove button's label.
const chipLabels = (): readonly string[] =>
  chips().map((chip: HTMLElement) => chip.firstElementChild?.textContent ?? '');
const status = () => screen.getByLabelText(/Context terms/).getAttribute('aria-describedby');

function type(value: string): void {
  fireEvent.change(input(), { target: { value } });
}

function statusText(): string {
  const ids = (status() ?? '').split(' ');
  const last = ids[ids.length - 1] ?? '';
  return document.getElementById(last)?.textContent ?? '';
}

describe('TagInput', () => {
  it('adds a term on Enter and clears the box', () => {
    render(h(Harness));

    type('  Filter Coffee  ');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(chipLabels()).toEqual(['Filter Coffee']);
    expect((input() as HTMLInputElement).value).toBe('');
  });

  /** Enter inside a dashboard form would otherwise submit the whole page mid-edit. */
  it('does not submit the surrounding form when Enter commits a term', () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    render(h(Harness, { onSubmit }));

    type('chai');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(chips()).toHaveLength(1);
  });

  it('adds a term on comma', () => {
    render(h(Harness));

    type('chai');
    fireEvent.keyDown(input(), { key: ',' });

    expect(chips()).toHaveLength(1);
  });

  it('commits a typed term on blur so it is not silently lost on save', () => {
    render(h(Harness));

    type('chai');
    fireEvent.blur(input());

    expect(chipLabels()).toEqual(['chai']);
  });

  it('rejects a duplicate regardless of case and says why', () => {
    render(h(Harness, { initial: ['Chai'] }));

    type('chai');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(chips()).toHaveLength(1);
    expect(statusText()).toMatch(/already in the list/i);
  });

  it('stops at the maximum and explains the limit', () => {
    const rules: TagRules = { maxItems: 2, maxTagLength: 80 };
    render(h(Harness, { initial: ['one', 'two'], rules }));

    type('three');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(chips()).toHaveLength(2);
    expect(statusText()).toContain('2');
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true);
  });

  it('reports how many of the allowed terms are used', () => {
    render(h(Harness, { initial: ['one'] }));

    expect(statusText()).toContain('1 of 30');
  });

  it('removes a term from its chip and keeps focus in the control', () => {
    render(h(Harness, { initial: ['chai', 'filter coffee'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove chai' }));

    expect(chipLabels()).toEqual(['filter coffee']);
    expect(document.activeElement).toBe(input());
  });

  it('removes the last term on Backspace only when the box is empty', () => {
    render(h(Harness, { initial: ['chai', 'filter coffee'] }));

    type('espresso');
    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(chips()).toHaveLength(2);

    type('');
    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(chipLabels()).toEqual(['chai']);
  });

  it('is described by both the field hint and its own live status', () => {
    render(h(Harness, { initial: ['chai'] }));

    const ids = (status() ?? '').split(' ');
    expect(ids.length).toBe(2);

    const live = document.getElementById(ids[1] ?? '');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(document.getElementById(ids[0] ?? '')?.textContent).toBe('Optional');
  });

  /**
   * D-025 / AC-010. Context terms are hints to the model and never guaranteed output, and the
   * control says so. There is deliberately no "required term" affordance to find.
   */
  it('presents the terms as hints rather than as words the assistant must use', () => {
    render(h(Harness));

    expect(statusText()).toMatch(/not words it must use/i);
    expect(screen.queryByText(/mandatory|required keyword|must include/i)).toBeNull();
  });
});
