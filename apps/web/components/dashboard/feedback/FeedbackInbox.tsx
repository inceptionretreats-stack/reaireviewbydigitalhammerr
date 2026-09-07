'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button, InlineError, StatusBadge, Table, type TableColumn } from '@ai-review/ui';
import {
  DEFAULT_PAGE_SIZE,
  FEEDBACK_API_PATH,
  feedbackApiHref,
  hasDateFilter,
  statusesFor,
  type AssignableFeedbackStatus,
  type FeedbackFilters,
  type FeedbackStatus,
} from './filters';
import {
  COUNT_KEY,
  inboxBody,
  messagePreview,
  readFeedbackPage,
  shiftCounts,
  toFeedbackRow,
  type FeedbackCounts,
  type FeedbackRow,
  type PublicFormState,
} from './row';
import { FeedbackDetail } from './FeedbackDetail';
import { NoFeedbackYet, NoMatchingFeedback } from './FeedbackEmptyStates';

/**
 * FB-02's `list` and `detail` states, plus both of its `empty` states.
 *
 * A client component even though the first page is fetched on the server, and the props are the
 * reason: the server hands it real rows, so this renders complete HTML on the first request and
 * then takes over only the parts that need JavaScript — opening a message, filing it, and fetching
 * the next page. The filter controls are deliberately *not* here; they are a plain GET form in
 * `FeedbackFilterForm.tsx`, so filtering works with no JavaScript at all and every filtered view
 * has its own address.
 *
 * ## AC-039
 *
 * The customer's name and mobile are rendered here and nowhere else in the product. They are shown
 * as plain text with no `tel:` or `wa.me` affordance, for two reasons. The public form does not
 * validate the number — `api/v1/public/feedback/route.ts` stores it exactly as typed when it cannot
 * be normalised, so a link built from it would sometimes dial the wrong thing. And outbound contact
 * is REQ-01's job, where the platform prepares a message the owner sends from their own number
 * (D-017, ADR-004); a reply button here would be a second, unaudited path to the same act.
 *
 * ## Counts
 *
 * The chips are adjusted locally after each confirmed write rather than refetched, because a reload
 * would discard the pages the merchant has already scrolled through. `shiftCounts` records why that
 * arithmetic is exact for a row that is on screen.
 */

export interface FeedbackInboxProps {
  filters: FeedbackFilters;
  /**
   * Already mapped to view models by the server component, timestamps included.
   *
   * Not the wire items: mapping them here would put `Intl.DateTimeFormat` inside a `useState`
   * initializer, which runs again during hydration against the browser's ICU data. `toFeedbackRow`
   * records why that differs from Node's.
   */
  initialRows: readonly FeedbackRow[];
  initialNextCursor: string | null;
  initialCounts: FeedbackCounts;
  /**
   * AMENDMENT-004: the zone every timestamp on this screen is rendered in (AC-026). Used only for
   * the pages `loadMore` fetches, which are formatted in the browser and are not a hydration path.
   */
  timeZone: string;
  /** Whether the public form is reachable, for the never-received-anything state. */
  publicForm: PublicFormState;
}

export function FeedbackInbox({
  filters,
  initialRows,
  initialNextCursor,
  initialCounts,
  timeZone,
  publicForm,
}: FeedbackInboxProps) {
  const [rows, setRows] = useState<readonly FeedbackRow[]>(initialRows);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [counts, setCounts] = useState(initialCounts);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const visibleStatuses = statusesFor(filters.status);
  const openRow = rows.find((row) => row.id === openId) ?? null;

  /**
   * Applies a change the server has already accepted.
   *
   * A row that no longer matches the current filter leaves the list, which is what makes Archive
   * feel like filing something away. Under `all` or `archived` it stays and only its badge changes.
   */
  const applyStatus = useCallback(
    (row: FeedbackRow, next: FeedbackStatus) => {
      setCounts((current) => shiftCounts(current, row.status, next));

      if (!visibleStatuses.includes(next)) {
        setRows((current) => current.filter((candidate) => candidate.id !== row.id));
        setOpenId((current) => (current === row.id ? null : current));
        return;
      }

      setRows((current) =>
        current.map((candidate) =>
          candidate.id === row.id ? { ...candidate, status: next } : candidate,
        ),
      );
    },
    [visibleStatuses],
  );

  const changeStatus = useCallback(
    async (row: FeedbackRow, next: AssignableFeedbackStatus): Promise<void> => {
      if (row.status === next) return;

      setPendingId(row.id);
      setConfirmation('');
      setFailure(null);

      try {
        const response = await fetch(`${FEEDBACK_API_PATH}/${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        });

        if (!response.ok) {
          setFailure(await failureMessage(response));
          return;
        }

        applyStatus(row, next);
        setConfirmation(CONFIRMATION[next]);
      } catch {
        setFailure('Could not reach the server. Check your connection and try again.');
      } finally {
        setPendingId(null);
      }
    },
    [applyStatus],
  );

  const loadMore = useCallback(async (): Promise<void> => {
    if (nextCursor === null) return;

    setLoadingMore(true);
    setConfirmation('');
    setFailure(null);

    try {
      const response = await fetch(feedbackApiHref(filters, { cursor: nextCursor }), {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        setFailure(await failureMessage(response));
        return;
      }

      const payload: unknown = await response.json();
      const page = readFeedbackPage(payload);

      if (page === null) {
        // A shape we do not recognise means this page is older than the route answering it, which
        // is an ordinary moment during a rolling deploy. Saying so beats rendering blanks.
        setFailure('Please reload the page — this screen is out of date with the server.');
        return;
      }

      const loaded = page.items.map((item) => toFeedbackRow(item, timeZone));
      setRows((current) => [...current, ...loaded]);
      setNextCursor(page.nextCursor);
      setConfirmation(
        `${loaded.length} more ${loaded.length === 1 ? 'message' : 'messages'} loaded.`,
      );
    } catch {
      setFailure('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [filters, nextCursor, timeZone]);

  const columns = useMemo<readonly TableColumn<FeedbackRow>[]>(
    () => [
      {
        key: 'received',
        header: 'Received',
        isRowHeader: true,
        cell: (row) => (
          <time dateTime={row.receivedIso} className="whitespace-nowrap">
            {row.receivedLabel}
          </time>
        ),
      },
      { key: 'from', header: 'From', cell: (row) => <Sender row={row} /> },
      {
        key: 'message',
        header: 'Message',
        className: 'md:w-2/5',
        cell: (row) => (
          <span className="block max-w-prose text-start">{messagePreview(row.message)}</span>
        ),
      },
      { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
      {
        key: 'actions',
        header: 'Actions',
        // Blank rather than "Actions" in the stacked mobile layout: the buttons name themselves.
        mobileLabel: '',
        align: 'end',
        cell: (row) => (
          <RowActions
            row={row}
            busy={pendingId === row.id}
            onOpen={() => setOpenId(row.id)}
            onChangeStatus={(next) => void changeStatus(row, next)}
          />
        ),
      },
    ],
    [changeStatus, pendingId],
  );

  // Which of the three body states to show, decided in `row.ts` so each one is reachable in a
  // test — including the state after the merchant files every row on a page that has a successor.
  const body = inboxBody({
    rowCount: rows.length,
    nextCursor,
    hasDateFilter: hasDateFilter(filters),
    total: counts.total,
  });

  return (
    <div className="flex flex-col gap-4">
      <CountChips counts={counts} />

      {/*
        Mounted whether or not there is anything to say. A live region added to the DOM at the same
        moment as its first message is frequently never announced, which would leave a screen reader
        user with no confirmation that Archive did anything. It is hidden by class rather than by
        unmounting, so it stays observed while taking no room on an idle screen — and the tick means
        a confirmation is not carried by colour alone.
      */}
      <p
        role="status"
        className={
          confirmation === '' ? 'sr-only' : 'flex items-center gap-1.5 text-sm text-ink-muted'
        }
      >
        <span aria-hidden="true">{confirmation === '' ? '' : '✓'}</span>
        {confirmation}
      </p>

      {failure !== null && <InlineError>{failure}</InlineError>}

      {body.kind === 'never-received' && <NoFeedbackYet publicForm={publicForm} />}
      {body.kind === 'no-matches' && <NoMatchingFeedback filters={filters} />}
      {body.kind === 'list' && (
        <Table
          caption="Private feedback from your customers, newest first"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            body.pageEmptied ? (
              // Filing every row on a page that has a successor leaves the table with no rows while
              // the cursor still points at more. Without this the merchant gets column headers over
              // one blank cell.
              <p className="text-sm text-ink-muted">
                Every message on this page has moved out of this view. Load more to keep going.
              </p>
            ) : undefined
          }
        />
      )}

      {nextCursor !== null && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void loadMore()}
            loading={loadingMore}
            loadingLabel="Loading more messages"
          >
            Load {DEFAULT_PAGE_SIZE} more
          </Button>
        </div>
      )}

      <FeedbackDetail
        row={openRow}
        busy={openRow !== null && pendingId === openRow.id}
        onClose={() => setOpenId(null)}
        onChangeStatus={(next) => {
          if (openRow !== null) void changeStatus(openRow, next);
        }}
      />
    </div>
  );
}

const CONFIRMATION: Record<AssignableFeedbackStatus, string> = {
  READ: 'Marked as read.',
  // Says where it went: "Archived" alone reads like a deletion, and nothing here ever is one.
  ARCHIVED: 'Archived. You can still read it under the Archived filter.',
};

/**
 * Who wrote it, or an honest statement that they chose not to say.
 *
 * Both fields are optional on FB-01, so an anonymous message is an ordinary one rather than an
 * incomplete one — the wording avoids implying the customer withheld something they were asked for.
 */
function Sender({ row }: { row: FeedbackRow }) {
  if (row.name === null && row.mobile === null) {
    return <span className="text-ink-muted">Sent without contact details</span>;
  }

  return (
    <span className="flex flex-col items-end gap-0.5 md:items-start">
      {row.name !== null && <span>{row.name}</span>}
      {row.mobile !== null && (
        <span className="text-ink-muted">
          <span className="sr-only">Mobile: </span>
          {row.mobile}
        </span>
      )}
    </span>
  );
}

interface RowActionsProps {
  row: FeedbackRow;
  busy: boolean;
  onOpen: () => void;
  onChangeStatus: (next: AssignableFeedbackStatus) => void;
}

/**
 * Every control names the message it acts on, for assistive technology.
 *
 * Twenty-five buttons all called "Archive" are indistinguishable in a screen reader's list of
 * controls, and AC-037 is about a keyboard being a workable way to use this screen rather than
 * merely a possible one.
 */
function RowActions({ row, busy, onOpen, onChangeStatus }: RowActionsProps) {
  const target = `message received ${row.receivedLabel}`;

  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      <Button variant="text" onClick={onOpen}>
        View<span className="sr-only">: {target}</span>
      </Button>

      {row.status === 'NEW' && (
        <Button variant="text" loading={busy} onClick={() => onChangeStatus('READ')}>
          Mark read<span className="sr-only">: {target}</span>
        </Button>
      )}

      {row.status === 'ARCHIVED' ? (
        <Button variant="secondary" loading={busy} onClick={() => onChangeStatus('READ')}>
          Move to inbox<span className="sr-only">: {target}</span>
        </Button>
      ) : (
        <Button variant="secondary" loading={busy} onClick={() => onChangeStatus('ARCHIVED')}>
          Archive<span className="sr-only">: {target}</span>
        </Button>
      )}
    </span>
  );
}

/**
 * How much there is, per status, within the selected dates.
 *
 * A definition list rather than a row of loose numbers: each figure needs the word it counts, and
 * `StatusBadge` already pairs that word with a glyph, so nothing here depends on colour.
 */
function CountChips({ counts }: { counts: FeedbackCounts }) {
  const statuses: readonly FeedbackStatus[] = ['NEW', 'READ', 'ARCHIVED'];

  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {statuses.map((status) => (
        <div key={status} className="flex items-center gap-1.5">
          <dt>
            <StatusBadge status={status} />
          </dt>
          <dd className="font-semibold text-ink">{counts[COUNT_KEY[status]]}</dd>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <dt className="text-ink-muted">Total</dt>
        <dd className="font-semibold text-ink">{counts.total}</dd>
      </div>
    </dl>
  );
}

/**
 * The API's safe, user-facing message, used verbatim.
 *
 * 23_API_Error_Codes.md guarantees every failure carries one and AC-030 guarantees it holds no
 * provider detail or stack trace, so remapping it here would only create a second place for the
 * wording to be wrong.
 */
async function failureMessage(response: Response): Promise<string> {
  const fallback = 'Something went wrong. Please try again.';

  try {
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;

    const error = (payload as { error: unknown }).error;
    if (typeof error !== 'object' || error === null) return fallback;

    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' && message.length > 0 ? message : fallback;
  } catch {
    return fallback;
  }
}
