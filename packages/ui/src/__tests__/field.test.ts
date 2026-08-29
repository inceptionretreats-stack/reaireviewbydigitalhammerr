// @vitest-environment jsdom

import { createElement as h } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field, type FieldControlProps } from '../components/Field';
import { Input } from '../components/Input';

/**
 * `Field` is the component the accessibility acceptance criteria actually rest on: AC-037 asks
 * for keyboard-operable controls with visible focus, and `18_UI_UX_Design_System_Brief.md`
 * forbids placeholder-only labels. Everything below is about the wiring being present and
 * pointing at the right elements — the failure mode is a field that looks correct and is
 * unusable with a screen reader.
 *
 * Tests are written with `createElement` rather than JSX because the shared Vitest config picks
 * up `**\/*.test.ts` only.
 */

afterEach(cleanup);

const renderField = (props: Partial<Parameters<typeof Field>[0]> = {}) =>
  render(
    h(Field, {
      label: 'Business name',
      children: (control: FieldControlProps) => h(Input, { ...control, defaultValue: '' }),
      ...props,
    }),
  );

function describedByIds(element: Element): readonly string[] {
  const value = element.getAttribute('aria-describedby');
  return value === null ? [] : value.split(' ');
}

describe('Field', () => {
  it('gives the control a real label that points at it', () => {
    const { container } = renderField();

    const label = container.querySelector('label');
    const input = screen.getByLabelText(/Business name/);

    expect(label).not.toBeNull();
    expect(input.id).not.toBe('');
    expect(label?.getAttribute('for')).toBe(input.id);
  });

  it('describes the control with its hint', () => {
    renderField({ hint: 'Shown on your public page' });

    const input = screen.getByLabelText(/Business name/);
    const ids = describedByIds(input);

    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0] ?? '')?.textContent).toBe('Shown on your public page');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('marks the control invalid and describes it with the error', () => {
    renderField({ error: 'Enter a business name' });

    const input = screen.getByLabelText(/Business name/);
    const ids = describedByIds(input);

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0] ?? '')?.textContent).toContain('Enter a business name');
    expect(screen.getByRole('alert').textContent).toContain('Enter a business name');
  });

  /** Both, in error-first order: the correction is the part that has to be heard first. */
  it('describes the control with the error before the hint when both are present', () => {
    renderField({ hint: 'Shown on your public page', error: 'Enter a business name' });

    const input = screen.getByLabelText(/Business name/);
    const [first, second] = describedByIds(input);

    expect(document.getElementById(first ?? '')?.textContent).toContain('Enter a business name');
    expect(document.getElementById(second ?? '')?.textContent).toBe('Shown on your public page');
  });

  it('omits aria-describedby entirely when there is nothing to describe', () => {
    renderField();

    expect(screen.getByLabelText(/Business name/).getAttribute('aria-describedby')).toBeNull();
  });

  it('marks a required control for both sighted and screen-reader users', () => {
    const { container } = renderField({ required: true });

    const input = screen.getByLabelText(/Business name/);
    expect(input.hasAttribute('required')).toBe(true);
    // The asterisk alone is not an accessible marker, so the word has to be there too.
    expect(container.querySelector('label')?.textContent).toContain('(required)');
  });

  it('keeps the label available to assistive technology when it is visually hidden', () => {
    const { container } = renderField({ labelHidden: true });

    expect(container.querySelector('label')?.className).toContain('sr-only');
    expect(screen.getByLabelText(/Business name/)).toBeTruthy();
  });

  it('gives each instance its own ids so two fields on a page cannot collide', () => {
    const { container } = render(
      h(
        'form',
        null,
        h(Field, {
          label: 'City',
          error: 'Required',
          children: (control: FieldControlProps) => h(Input, control),
        }),
        h(Field, {
          label: 'State',
          error: 'Required',
          children: (control: FieldControlProps) => h(Input, control),
        }),
      ),
    );

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'));
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.id).not.toBe(inputs[1]?.id);
    expect(inputs[0]?.getAttribute('aria-describedby')).not.toBe(
      inputs[1]?.getAttribute('aria-describedby'),
    );
  });
});
