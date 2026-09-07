'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InlineError,
  Input,
  Spinner,
  Table,
  type TableColumn,
} from '@ai-review/ui';
import type { CustomerDto, CustomerListPage } from '@/app/api/v1/customers/repository';
import { SECONDARY_LINK } from '../link-styles';
import { ABORTED_CODE, getCustomerPage } from './customer-api';
import { CustomerFormDialog } from './CustomerFormDialog';
import { DeleteCustomerDialog } from './DeleteCustomerDialog';
import { STATUS_LEGEND, describeStatus, formatMobile, formatVisitDate } from './presentation';

/**
 * CRM-01 — the `list` and `empty` states, and the owner of the `form` state's dialogs.
 *
 * A Client Component because search, pagination and three dialogs are all interaction. The first page
 * is still rendered on the server and handed in as `initial`, so the table is populated in the first
 * paint: an owner arriving from the nav should not watch an empty table fill in, and with a
 * fetch-on-mount they could start typing a search into a list that is about to be replaced.
 *
 * What is deliberately absent is the substance of CRM-01-01 and D-018. No select-all, no bulk action,
 * no import, no export, no campaign — this is a list of people to ask for a review one at a time, not
 * a marketing tool. Absent rather than disabled: a greyed-out "Import" teaches an owner to wait for
 * something that is never coming.
 */

/**
 * Debounce before searching as the owner types.
 *
 * A request per keystroke would put roughly ten authenticated round trips per second onto an endpoint
 * that counts and scans, to answer a question that only matters once typing settles. The Search button
 * bypasses it for anyone who would rather ask explicitly.
 */
const SEARCH_DEBOUNCE_MS = 350;

/** Where CRM-01's "Prepare review request" hands off to REQ-01. */
const REVIEW_REQUESTS_PATH = '/app/review-requests';

interface Query {
  q: string;
  page: number;
}

type Dialog =
  | { kind: 'none' }
  | { kind: 'form'; customer: CustomerDto | null }
  | { kind: 'delete'; customer: CustomerDto };

export interface CustomersScreenProps {
  initial: CustomerListPage;
}

export function CustomersScreen({ initial }: CustomersScreenProps) {
  const [data, setData] = useState<CustomerListPage>(initial);
  const [query, setQuery] = useState<Query>({ q: initial.q, page: initial.page });
  const [searchText, setSearchText] = useState(initial.q);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  /**
   * The query `data` already answers.
   *
   * Seeded from the server-rendered page, so mounting does not immediately re-fetch what is already on
   * screen. Cleared to force a reload after a write, which is why it is a ref rather than derived
   * state: "this list is stale" is not a property of the query, it is a fact about the last response.
   */
  const satisfied = useRef(queryKey({ q: initial.q, page: initial.page }));

  useEffect(() => {
    if (queryKey(query) === satisfied.current) return;

    const controller = new AbortController();
    setPending(true);

    void (async () => {
      const result = await getCustomerPage({
        q: query.q,
        page: query.page,
        signal: controller.signal,
      });

      // A superseded request. The effect that replaced this one owns `pending` from here.
      if (controller.signal.aborted) return;

      setPending(false);

      if (!result.ok) {
        if (result.failure.code === ABORTED_CODE) return;
        setLoadError(result.failure.message);
        return;
      }

      // Keyed on the page the server actually served rather than the one asked for. It clamps a
      // request past the end — deleting the last contact on the last page is how that happens — and
      // keying on the request would leave this effect asking for page 3 of 2 forever.
      satisfied.current = queryKey({ q: query.q, page: result.value.page });
      setLoadError(null);
      setData(result.value);
      if (result.value.page !== query.page) {
        setQuery((current) => ({ ...current, page: result.value.page }));
      }
    })();

    return () => controller.abort();
  }, [query]);

  // Applies the search box once typing settles. Compared against the trimmed text, so trailing spaces
  // cannot leave this effect and the applied query disagreeing forever.
  useEffect(() => {
    const next = searchText.trim();
    if (next === query.q) return;

    const timer = setTimeout(() => setQuery({ q: next, page: 1 }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, query.q]);

  /** Re-reads the list even though the query itself has not changed. Used after every write. */
  const reload = useCallback((next?: Partial<Query>) => {
    satisfied.current = '';
    setQuery((current) => ({ ...current, ...next }));
  }, []);

  const closeDialog = useCallback(() => setDialog({ kind: 'none' }), []);

  const openAdd = useCallback(() => {
    setNotice('');
    setDialog({ kind: 'form', customer: null });
  }, []);

  const openEdit = useCallback((customer: CustomerDto) => {
    setNotice('');
    setDialog({ kind: 'form', customer });
  }, []);

  const openDelete = useCallback((customer: CustomerDto) => {
    setNotice('');
    setDialog({ kind: 'delete', customer });
  }, []);

  const clearSearch = useCallback(() => {
    setSearchText('');
    setQuery({ q: '', page: 1 });
  }, []);

  const onSaved = useCallback(
    (customer: CustomerDto, mode: 'created' | 'updated') => {
      setDialog({ kind: 'none' });
      setNotice(
        mode === 'created' ? `${customer.name} added to your list.` : `${customer.name} updated.`,
      );

      if (mode === 'created') {
        // Rows are newest first, so a new contact is at the top of page one. The search is cleared
        // with it: confirming "added" while the row sits filtered out of sight is worse than the small
        // surprise of the box emptying.
        setSearchText('');
        reload({ q: '', page: 1 });
      } else {
        reload();
      }
    },
    [reload],
  );

  const onDeleted = useCallback(
    (customer: CustomerDto) => {
      setDialog({ kind: 'none' });
      setNotice(`${customer.name} removed from your list.`);
      reload();
    },
    [reload],
  );

  const columns = buildColumns(openEdit, openDelete);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Customers</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          The people you can ask for a review, one at a time. This is not a mailing list — there are
          no bulk messages, no imports and no campaigns, and we never message anyone for you.
        </p>
      </div>

      {/*
        Rendered whether or not it has anything in it. A live region is only announced if assistive
        technology was already watching it when the text arrived, so mounting one together with its
        first message reliably announces nothing.
      */}
      <div role="status" aria-live="polite">
        {notice !== '' && (
          <p className="rounded-card border border-success bg-success-soft px-4 py-3 text-sm text-success">
            <span aria-hidden="true">{'✓ '}</span>
            {notice}
          </p>
        )}
      </div>

      <Card title="Your customers" actions={<Button onClick={openAdd}>Add customer</Button>}>
        <div className="flex flex-col gap-4">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              // Applies immediately, ahead of the debounce.
              setQuery({ q: searchText.trim(), page: 1 });
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <Field
              label="Search"
              hint="A name, an email address, or any part of a mobile number."
              className="min-w-56 flex-1"
            >
              {(control) => (
                <Input
                  {...control}
                  type="search"
                  name="q"
                  value={searchText}
                  onChange={(event) => {
                    setSearchText(event.target.value);
                    setNotice('');
                  }}
                  autoComplete="off"
                />
              )}
            </Field>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          <div className="flex min-h-6 flex-wrap items-center gap-3">
            <p role="status" aria-live="polite" className="text-sm text-ink-muted">
              {summarise(data)}
            </p>
            {pending && <Spinner size="sm" label="Updating the list" />}
          </div>

          {loadError !== null && <InlineError>{loadError}</InlineError>}

          <div aria-busy={pending}>
            <Table
              caption="Your customer contacts"
              columns={columns}
              rows={data.customers}
              rowKey={(customer) => customer.id}
              empty={
                data.q === '' ? (
                  <NoCustomersYet onAdd={openAdd} />
                ) : (
                  <NoMatches search={data.q} onClear={clearSearch} />
                )
              }
            />
          </div>

          {data.total_pages > 1 && (
            <nav aria-label="Customer pages" className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                disabled={pending || data.page <= 1}
                onClick={() => reload({ page: data.page - 1 })}
              >
                Previous
              </Button>
              <p className="text-sm text-ink-muted">
                Page {data.page} of {data.total_pages}
              </p>
              <Button
                variant="secondary"
                disabled={pending || data.page >= data.total_pages}
                onClick={() => reload({ page: data.page + 1 })}
              >
                Next
              </Button>
            </nav>
          )}
        </div>
      </Card>

      <StatusLegend />

      {dialog.kind === 'form' && (
        <CustomerFormDialog
          // Keyed so each contact gets a fresh form: its state comes from props on mount, which means
          // there is no reset effect to forget when the target changes.
          key={dialog.customer?.id ?? 'new'}
          customer={dialog.customer}
          onClose={closeDialog}
          onSaved={onSaved}
        />
      )}

      {dialog.kind === 'delete' && (
        <DeleteCustomerDialog
          key={dialog.customer.id}
          customer={dialog.customer}
          onClose={closeDialog}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

function NoCustomersYet({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      title="No customers yet"
      description="Add someone you have served, then prepare a review request to send them yourself."
      action={<Button onClick={onAdd}>Add your first customer</Button>}
    />
  );
}

function NoMatches({ search, onClear }: { search: string; onClear: () => void }) {
  return (
    <EmptyState
      title={`No customers match “${search}”`}
      description="Try part of a name, an email address, or part of their mobile number."
      action={
        <Button variant="secondary" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}

/**
 * The table's columns.
 *
 * Every row action names its contact in screen-reader-only text: "Edit" repeated twenty-five times is
 * unusable when navigating by control, and the row header only helps somebody reading the table as a
 * table.
 *
 * Each control keeps the kit's 44px minimum height, which the design brief requires for touch. Rows
 * are therefore taller than a dense desktop table would be, and that is the right way round — these
 * actions either navigate away or cannot be undone.
 */
function buildColumns(
  onEdit: (customer: CustomerDto) => void,
  onDelete: (customer: CustomerDto) => void,
): readonly TableColumn<CustomerDto>[] {
  return [
    {
      key: 'contact',
      header: 'Contact',
      isRowHeader: true,
      cell: (customer) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-ink">{customer.name}</span>
          {customer.email !== null && (
            <span className="text-sm font-normal break-all text-ink-muted">{customer.email}</span>
          )}
          {customer.note !== null && (
            // Clamped in CSS rather than truncated in JavaScript, so the whole note stays in the DOM
            // for anyone reading with assistive technology or searching the page.
            <span className="line-clamp-2 text-sm font-normal text-ink-muted">{customer.note}</span>
          )}
        </span>
      ),
    },
    {
      key: 'mobile',
      header: 'Mobile',
      cell: (customer) => (
        <span className="whitespace-nowrap">{formatMobile(customer.mobile)}</span>
      ),
    },
    {
      key: 'visit',
      header: 'Visit date',
      cell: (customer) => <OptionalText value={formatVisitDate(customer.visit_date)} />,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (customer) => <StatusCell status={customer.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (customer) => (
        <span className="flex flex-wrap items-center justify-end gap-1">
          {/*
            A link, not a button: REQ-01 is another screen, and an anchor can be opened in a new tab,
            middle-clicked and copied, none of which a button calling router.push can do. The contact
            travels as a query parameter, so this screen needs nothing from REQ-01's own module.
          */}
          <Link
            href={`${REVIEW_REQUESTS_PATH}?customer=${encodeURIComponent(customer.id)}`}
            className={SECONDARY_LINK}
          >
            Prepare request<span className="sr-only"> for {customer.name}</span>
          </Link>
          <Button variant="text" onClick={() => onEdit(customer)}>
            Edit<span className="sr-only"> {customer.name}</span>
          </Button>
          <Button variant="text" className="text-danger" onClick={() => onDelete(customer)}>
            Delete<span className="sr-only"> {customer.name}</span>
          </Button>
        </span>
      ),
    },
  ];
}

function StatusCell({ status }: { status: CustomerDto['status'] }) {
  const presentation = describeStatus(status);
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

/**
 * An optional value that was never recorded.
 *
 * The dash is decorative and hidden; the words are what a screen reader hears. A bare empty cell is
 * ambiguous between "nothing was entered" and "this failed to load".
 */
function OptionalText({ value }: { value: string | null }) {
  if (value !== null) return <span className="whitespace-nowrap">{value}</span>;

  return (
    <>
      <span aria-hidden="true" className="text-ink-muted">
        —
      </span>
      <span className="sr-only">Not recorded</span>
    </>
  );
}

/**
 * What the statuses mean, and which of them the owner controls.
 *
 * A closed `<details>` rather than a permanent panel: it answers a question an owner has once. It is
 * on the screen at all because most of these values are set by the platform, and a status somebody
 * cannot change has to say why — particularly "Google opened", which means exactly that and nothing
 * about what was written there (D-028, AC-025).
 */
function StatusLegend() {
  return (
    <details className="rounded-card border border-line bg-surface px-4 py-3">
      {/*
        The focus ring is stated rather than left to the browser default: `globals.css` styles
        focus-visible for inputs, links and `.btn` but not for `<summary>`, and AC-037 asks for
        visible focus on everything that takes it.
      */}
      <summary className="cursor-pointer rounded text-sm font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent">
        What the statuses mean
      </summary>
      <dl className="mt-3 flex flex-col gap-3">
        {STATUS_LEGEND.map(({ status, presentation }) => (
          <div key={status} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="sm:w-44 sm:shrink-0">
              <Badge tone={presentation.tone}>{presentation.label}</Badge>
            </dt>
            <dd className="m-0 text-sm text-ink-muted">{presentation.detail}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-muted">
        You can set “Not asked yet” and “Sent by you” yourself when you edit a customer. The rest
        are set from what actually happens on your review page, so they cannot be changed by hand.
      </p>
    </details>
  );
}

/**
 * The query a response belongs to.
 *
 * The page number comes first so that a plain space is an unambiguous separator: the search text is
 * trimmed, so no key can begin with one, and a search box can otherwise contain anything at all —
 * including whatever character looked like a safe separator.
 */
function queryKey(query: Query): string {
  return `${query.page} ${query.q}`;
}

/**
 * The one line that says what is on screen.
 *
 * In a polite live region, so a search announces its result rather than silently replacing the table
 * under a screen-reader user.
 */
function summarise(page: CustomerListPage): string {
  const matching = page.q === '' ? '' : ` matching “${page.q}”`;

  if (page.total === 0) {
    return page.q === '' ? 'No customers yet.' : `No customers${matching}.`;
  }

  const noun = page.total === 1 ? 'customer' : 'customers';
  if (page.total <= page.per_page) return `${page.total} ${noun}${matching}.`;

  const first = (page.page - 1) * page.per_page + 1;
  const last = first + page.customers.length - 1;
  return `Showing ${first}–${last} of ${page.total} ${noun}${matching}.`;
}
