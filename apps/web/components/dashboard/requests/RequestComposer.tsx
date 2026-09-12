'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InlineError,
  Select,
  Spinner,
  Table,
  Textarea,
  type SelectOption,
  type TableColumn,
} from '@ai-review/ui';
import {
  RENDERED_MESSAGE_MAX,
  TEMPLATE_TEXT_MAX,
  TEMPLATE_VARIABLES,
} from '@/app/api/v1/review-requests/template';
import { SECONDARY_LINK } from '../link-styles';
import { customerOptionLabel, describeRequest, formatDateTime } from './presentation';
import type { CustomerOption, RequestRowView } from './types';

/**
 * REQ-01's interactive half — the composer, the prepared message and the recent list.
 *
 * The one thing this screen must never be ambiguous about: **the platform sends nothing.** D-017,
 * ADR-004 and REQ-01-02 all say the owner copies the text or opens a wa.me deep link and sends from
 * their own number, so every label here is about preparing and opening, never about sending. The only
 * control with "sent" in it is "Mark message sent", which records something the owner did elsewhere
 * (AC-023), and it says so beside the button.
 *
 * Three states REQ-01 names map as follows: `preview` is a customer selected with the resolved message
 * on screen; `copied` is the confirmation beside whichever Copy was pressed; `sent-manual` is a row
 * carrying "Marked sent by you". A fourth, `empty`, was added because the screen cannot function
 * without a contact — see the parent server component.
 *
 * All three states live in one component rather than three, because they act on one object: the row
 * the owner just prepared is the same row the list shows and the same row Mark sent updates. Splitting
 * them would mean two copies of that row and a way for them to disagree.
 */

/**
 * Debounce before asking the server to re-render the preview.
 *
 * Rendering happens server-side (see the preview route: one renderer, so what the owner approves and
 * what gets stored cannot drift), which means a request per settled keystroke. The interval matches
 * the slug check in `components/onboarding/BusinessStep.tsx`, which made the same trade against the
 * same kind of authenticated endpoint.
 */
const PREVIEW_DEBOUNCE_MS = 400;

const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.';

/** Both outcomes say what to do next, and neither claims anything was sent. */
const COPY_OK = 'Copied. Paste it into WhatsApp and send it yourself.';
const COPY_BLOCKED = 'Your browser blocked copying. Select the message and copy it by hand.';

interface PreviewResult {
  message: string;
  reviewLink: string | null;
  isTracked: boolean;
  unknownVariables: readonly string[];
  /** Length once the tracked link is substituted — the number the 1,500 limit applies to. */
  preparedLength: number;
}

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

type CopyOutcome = { id: string; ok: boolean } | null;

export interface RequestComposerProps {
  customers: readonly CustomerOption[];
  /** From `?customer=` — CRM-01's "Prepare review request" action arrives with one chosen. */
  initialCustomerId: string | null;
  /** The tenant's saved default template, seeded on load if they had none. */
  savedTemplateText: string;
  timezone: string;
  /**
   * Whether the tenant is ACTIVE. A tracked link points at the public review page, which does not
   * resolve for a DRAFT or SUSPENDED business, so the create endpoint refuses (Flow J) and this
   * screen says so up front rather than letting the owner discover it on a 409.
   */
  isLive: boolean;
  notLiveNote: string | null;
  initialRows: readonly RequestRowView[];
}

export function RequestComposer({
  customers,
  initialCustomerId,
  savedTemplateText,
  timezone,
  isLive,
  notLiveNote,
  initialRows,
}: RequestComposerProps) {
  const [customerId, setCustomerId] = useState(
    // An id from the query string that is not in this tenant's list is dropped rather than trusted:
    // the list is server-resolved for this tenant, so anything outside it is not theirs (AC-003).
    () => (customers.some((c) => c.id === initialCustomerId) ? (initialCustomerId ?? '') : ''),
  );
  const [templateText, setTemplateText] = useState(savedTemplateText);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rows, setRows] = useState<readonly RequestRowView[]>(initialRows);
  const [preparedId, setPreparedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyOutcome>(null);

  const templateRef = useRef<HTMLTextAreaElement | null>(null);
  const preparedRef = useRef<HTMLDivElement | null>(null);
  const previewId = useId();

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  // Read out of `rows` rather than held separately, so Mark sent updates one object and both the
  // panel and the table follow.
  const prepared = rows.find((row) => row.id === preparedId) ?? null;

  const customerOptions = useMemo<readonly SelectOption[]>(
    () =>
      customers.map((customer) => ({
        value: customer.id,
        label: customerOptionLabel(customer.name, customer.mobile),
      })),
    [customers],
  );

  /**
   * The resolved preview (Flow F steps 3 and 4).
   *
   * Aborted and re-timed on every edit, so a slow response cannot overwrite a newer one — the classic
   * out-of-order-response bug, which here would show the owner a message they have already changed and
   * are about to prepare.
   */
  useEffect(() => {
    const template = templateText.trim();
    if (customerId === '' || template === '') {
      setPreview(null);
      setPreviewStatus('idle');
      setPreviewError(null);
      return;
    }

    setPreviewStatus('loading');
    const controller = new AbortController();

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch('/api/v1/review-requests/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_id: customerId, template_text: template }),
            signal: controller.signal,
          });
          const payload: unknown = await response.json().catch(() => null);

          if (!response.ok) {
            setPreviewStatus('error');
            setPreviewError(readErrorMessage(payload));
            return;
          }

          const result = readPreview(payload);
          if (result === null) {
            setPreviewStatus('error');
            setPreviewError('We could not build the preview. Please try again.');
            return;
          }

          setPreview(result);
          setPreviewStatus('ready');
          setPreviewError(null);
        } catch {
          // An abort is this effect being superseded, not a failure worth reporting.
          if (controller.signal.aborted) return;
          setPreviewStatus('error');
          setPreviewError(NETWORK_MESSAGE);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [customerId, templateText]);

  /** Inserts a variable at the caret rather than at the end, so it lands where the owner is typing. */
  const insertVariable = useCallback(
    (variable: string) => {
      const element = templateRef.current;
      const token = `{${variable}}`;
      const start = element?.selectionStart ?? templateText.length;
      const end = element?.selectionEnd ?? start;

      setTemplateText(
        `${templateText.slice(0, start)}${token}${templateText.slice(end)}`.slice(
          0,
          TEMPLATE_TEXT_MAX,
        ),
      );

      if (element) {
        // Restored after the new value is committed. Without this the caret jumps to the end of the
        // textarea and the owner has to find their place again — and pressing three insert buttons in
        // a row would build the sentence backwards.
        const caret = Math.min(start + token.length, TEMPLATE_TEXT_MAX);
        requestAnimationFrame(() => {
          element.focus();
          element.setSelectionRange(caret, caret);
        });
      }
    },
    [templateText],
  );

  const copyMessage = useCallback(async (id: string, message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied({ id, ok: true });
    } catch {
      // `navigator.clipboard` is absent in an insecure context and can be refused by permission
      // policy. The message is in a selectable textarea for exactly this case, so the failure branch
      // says what to do instead of pretending the copy worked.
      setCopied({ id, ok: false });
    }
  }, []);

  const prepare = useCallback(async () => {
    if (selectedCustomer === null) return;

    setPreparing(true);
    setActionError(null);
    setCopied(null);

    try {
      const response = await fetch('/api/v1/review-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomer.id,
          template_text: templateText.trim(),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setActionError(readErrorMessage(payload));
        return;
      }

      const row = readCreatedRow(payload, selectedCustomer, timezone);
      if (row === null) {
        setActionError('The message was prepared but we could not display it. Please reload.');
        return;
      }

      setRows((current) => [row, ...current]);
      setPreparedId(row.id);
    } catch {
      setActionError(NETWORK_MESSAGE);
    } finally {
      setPreparing(false);
    }
  }, [selectedCustomer, templateText, timezone]);

  const markSent = useCallback(
    async (row: RequestRowView) => {
      setMarkingId(row.id);
      setActionError(null);

      try {
        const response = await fetch(
          `/api/v1/review-requests/${encodeURIComponent(row.id)}/mark-sent`,
          { method: 'POST' },
        );
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          setActionError(readErrorMessage(payload));
          return;
        }

        /*
         * The endpoint is idempotent and returns the first timestamp, so a second click reports what
         * is already recorded rather than moving it.
         *
         * A null is reachable on a 200: the mark-sent handler's race branch answers with
         * `current?.markedSentAt?.toISOString() ?? null`. There is no browser-clock fallback, because
         * this row is then rendered as "You marked this sent on {label}" — a time the server never
         * recorded, presented as the recorded fact. Nothing is invented; the row is left as it was and
         * the next reload picks up whatever was actually stored.
         */
        const iso = readString(payload, 'marked_sent_at');
        if (iso === null) return;

        setRows((current) =>
          current.map((candidate) =>
            candidate.id === row.id
              ? {
                  ...candidate,
                  markedSentAtIso: iso,
                  markedSentAtLabel: formatDateTime(iso, timezone),
                }
              : candidate,
          ),
        );
      } catch {
        setActionError(NETWORK_MESSAGE);
      } finally {
        setMarkingId(null);
      }
    },
    [timezone],
  );

  /** Moves focus to the prepared message once it exists — AC-037 is about being able to work by
   * keyboard, and a panel that appears three screens down is not reachable without a hunt. */
  useEffect(() => {
    if (preparedId !== null) preparedRef.current?.focus();
  }, [preparedId]);

  const overLimit = preview !== null && preview.preparedLength > RENDERED_MESSAGE_MAX;
  /*
   * `!preparing` is deliberately NOT part of this.
   *
   * `Button` documents why: `loading` does not set the native `disabled` attribute, because "a
   * disabled element is removed from the tab order, so disabling the button the user just pressed
   * drops keyboard focus to the top of the document mid-task — the opposite of AC-037". Its own
   * handler already swallows clicks while loading, so disabling the pressed control buys nothing and
   * costs a keyboard user their place for the whole round trip. The auth forms do the same
   * (LoginForm, ForgotPasswordForm, ResetPasswordForm all pass `loading` alone on the submit
   * control). The Select and Textarea keep `disabled={preparing}` — those are not the pressed
   * control, and focus is not on them.
   */
  const canPrepare =
    isLive && selectedCustomer !== null && templateText.trim() !== '' && !overLimit;

  return (
    <div className="flex flex-col gap-6">
      {/*
        One live region for the whole screen, mounted from the first render and empty until there is
        something to say. A region created at the same moment as its content is frequently not
        announced at all, and a region per row would mean twenty of them — see `CopyStatus`, which
        renders the same words visibly and `aria-hidden` beside the control that was pressed.
      */}
      <p role="status" className="sr-only">
        {copied === null ? '' : copied.ok ? COPY_OK : COPY_BLOCKED}
      </p>

      {notLiveNote !== null && (
        <div className="rounded-card border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          <p className="font-semibold">
            <span aria-hidden="true">{'⚠'}</span> Your page is not live yet
          </p>
          <p>{notLiveNote}</p>
        </div>
      )}

      <Card
        title="Prepare a message"
        titleAs="h2"
        description="One customer at a time. You send it yourself — Ai Review never sends a message for you."
      >
        <div className="flex flex-col gap-5">
          <Field
            label="Customer"
            required
            hint="Pick who this message is for. The number is shown so you can check it is the right person."
          >
            {(control) => (
              <Select
                {...control}
                name="customer_id"
                options={customerOptions}
                placeholder="Choose a customer"
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setActionError(null);
                }}
                disabled={preparing}
              />
            )}
          </Field>

          <Field
            label="Message"
            hint={`Edit it however you like. Up to ${TEMPLATE_TEXT_MAX} characters.`}
          >
            {(control) => (
              <div className="flex flex-col gap-2">
                <Textarea
                  {...control}
                  ref={templateRef}
                  name="template_text"
                  value={templateText}
                  onChange={(event) => setTemplateText(event.target.value)}
                  maxLength={TEMPLATE_TEXT_MAX}
                  rows={6}
                  disabled={preparing}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink-muted">Insert:</span>
                  {TEMPLATE_VARIABLES.map((variable) => (
                    <Button
                      key={variable}
                      variant="secondary"
                      onClick={() => insertVariable(variable)}
                      disabled={preparing}
                    >
                      <span aria-hidden="true">{`{${variable}}`}</span>
                      <span className="sr-only">{`Insert the ${variable.replace('_', ' ')} placeholder`}</span>
                    </Button>
                  ))}
                  {templateText !== savedTemplateText && (
                    <Button
                      variant="text"
                      onClick={() => setTemplateText(savedTemplateText)}
                      disabled={preparing}
                    >
                      Reset to my saved message
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Field>

          <section aria-labelledby={previewId} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 id={previewId} className="text-sm font-semibold text-ink">
                Preview
              </h3>
              {/*
                Not a live region, deliberately. This panel changes every time typing settles, and a
                polite region would read the whole message out again on each pause — unusable with a
                screen reader. The heading makes it navigable instead, and only short state changes
                (errors, "message ready") are announced elsewhere on the screen.
              */}
              {previewStatus === 'loading' && (
                <span className="flex items-center gap-2 text-sm text-ink-muted" aria-hidden="true">
                  <Spinner size="sm" /> Updating…
                </span>
              )}
            </div>

            {previewStatus === 'error' && previewError !== null && (
              <InlineError role="status">{previewError}</InlineError>
            )}

            {preview === null ? (
              <p className="rounded-card border border-dashed border-line bg-surface px-4 py-6 text-sm text-ink-muted">
                {customerId === ''
                  ? 'Choose a customer to see the message they will read.'
                  : 'Write the message you want to send, and it will be shown here as your customer will read it.'}
              </p>
            ) : (
              <>
                <p className="rounded-card border border-line bg-surface px-4 py-3 text-sm whitespace-pre-wrap text-ink">
                  {preview.message}
                </p>

                <p
                  className={
                    overLimit ? 'text-sm font-medium text-danger' : 'text-sm text-ink-muted'
                  }
                >
                  {preview.preparedLength} of {RENDERED_MESSAGE_MAX} characters once the link is
                  added.
                </p>

                {overLimit && (
                  <InlineError role="status">
                    That is too long to store. Please shorten the message.
                  </InlineError>
                )}

                {preview.unknownVariables.length > 0 && (
                  <div className="rounded-card border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
                    <p className="font-semibold">
                      <span aria-hidden="true">{'⚠'}</span> Not a placeholder we recognise
                    </p>
                    <p>
                      {preview.unknownVariables.map((name) => `{${name}}`).join(', ')} will be sent
                      exactly as written. Use the Insert buttons for the ones we can fill in.
                    </p>
                  </div>
                )}

                {/*
                  Said plainly, because an owner who copies the link out of the preview by hand should
                  know it is not the tracked one. The preview shows the real review page rather than a
                  fake tracked link precisely so that copying it still works.
                */}
                {!preview.isTracked && (
                  <p className="text-sm text-ink-muted">
                    The preview shows your normal review link. When you prepare the message it gets
                    a link that is unique to this customer, so you can see when it is opened.
                  </p>
                )}
              </>
            )}
          </section>

          {actionError !== null && <InlineError>{actionError}</InlineError>}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => void prepare()}
              loading={preparing}
              loadingLabel="Preparing your message…"
              disabled={!canPrepare}
            >
              Prepare message
            </Button>
            <span className="text-sm text-ink-muted">
              This only writes the message. Nothing is sent until you send it.
            </span>
          </div>
        </div>
      </Card>

      {prepared !== null && (
        <Card
          title="Your message is ready"
          titleAs="h2"
          description={`For ${prepared.customerName}. Nothing has been sent — copy it or open WhatsApp, then send it from your own number.`}
        >
          {/*
            tabIndex -1 so focus can be moved here when the panel appears, which is what actually
            announces it: a live region that arrives in the DOM together with its content is
            frequently not announced at all (see the note in `@ai-review/ui`'s Toast). The sr-only
            line below is deliberately the first thing focus lands on, so the announcement says what
            this panel is rather than starting mid-message.
          */}
          <div ref={preparedRef} tabIndex={-1} className="flex flex-col gap-4">
            <p className="sr-only">
              Message ready to copy or open in WhatsApp. Nothing is sent yet.
            </p>

            <Field label="Message to send" labelHidden>
              {(control) => (
                <Textarea
                  {...control}
                  readOnly
                  rows={6}
                  value={prepared.renderedMessage}
                  // Selectable on purpose: if the clipboard is blocked, this is how the owner still
                  // gets the text.
                  onFocus={(event) => event.currentTarget.select()}
                />
              )}
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => void copyMessage(prepared.id, prepared.renderedMessage)}
              >
                Copy message
              </Button>

              {prepared.whatsappUrl === null ? (
                <span className="text-sm text-ink-muted">
                  This customer&apos;s number is not one WhatsApp can open, so copy the message
                  instead.
                </span>
              ) : (
                <a
                  className={SECONDARY_LINK}
                  href={prepared.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open WhatsApp
                  <span className="sr-only">
                    {' '}
                    with this message ready — you send it from your own number
                  </span>
                </a>
              )}

              {prepared.markedSentAtLabel === null ? (
                <Button
                  variant="secondary"
                  onClick={() => void markSent(prepared)}
                  loading={markingId === prepared.id}
                  loadingLabel="Recording that you sent it…"
                >
                  Mark message sent
                </Button>
              ) : (
                <Badge tone="success">Marked sent by you</Badge>
              )}
            </div>

            <CopyStatus outcome={copied} id={prepared.id} />

            {prepared.markedSentAtLabel !== null && (
              <p className="text-sm text-ink-muted">
                You marked this sent on {prepared.markedSentAtLabel}. That is your own note — we
                cannot see your WhatsApp.
              </p>
            )}

            {prepared.reviewLink !== null && (
              <p className="text-sm break-all text-ink-muted">
                <span className="font-medium text-ink">Link for {prepared.customerName}: </span>
                {prepared.reviewLink}
              </p>
            )}
          </div>
        </Card>
      )}

      <RecentRequests
        rows={rows}
        markingId={markingId}
        copied={copied}
        onCopy={(row) => void copyMessage(row.id, row.renderedMessage)}
        onMarkSent={(row) => void markSent(row)}
      />
    </div>
  );
}

interface RecentRequestsProps {
  rows: readonly RequestRowView[];
  markingId: string | null;
  copied: CopyOutcome;
  onCopy: (row: RequestRowView) => void;
  onMarkSent: (row: RequestRowView) => void;
}

/**
 * What has been prepared so far.
 *
 * This is where the `sent-manual` state survives a reload, and it is the only place the tracked
 * link's one observable fact is reported. The footer says what that fact is and is not: an opened
 * link is the furthest thing this product can see (D-028, AC-025), and an owner who is not told that
 * will read "link opened" as "review left".
 */
function RecentRequests({ rows, markingId, copied, onCopy, onMarkSent }: RecentRequestsProps) {
  const columns: readonly TableColumn<RequestRowView>[] = [
    {
      key: 'customer',
      header: 'Customer',
      isRowHeader: true,
      cell: (row) => <span className="font-medium text-ink">{row.customerName}</span>,
    },
    {
      key: 'prepared',
      header: 'Prepared',
      cell: (row) => <time dateTime={row.preparedAtIso}>{row.preparedAtLabel}</time>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          {describeRequest(row).map((badge) => (
            <Badge key={badge.label} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
          {row.firstClickedAtLabel !== null && (
            <span className="text-xs text-ink-muted">
              first opened{' '}
              <time dateTime={row.firstClickedAtIso ?? undefined}>{row.firstClickedAtLabel}</time>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      mobileLabel: 'Actions',
      cell: (row) => (
        <span className="flex flex-col items-start gap-2">
          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onCopy(row)}>
              Copy<span className="sr-only"> the message for {row.customerName}</span>
            </Button>
            {row.whatsappUrl !== null && (
              <a
                className={SECONDARY_LINK}
                href={row.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open WhatsApp
                <span className="sr-only"> for {row.customerName}</span>
              </a>
            )}
            {row.markedSentAtLabel === null && (
              <Button
                variant="text"
                onClick={() => onMarkSent(row)}
                loading={markingId === row.id}
                loadingLabel="Recording that you sent it…"
              >
                Mark sent<span className="sr-only"> for {row.customerName}</span>
              </Button>
            )}
          </span>
          <CopyStatus outcome={copied} id={row.id} />
        </span>
      ),
    },
  ];

  return (
    <Card
      title="Prepared requests"
      titleAs="h2"
      footer={
        <>
          The last thing we can see is that the link was opened. What a customer writes on Google is
          not visible to us.
        </>
      }
    >
      <Table
        caption="Review requests you have prepared, newest first"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            title="Nothing prepared yet"
            description="Choose a customer above, check the message, then prepare it. It will be listed here so you can copy it again or mark it sent."
          />
        }
      />
    </Card>
  );
}

/**
 * The `copied` state, visually, beside whichever control was pressed.
 *
 * `aria-hidden`, because the announcement is made by the single always-mounted live region in the
 * parent: a region added to the DOM at the same moment as its content is frequently not announced at
 * all (see `@ai-review/ui`'s Toast), and one region per row would mean twenty of them.
 *
 * Glyph paired with words, never colour alone (18_UI_UX_Design_System_Brief.md), and not cleared on a
 * timer: a confirmation that disappears after two seconds is one a slower reader never sees, and
 * "Copied" is still true a minute later. Same reasoning as `components/dashboard/CopyLinkButton.tsx`.
 */
function CopyStatus({ outcome, id }: { outcome: CopyOutcome; id: string }) {
  if (outcome === null || outcome.id !== id) return null;

  return outcome.ok ? (
    <p aria-hidden="true" className="flex items-center gap-1.5 text-sm text-ink-muted">
      <span>{'✓'}</span> {COPY_OK}
    </p>
  ) : (
    <p aria-hidden="true" className="flex items-center gap-1.5 text-sm font-medium text-danger">
      <span>{'⚠'}</span> {COPY_BLOCKED}
    </p>
  );
}

/**
 * The API returns a safe, user-facing `message` for every failure (23_API_Error_Codes.md), so it is
 * shown verbatim rather than remapped here — the same decision `components/auth/use-form-submit.ts`
 * documents. That hook is not reused: it holds one endpoint and one state, and this screen posts to
 * three endpoints and needs each response body, not just its success flag.
 */
function readErrorMessage(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return 'Something went wrong. Please try again.';
  }
  const error = (payload as { error: Record<string, unknown> }).error;
  return typeof error.message === 'string'
    ? error.message
    : 'Something went wrong. Please try again.';
}

function readPreview(payload: unknown): PreviewResult | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.rendered_message !== 'string') return null;

  return {
    message: record.rendered_message,
    reviewLink: typeof record.review_link === 'string' ? record.review_link : null,
    isTracked: record.review_link_is_tracked === true,
    unknownVariables: Array.isArray(record.unknown_variables)
      ? record.unknown_variables.filter((value): value is string => typeof value === 'string')
      : [],
    // Falls back to the on-screen length if the field is missing, so the counter shows something
    // truthful-but-low rather than nothing. The create endpoint enforces the real limit either way.
    preparedLength:
      typeof record.prepared_length === 'number'
        ? record.prepared_length
        : record.rendered_message.length,
  };
}

/** Builds the list row for a request that was just created, from the create response. */
function readCreatedRow(
  payload: unknown,
  customer: CustomerOption,
  timezone: string,
): RequestRowView | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;

  const id = readString(record, 'id');
  const message = readString(record, 'rendered_message');
  const preparedAt = readString(record, 'prepared_at');
  if (id === null || message === null || preparedAt === null) return null;

  return {
    id,
    customerId: customer.id,
    customerName: customer.name,
    preparedAtIso: preparedAt,
    preparedAtLabel: formatDateTime(preparedAt, timezone),
    // A request cannot be marked sent or clicked in the same instant it is created, so both start
    // absent rather than being read from the response.
    markedSentAtIso: null,
    markedSentAtLabel: null,
    firstClickedAtIso: null,
    firstClickedAtLabel: null,
    renderedMessage: message,
    reviewLink: readString(record, 'review_link'),
    whatsappUrl: readString(record, 'whatsapp_url'),
  };
}

function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
