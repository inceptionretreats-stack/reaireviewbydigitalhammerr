// @vitest-environment jsdom

import { createElement as h } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Table, type TableColumn, type TableProps } from '../components/Table';

/**
 * The responsive stacked mobile mode, and the semantics it would otherwise destroy.
 *
 * Setting `display: block` on a table removes its rows, columns and header relationships from
 * the accessibility tree. The explicit ARIA roles are what put them back, so they are asserted
 * here rather than treated as decoration: without them the mobile view is a wall of unlabelled
 * text, and nothing about the rendered page looks wrong.
 */

interface Row {
  id: string;
  name: string;
  opens: number;
}

const ROWS: readonly Row[] = [
  { id: 'a', name: 'Counter QR', opens: 12 },
  { id: 'b', name: 'Table tent', opens: 4 },
];

const COLUMNS: readonly TableColumn<Row>[] = [
  { key: 'name', header: 'Source', cell: (row) => row.name, isRowHeader: true },
  { key: 'opens', header: 'Google review page opened', cell: (row) => row.opens, align: 'end' },
];

const RowTable = Table<Row>;

const renderTable = (overrides: Partial<TableProps<Row>> = {}) =>
  render(
    h(RowTable, {
      caption: 'QR sources',
      columns: COLUMNS,
      rows: ROWS,
      rowKey: (row) => row.id,
      ...overrides,
    }),
  );

const mobileLabels = (container: HTMLElement): readonly string[] =>
  Array.from(container.querySelectorAll('span[aria-hidden="true"]')).map(
    (span) => span.textContent ?? '',
  );

afterEach(cleanup);

describe('Table', () => {
  it('is named by its caption, which is available but not displayed by default', () => {
    const { container } = renderTable();

    expect(screen.getByRole('table', { name: 'QR sources' })).toBeTruthy();
    expect(container.querySelector('caption')?.className).toContain('sr-only');
  });

  it('shows the caption when asked to', () => {
    const { container } = renderTable({ captionVisible: true });

    expect(container.querySelector('caption')?.className).not.toContain('sr-only');
  });

  it('carries the grid roles explicitly so the stacked mobile layout keeps its semantics', () => {
    const { container } = renderTable();

    expect(container.querySelector('table')?.getAttribute('role')).toBe('table');
    expect(
      Array.from(container.querySelectorAll('thead,tbody')).map((el) => el.getAttribute('role')),
    ).toEqual(['rowgroup', 'rowgroup']);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
    expect(screen.getAllByRole('cell')).toHaveLength(2);
  });

  it('renders the column marked as the row header as a scoped th', () => {
    renderTable();

    const rowHeader = screen.getAllByRole('rowheader')[0];
    expect(rowHeader?.tagName).toBe('TH');
    expect(rowHeader?.getAttribute('scope')).toBe('row');
    expect(rowHeader?.textContent).toContain('Counter QR');
  });

  it('repeats each column header beside its value in stacked mode, hidden above the breakpoint', () => {
    const { container } = renderTable();

    const labels = container.querySelectorAll('span[aria-hidden="true"]');
    // One per cell across both rows.
    expect(labels).toHaveLength(4);
    expect(mobileLabels(container)).toEqual([
      'Source',
      'Google review page opened',
      'Source',
      'Google review page opened',
    ]);
    expect(labels[0]?.className).toContain('md:hidden');
  });

  /**
   * The labels are aria-hidden on purpose: the roles above already associate each cell with its
   * column, so exposing them would make every cell announce its header twice.
   */
  it('hides the stacked labels from assistive technology', () => {
    const { container } = renderTable();

    for (const label of container.querySelectorAll('td span, th span')) {
      const isLabel = label.className.includes('md:hidden');
      if (isLabel) expect(label.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('falls back to an explicit mobileLabel when the header is not plain text', () => {
    const { container } = renderTable({
      columns: [
        {
          key: 'name',
          header: h('span', null, 'Source'),
          mobileLabel: 'QR source',
          cell: (row: Row) => row.name,
        },
      ],
    });

    expect(mobileLabels(container)).toEqual(['QR source', 'QR source']);
  });

  it('omits the label when a non-text header has no mobileLabel rather than inventing one', () => {
    const { container } = renderTable({
      columns: [{ key: 'name', header: h('span', null, 'Source'), cell: (row: Row) => row.name }],
    });

    expect(mobileLabels(container)).toEqual([]);
  });

  it('drops the stacked labels and scrolls horizontally instead when stacking is off', () => {
    const { container } = renderTable({ stackOnMobile: false });

    expect(mobileLabels(container)).toEqual([]);
    expect(container.firstElementChild?.className).toContain('overflow-x-auto');
    expect(container.querySelector('table')?.className).not.toContain('max-md:block');
  });

  it('renders the empty state across the full width when there are no rows', () => {
    renderTable({ rows: [], empty: h('p', null, 'No QR sources yet') });

    expect(screen.getByText('No QR sources yet')).toBeTruthy();
    expect(screen.getAllByRole('cell')[0]?.getAttribute('colspan')).toBe('2');
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });

  it('renders each row through its cell functions', () => {
    renderTable();

    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Table tent')).toBeTruthy();
  });
});
