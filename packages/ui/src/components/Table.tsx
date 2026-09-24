import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * Data table with the responsive stacked mobile mode the design brief requires.
 *
 * The stacked mode is a CSS display change on the same markup, not a second rendering of the
 * data — duplicating the rows behind `hidden` / `md:block` makes every screen reader read the
 * table twice and doubles what the browser lays out.
 *
 * That choice has one consequence which has to be handled explicitly. Setting `display: block`
 * on a `<table>` destroys its accessibility semantics: the browser stops exposing rows,
 * columns and header relationships entirely, so a stacked table becomes an unstructured pile of
 * text. Every element therefore carries its ARIA role literally (`table`, `rowgroup`, `row`,
 * `columnheader`, `rowheader`, `cell`), which is what re-establishes the grid the display
 * change removed. They are redundant on desktop and load-bearing on a phone.
 *
 * The per-cell labels shown in stacked mode are `aria-hidden`: the column association already
 * survives through the roles above, so exposing them would make every cell announce its header
 * twice.
 */

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /**
   * Label shown beside the value in stacked mobile mode. Required when `header` is not a plain
   * string, because there is nothing sensible to fall back to.
   */
  mobileLabel?: string;
  align?: 'start' | 'end';
  /**
   * The column that names the row — the business name, the QR label. Rendered as a row header
   * so screen readers can announce which row a cell belongs to. At most one per table.
   */
  isRowHeader?: boolean;
  className?: string;
}

export interface TableProps<T> {
  /** Accessible name for the table. Required: an unnamed table is unnavigable by keyboard. */
  caption: string;
  captionVisible?: boolean;
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Shown in place of rows when there are none — usually an `EmptyState`. */
  empty?: ReactNode;
  stackOnMobile?: boolean;
  className?: string;
}

function mobileLabelFor<T>(column: TableColumn<T>): string {
  if (column.mobileLabel !== undefined) return column.mobileLabel;
  return typeof column.header === 'string' ? column.header : '';
}

export function Table<T>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  empty,
  stackOnMobile = true,
  className,
}: TableProps<T>) {
  const alignOf = (column: TableColumn<T>): string =>
    column.align === 'end' ? 'text-end' : 'text-start';

  return (
    <div className={cx('ui-table', !stackOnMobile && 'overflow-x-auto', className)}>
      <table
        role="table"
        className={cx('w-full border-collapse text-sm text-ink', stackOnMobile && 'max-md:block')}
      >
        <caption
          className={cx(
            captionVisible ? 'mb-2 text-start text-sm text-ink-muted' : 'sr-only',
            stackOnMobile && 'max-md:block',
          )}
        >
          {caption}
        </caption>

        <thead role="rowgroup" className={cx(stackOnMobile && 'max-md:hidden')}>
          <tr role="row" className="border-b border-line">
            {columns.map((column) => (
              <th
                key={column.key}
                role="columnheader"
                scope="col"
                className={cx(
                  'px-3 py-2 font-semibold text-ink-muted',
                  alignOf(column),
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody role="rowgroup" className={cx(stackOnMobile && 'max-md:block')}>
          {rows.length === 0 && (
            <tr role="row" className={cx(stackOnMobile && 'max-md:block')}>
              <td
                role="cell"
                colSpan={columns.length}
                className={cx('px-3 py-6', stackOnMobile && 'max-md:block')}
              >
                {empty}
              </td>
            </tr>
          )}

          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              role="row"
              className={cx(
                'border-b border-line last:border-b-0',
                stackOnMobile &&
                  'max-md:mb-3 max-md:block max-md:rounded-card max-md:border max-md:p-2',
              )}
            >
              {columns.map((column) => {
                const label = mobileLabelFor(column);
                const content = (
                  <>
                    {stackOnMobile && label !== '' && (
                      <span className="font-medium text-ink-muted md:hidden" aria-hidden="true">
                        {label}
                      </span>
                    )}
                    <span className="min-w-0 [overflow-wrap:anywhere]">{column.cell(row)}</span>
                  </>
                );

                const cellClassName = cx(
                  'px-3 py-2 align-middle',
                  alignOf(column),
                  stackOnMobile &&
                    'max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4 max-md:px-1 max-md:py-1.5 max-md:text-start',
                  column.className,
                );

                return column.isRowHeader ? (
                  <th
                    key={column.key}
                    role="rowheader"
                    scope="row"
                    className={cx(cellClassName, 'font-semibold')}
                  >
                    {content}
                  </th>
                ) : (
                  <td key={column.key} role="cell" className={cellClassName}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
