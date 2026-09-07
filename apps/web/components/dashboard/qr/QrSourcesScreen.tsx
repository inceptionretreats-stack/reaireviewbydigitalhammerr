'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  StatusBadge,
  Table,
  ToastProvider,
  useToast,
  type TableColumn,
} from '@ai-review/ui';
import { SECONDARY_LINK } from '../link-styles';
import { DisableQrDialog } from './DisableQrDialog';
import { QrSourceDialog } from './QrSourceDialog';
import {
  countSources,
  describeCounts,
  describeQrScan,
  describeQrStatus,
  EXAMPLE_LABELS,
  formatCreatedAt,
  parseQrSource,
  readQrFailure,
  upsertSource,
  type QrMutationOutcome,
  type QrSource,
  type QrStatus,
} from './qr-sources';

/**
 * QR-01 — the `list`, `create` and `disabled` states of `/app/qr`.
 *
 * The list arrives as props from the Server Component, so the screen renders complete on first
 * paint and no spinner stands between the owner and the codes they came to download. After that it
 * owns the list: every write answers with the updated row in the same shape (`toQrSourceWire`), so
 * a create or a rename folds straight into state instead of triggering a refetch of the whole list.
 *
 * Two things this screen deliberately does not offer.
 *
 * There is no Delete, anywhere. QR-01 lists Disable and Enable and no third action, because a
 * printed standee cannot be recalled — disabling is the retirement path and `/r/{code}` answers a
 * disabled code with a controlled page rather than a 404 (QR-01-02).
 *
 * There is no destination control. One destination behaviour exists in V1 (D-026), so a `<select>`
 * with a single option would imply a choice the product does not have; it is stated as a fact in
 * `QrHowItWorks` and in the create form instead.
 */

export interface QrSourcesScreenProps {
  initialSources: readonly QrSource[];
  /** `businesses.timezone` (AMENDMENT-004) — every date on this screen is formatted in it. */
  timezone: string;
  /**
   * Whether this tenant may create, rename, disable or enable.
   *
   * Mirrors `requireActiveTenant` on the endpoints: Flow J stops a suspended or closed tenant
   * mutating its configuration, and a DRAFT tenant has no published page for a code to resolve to.
   * The buttons are absent rather than disabled, so nothing here is a control that answers 409.
   */
  canManage: boolean;
  /**
   * Whether the public page and every code on it actually resolve
   * (`describeBusinessStatus(...).isPubliclyLive`).
   *
   * A separate prop from `canManage` even though the two coincide in V1, because they answer
   * different questions: `canManage` mirrors `requireActiveTenant` on the endpoints, while this
   * one decides what each row is allowed to claim a scan does. `loadPublicConfig` serves nothing
   * for a SUSPENDED or CLOSED tenant, so an enabled row must not say it opens the review page.
   */
  isPubliclyLive: boolean;
  /** Why, in one sentence, from `describeBusinessStatus`. Shown only when `canManage` is false. */
  statusNote: string;
  /** Where setup resumes, when that is what stands in the way. Null otherwise. */
  setupPath: string | null;
}

const QR_ENDPOINT = '/api/v1/qr';

/** What each state change should say once it has happened. */
const STATUS_TOAST: Record<QrStatus, (label: string) => { title: string; description: string }> = {
  DISABLED: (label) => ({
    title: 'QR source disabled',
    description: `Scanning ${label} now shows a short "not available" message.`,
  }),
  ACTIVE: (label) => ({
    title: 'QR source enabled',
    description: `${label} is working again — the printed code needs no change.`,
  }),
};

export function QrSourcesScreen(props: QrSourcesScreenProps) {
  /*
   * The provider is mounted here rather than in the dashboard layout because that layout is shared
   * chrome owned by another workstream. It renders its own viewport, so nesting it inside one
   * screen is safe — but it does mean confirmations are scoped to this route. When the layout gains
   * a provider, this wrapper should go (see concerns).
   */
  return (
    <ToastProvider>
      <QrSources {...props} />
    </ToastProvider>
  );
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; source: QrSource }
  | { kind: 'disable'; source: QrSource };

function QrSources({
  initialSources,
  timezone,
  canManage,
  isPubliclyLive,
  statusNote,
  setupPath,
}: QrSourcesScreenProps) {
  const [sources, setSources] = useState<readonly QrSource[]>(initialSources);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  /** The row a status change is in flight for, so only that row shows a busy control. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);
  const toast = useToast();

  const counts = countSources(sources);

  const create = useCallback(
    async (input: { sourceLabel: string; internalNote: string }): Promise<QrMutationOutcome> => {
      const outcome = await mutate(QR_ENDPOINT, 'POST', {
        source_label: input.sourceLabel,
        internal_note: input.internalNote,
      });

      if (outcome.ok) {
        setSources((current) => upsertSource(current, outcome.source));
        toast.show({
          tone: 'success',
          title: 'QR code created',
          description: `${outcome.source.label} is ready to download and print.`,
        });
      }

      return outcome;
    },
    [toast],
  );

  const rename = useCallback(
    async (
      source: QrSource,
      input: { sourceLabel: string; internalNote: string },
    ): Promise<QrMutationOutcome> => {
      const outcome = await mutate(`${QR_ENDPOINT}/${source.id}`, 'PATCH', {
        source_label: input.sourceLabel,
        // Always sent, because an empty string is how a note is cleared — omitting the key would
        // leave the old note in place and make it impossible to remove one.
        internal_note: input.internalNote,
      });

      if (outcome.ok) {
        setSources((current) => upsertSource(current, outcome.source));
        toast.show({
          tone: 'success',
          title: 'Saved',
          description: `Now called ${outcome.source.label}. The printed code is unchanged.`,
        });
      }

      return outcome;
    },
    [toast],
  );

  const changeStatus = useCallback(
    async (source: QrSource, status: QrStatus): Promise<QrMutationOutcome> => {
      setPendingId(source.id);
      const outcome = await mutate(`${QR_ENDPOINT}/${source.id}`, 'PATCH', { status });
      setPendingId(null);

      if (outcome.ok) {
        setSources((current) => upsertSource(current, outcome.source));
        const message = STATUS_TOAST[status](outcome.source.label);
        toast.show({ tone: 'success', ...message });
      }

      return outcome;
    },
    [toast],
  );

  const confirmDisable = useCallback(async () => {
    if (dialog.kind !== 'disable') return;

    const outcome = await changeStatus(dialog.source, 'DISABLED');
    if (outcome.ok) {
      setDialog({ kind: 'closed' });
      setDisableError(null);
      return;
    }
    // Kept open with the reason: closing on failure would leave the owner believing the standee is
    // off when it is still live.
    setDisableError(outcome.failure.message);
  }, [changeStatus, dialog]);

  const enable = useCallback(
    async (source: QrSource) => {
      const outcome = await changeStatus(source, 'ACTIVE');
      if (!outcome.ok) {
        // Danger toasts do not auto-dismiss, so a failure cannot scroll away unseen.
        toast.show({
          tone: 'danger',
          title: 'Could not enable',
          description: outcome.failure.message,
        });
      }
    },
    [changeStatus, toast],
  );

  const columns: readonly TableColumn<QrSource>[] = [
    {
      key: 'source',
      header: 'Source',
      isRowHeader: true,
      cell: (row) => {
        const created = formatCreatedAt(row.createdAt, timezone);
        return (
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold text-ink">{row.label}</span>
            {row.note !== null && (
              <span className="text-sm font-normal text-ink-muted">{row.note}</span>
            )}
            {/* text-ink-muted, not a fainter token: `styles.css` defines only ink and ink-muted,
                and a class Tailwind cannot resolve renders as inherited full-weight ink. */}
            <span className="text-sm font-normal text-ink-muted">
              {created === null ? '—' : `Added ${created}`}
            </span>
          </span>
        );
      },
    },
    {
      key: 'code',
      header: 'Printed code',
      mobileLabel: 'Code',
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <code className="rounded-control bg-surface px-1.5 py-0.5 font-mono text-sm break-all">
            {row.code}
          </code>
          {/*
            Shown as text, not as a link. Opening it from here would land on the customer flow and
            record a qr_scan against this source — the owner would be inflating the very
            attribution QR-01-03 exists to make readable. The downloaded artwork is how a code is
            tested.
          */}
          <span className="text-xs break-all text-ink-muted">{row.resolveUrl}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => {
        const status = describeQrStatus(row.status);
        return (
          <span className="flex flex-col items-start gap-1">
            {/* A word and a glyph, never a colour on its own (AC-038, design brief). */}
            <StatusBadge status={status.badge} label={status.label} />
            {/*
              The sentence depends on the tenant as well as the row: for a suspended or closed
              business nothing on the public side resolves, so an enabled code does not open the
              review page and must not say it does — the banner above this table says the opposite.
            */}
            <span className="text-sm text-ink-muted">
              {describeQrScan(row.status, isPubliclyLive)}
            </span>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <span className="flex flex-wrap items-center justify-end gap-2">
          {canManage && (
            <Button
              variant="secondary"
              disabled={pendingId === row.id}
              onClick={() => setDialog({ kind: 'edit', source: row })}
            >
              Rename
              {/* Which row this control belongs to, for anyone who cannot see the table. */}
              <span className="sr-only"> {row.label}</span>
            </Button>
          )}

          {/*
            Anchors, not Buttons: a download is a link, and it has to survive a middle-click, a
            right-click and being announced as a link. The kit Button renders a <button> with no
            polymorphic escape hatch, so the button treatment comes from the shared link styles and
            keeps the same focus ring and touch target (AC-037).

            Left available even when the tenant cannot manage sources: the download endpoint needs
            no active tenant, and a suspended owner still has standees to reprint. The filename
            carries the printed code so a file can be matched to a standee on a print order.
          */}
          <a
            href={`${QR_ENDPOINT}/${row.id}/download?format=svg`}
            download={`qr-${row.code}.svg`}
            className={SECONDARY_LINK}
          >
            Download SVG<span className="sr-only"> for {row.label}</span>
          </a>
          <a
            href={`${QR_ENDPOINT}/${row.id}/download?format=png`}
            download={`qr-${row.code}.png`}
            className={SECONDARY_LINK}
          >
            Download PNG<span className="sr-only"> for {row.label}</span>
          </a>

          {canManage &&
            (row.status === 'ACTIVE' ? (
              <Button
                variant="destructive"
                disabled={pendingId === row.id}
                onClick={() => {
                  setDisableError(null);
                  setDialog({ kind: 'disable', source: row });
                }}
              >
                Disable<span className="sr-only"> {row.label}</span>
              </Button>
            ) : (
              // Enabling only restores service, so it needs no confirmation — unlike disabling,
              // which changes what a customer standing at the counter sees.
              <Button
                variant="secondary"
                loading={pendingId === row.id}
                loadingLabel="Enabling…"
                onClick={() => void enable(row)}
              >
                Enable<span className="sr-only"> {row.label}</span>
              </Button>
            ))}
        </span>
      ),
    },
  ];

  return (
    <>
      <Card
        title="Your QR sources"
        titleAs="h2"
        description={describeCounts(counts)}
        // QR-01 lists the destination as screen content, and this is the screen it belongs on —
        // once, as a statement of fact about every row (D-026), rather than as a column repeating
        // the same words or a control offering a choice V1 does not have.
        footer="Every source here sends scans to your AI review page. That is fixed in V1."
        actions={
          canManage ? (
            <Button onClick={() => setDialog({ kind: 'create' })}>Create QR</Button>
          ) : undefined
        }
      >
        {!canManage && (
          <div className="mb-4 rounded-card border border-line bg-surface p-3">
            <p className="m-0 text-sm font-semibold text-ink">Changes are unavailable right now</p>
            <p className="m-0 mt-1 text-sm text-ink-muted">{statusNote}</p>
            {setupPath !== null && (
              <p className="m-0 mt-2">
                <Link href={setupPath} className="font-semibold text-accent">
                  Finish setup
                </Link>
              </p>
            )}
          </div>
        )}

        <Table
          caption="Your QR sources"
          columns={columns}
          rows={sources}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title={canManage ? 'No QR sources yet' : 'No QR codes yet'}
              description={
                canManage ? (
                  <>
                    Create one for each place you print it — {EXAMPLE_LABELS.join(', ')} — and your
                    reports will tell you which one customers actually use.
                  </>
                ) : (
                  statusNote
                )
              }
              action={
                canManage ? (
                  <Button onClick={() => setDialog({ kind: 'create' })}>
                    Create your first QR
                  </Button>
                ) : setupPath !== null ? (
                  <Link href={setupPath} className={SECONDARY_LINK}>
                    Finish setup
                  </Link>
                ) : undefined
              }
            />
          }
        />
      </Card>

      <QrSourceDialog
        open={dialog.kind === 'create' || dialog.kind === 'edit'}
        mode={dialog.kind === 'edit' ? 'edit' : 'create'}
        source={dialog.kind === 'edit' ? dialog.source : undefined}
        onClose={() => setDialog({ kind: 'closed' })}
        onSubmit={(input) =>
          dialog.kind === 'edit' ? rename(dialog.source, input) : create(input)
        }
      />

      <DisableQrDialog
        open={dialog.kind === 'disable'}
        source={dialog.kind === 'disable' ? dialog.source : null}
        busy={dialog.kind === 'disable' && pendingId === dialog.source.id}
        error={disableError}
        onClose={() => {
          setDialog({ kind: 'closed' });
          setDisableError(null);
        }}
        onConfirm={() => void confirmDisable()}
      />
    </>
  );
}

/**
 * One request to the QR endpoints, with the error envelope unpacked.
 *
 * A network failure is reported as such rather than as a rejected request: telling an owner their
 * label was wrong when the connection dropped sends them editing a field that was fine.
 *
 * The third branch is the one worth reading. A 2xx whose body cannot be understood means the write
 * *did* happen, so it must not be reported as a failure — the message asks for a refresh instead of
 * inviting a second create that would produce a duplicate source.
 */
async function mutate(
  url: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<QrMutationOutcome> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) return { ok: false, failure: readQrFailure(payload) };

    const source = parseQrSource(payload);
    if (!source) {
      return {
        ok: false,
        failure: {
          code: 'UNREADABLE_RESPONSE',
          message: 'That went through, but we could not read the result. Refresh to see it.',
          fields: [],
        },
      };
    }

    return { ok: true, source };
  } catch {
    return {
      ok: false,
      failure: {
        code: 'NETWORK',
        message: 'Could not reach the server. Check your connection and try again.',
        fields: [],
      },
    };
  }
}
