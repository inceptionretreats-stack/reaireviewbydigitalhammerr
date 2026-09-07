'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  InlineError,
  StatusBadge,
  Table,
  ToastProvider,
  Toggle,
  useToast,
  type TableColumn,
} from '@ai-review/ui';
import type { WireMode } from '@/app/api/v1/ai/modes/mode-service';
import type { SubmitFailure } from '@/components/auth/use-form-submit';
import { MODE_EMPHASIS_NOTE, QR_UNAFFECTED_NOTE } from './copy';
import { ModeEditor, type ModeEditorValues } from './ModeEditor';
import { applyActivation, asWireMode, duplicateNameFor, mergeMode, sortModes } from './modes';
import { sendJson, type JsonResult } from './send-json';
import { TEXT_LINK } from './styles';

/**
 * AI-02 — `/app/review-modes`. All four required states: `list`, `create`, `edit` and `archived`.
 *
 * Three product rules decide the shape of this screen more than the CRUD does.
 *
 * AI-02-01, exactly one active mode. There is no two-way "active" switch per row, because a switch
 * offers Off and Off is not a state this product has — a business always has one mode in use, and
 * turning the last one off would leave generation with no emphasis at all. So the control is
 * one-directional: inactive rows offer "Use this mode", and the row in use shows that it is in use.
 * The screen spec lists an "Active toggle" field; this is that field, rendered as the only shape
 * that can honour AI-02-01. The switch that does exist toggles whether archived modes are shown,
 * which is a genuine two-state preference.
 *
 * AI-02-02, an archived mode cannot be active. The row in use therefore offers no Archive at all
 * rather than a button that fails: the endpoint refuses it, and a control whose only outcome is an
 * error message is worse than an absent one. The card says why, so the absence is not a mystery.
 *
 * AI-02-03, changing mode does not change any QR. Stated on the screen rather than left to be
 * discovered, because it is the reassurance that makes modes usable at all: an owner who suspects
 * that switching modes invalidates printed standees will never switch.
 *
 * A suspended or closed tenant sees the same list and nothing to press. Reads are deliberately not
 * gated — an owner needs to see what was suspended — but every mutating control is withheld rather
 * than left to fail, because "This business is not active." arriving after a filled-in dialog says
 * nothing about the suspension being the cause or support being the way out (Flow J).
 *
 * The list is kept in client state and updated from each response — every endpoint returns the row
 * it wrote — rather than refetched. That is fewer round trips and, more importantly, it cannot race
 * with an edit the owner has already started typing in the dialog.
 */

export interface ReviewModesManagerProps {
  /** Server-rendered first paint, in the wire shape `GET /api/v1/ai/modes` returns. */
  initialModes: readonly WireMode[];
  /**
   * Whether this tenant may change anything here.
   *
   * The same condition `refuseFrozenTenant` applies on all three mode endpoints — DRAFT and
   * ACTIVE may write, SUSPENDED and CLOSED may not (Flow J) — so no control is offered that the
   * API is guaranteed to refuse with BUSINESS_NOT_ACTIVE.
   */
  canManage: boolean;
  /** Why, in one sentence, from `describeBusinessStatus`. Shown only when `canManage` is false. */
  statusNote: string;
}

type EditorTarget =
  { kind: 'create' } | { kind: 'duplicate'; source: WireMode } | { kind: 'edit'; mode: WireMode };

interface EditorState {
  /**
   * Remount key. A new target has to reset the fields rather than inherit the previous row's
   * half-typed name.
   */
  key: string;
  target: EditorTarget;
  values: ModeEditorValues;
}

const ARCHIVED_HINT =
  'Archived modes are never used for new drafts, and can be restored at any time.';

const MODES_CARD_DESCRIPTION =
  'One mode is in use at a time, and it applies to every new draft. ' + QR_UNAFFECTED_NOTE;

type RowAction = 'activate' | 'archive' | 'restore';

export function ReviewModesManager({
  initialModes,
  canManage,
  statusNote,
}: ReviewModesManagerProps) {
  // The dashboard shell mounts no ToastProvider yet and `app/(app)/app/layout.tsx` is shared, so
  // the provider is scoped to this screen. It should move to the shell once the shell grows one —
  // otherwise every screen that wants a confirmation ends up with its own.
  return (
    <ToastProvider>
      <ModesPanel initialModes={initialModes} canManage={canManage} statusNote={statusNote} />
    </ToastProvider>
  );
}

function ModesPanel({ initialModes, canManage, statusNote }: ReviewModesManagerProps) {
  const toast = useToast();

  const [modes, setModes] = useState<readonly WireMode[]>(() => sortModes(initialModes));
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorFailure, setEditorFailure] = useState<SubmitFailure | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [pending, setPending] = useState<{ id: string; action: RowAction } | null>(null);
  const [rowFailure, setRowFailure] = useState<SubmitFailure | null>(null);
  const [listIsStale, setListIsStale] = useState(false);

  const archivedCount = modes.filter((mode) => mode.is_archived).length;
  const visible = showArchived ? modes : modes.filter((mode) => !mode.is_archived);
  const names = modes.map((mode) => mode.name);

  const openCreate = (): void => {
    setEditorFailure(null);
    setEditor({
      key: `create-${Date.now()}`,
      target: { kind: 'create' },
      values: { name: '', description: '', contextTerms: [] },
    });
  };

  const openDuplicate = (source: WireMode): void => {
    setEditorFailure(null);
    setEditor({
      key: `duplicate-${source.id}-${Date.now()}`,
      target: { kind: 'duplicate', source },
      values: {
        // A suggestion, not a guarantee: a name taken between now and Save comes back as a 422
        // against the name field, which the dialog shows.
        name: duplicateNameFor(names, source.name),
        description: source.description ?? '',
        contextTerms: source.context_terms,
      },
    });
  };

  const openEdit = (mode: WireMode): void => {
    setEditorFailure(null);
    setEditor({
      key: `edit-${mode.id}-${mode.updated_at}`,
      target: { kind: 'edit', mode },
      values: {
        name: mode.name,
        description: mode.description ?? '',
        contextTerms: mode.context_terms,
      },
    });
  };

  const readWrittenMode = (
    payload: Record<string, unknown>,
    key: 'mode' | 'active_mode',
  ): WireMode | null => {
    const written = asWireMode(payload[key]);
    // The write succeeded; only the response was unreadable. Saying so beats silently showing a
    // list that no longer matches the database.
    if (!written) setListIsStale(true);
    return written;
  };

  const submitEditor = async (values: ModeEditorValues): Promise<void> => {
    if (!editor) return;

    setEditorBusy(true);
    setEditorFailure(null);

    const result =
      editor.target.kind === 'edit'
        ? await saveEdit(editor.target.mode, values)
        : await sendJson('/api/v1/ai/modes', 'POST', {
            name: values.name,
            description: values.description.trim() === '' ? null : values.description,
            context_terms: values.contextTerms,
          });

    setEditorBusy(false);

    // Nothing to send: the dialog was opened and closed again without an edit. Reported as success
    // so the owner is not told a change failed that they did not make.
    if (result === null) {
      setEditor(null);
      return;
    }

    if (!result.ok) {
      setEditorFailure(result.failure);
      return;
    }

    const written = readWrittenMode(result.payload, 'mode');
    if (written) setModes((current) => mergeMode(current, written));

    setEditor(null);
    toast.show({
      tone: 'success',
      title: editor.target.kind === 'edit' ? 'Mode saved' : 'Mode created',
      description:
        editor.target.kind === 'edit'
          ? undefined
          : 'It is not in use yet — choose "Use this mode" when you want new drafts to lean on it.',
    });
  };

  const runRowAction = async (mode: WireMode, action: RowAction): Promise<void> => {
    setPending({ id: mode.id, action });
    setRowFailure(null);

    const result =
      action === 'activate'
        ? await sendJson(`/api/v1/ai/modes/${mode.id}/activate`, 'POST')
        : await sendJson(`/api/v1/ai/modes/${mode.id}`, 'PATCH', {
            is_archived: action === 'archive',
          });

    setPending(null);

    if (!result.ok) {
      setRowFailure(result.failure);
      return;
    }

    if (action === 'activate') {
      const activated = readWrittenMode(result.payload, 'active_mode');
      if (activated) setModes((current) => applyActivation(current, activated));

      toast.show({
        tone: 'success',
        title: `${mode.name} is now in use`,
        // AI-02-03, repeated at the moment of the switch. This is where the doubt actually arises.
        description: QR_UNAFFECTED_NOTE,
      });
      return;
    }

    const written = readWrittenMode(result.payload, 'mode');
    if (written) setModes((current) => mergeMode(current, written));

    toast.show({
      tone: 'success',
      title: action === 'archive' ? `${mode.name} archived` : `${mode.name} restored`,
      description:
        action === 'archive'
          ? 'It is out of the way and not used for new drafts. You can restore it at any time.'
          : 'It is available again, and not in use until you choose it.',
    });
  };

  const columns: readonly TableColumn<WireMode>[] = [
    {
      key: 'name',
      header: 'Mode',
      isRowHeader: true,
      mobileLabel: 'Mode',
      cell: (mode) => (
        <span className="flex flex-col gap-0.5">
          <span>{mode.name}</span>
          {mode.description !== null && (
            <span className="text-sm font-normal text-ink-muted">{mode.description}</span>
          )}
        </span>
      ),
    },
    {
      key: 'terms',
      header: 'Context terms',
      mobileLabel: 'Context terms',
      cell: (mode) =>
        mode.context_terms.length === 0 ? (
          // Not a gap to apologise for: Balanced deliberately carries none, because the default
          // should shift nothing.
          <span className="text-ink-muted">No extra terms</span>
        ) : (
          <span className="font-normal text-ink">{mode.context_terms.join(', ')}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      mobileLabel: 'Status',
      cell: (mode) => (
        <span className="flex flex-col items-start gap-1">
          {mode.is_archived ? (
            <StatusBadge status="ARCHIVED" />
          ) : mode.is_active ? (
            <StatusBadge status="ACTIVE" label="In use" />
          ) : (
            <StatusBadge status="DISABLED" label="Not in use" />
          )}
          {mode.is_active && !mode.is_archived && (
            <span className="text-sm text-ink-muted">Switch modes to archive this one</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      mobileLabel: 'Actions',
      align: 'end',
      cell: (mode) => {
        const anyBusy = pending !== null && pending.id === mode.id;
        const busy = (action: RowAction): boolean =>
          pending !== null && pending.id === mode.id && pending.action === action;

        // Every control below writes: activate, edit and archive through their endpoints, and
        // Duplicate through POST /ai/modes. A frozen tenant is refused all of them, so the cell
        // holds nothing rather than buttons whose only outcome is an error.
        if (!canManage) {
          return <span className="text-sm text-ink-muted">No changes available</span>;
        }

        return (
          <span className="flex flex-wrap justify-end gap-1">
            {mode.is_archived ? (
              <Button
                variant="secondary"
                loading={busy('restore')}
                loadingLabel="Restoring"
                disabled={anyBusy && !busy('restore')}
                onClick={() => void runRowAction(mode, 'restore')}
              >
                Restore<span className="sr-only"> {mode.name}</span>
              </Button>
            ) : (
              !mode.is_active && (
                <Button
                  variant="secondary"
                  loading={busy('activate')}
                  loadingLabel="Switching"
                  disabled={anyBusy && !busy('activate')}
                  onClick={() => void runRowAction(mode, 'activate')}
                >
                  {/*
                    The row context is visually hidden text inside the button, not an aria-label:
                    an aria-label would replace the accessible name with words that do not contain
                    the visible ones, which is WCAG 2.2 SC 2.5.3 Label in Name (Level A, inside the
                    AA target AC-038 sets) — a speech-input user saying "use this mode" could not
                    activate the control. This way the visible words survive in the accessible name
                    and a screen reader user still hears which mode the button belongs to.
                  */}
                  Use this mode<span className="sr-only"> for new drafts: {mode.name}</span>
                </Button>
              )
            )}

            {!mode.is_archived && (
              <Button variant="text" disabled={anyBusy} onClick={() => openEdit(mode)}>
                Edit<span className="sr-only"> {mode.name}</span>
              </Button>
            )}

            <Button variant="text" disabled={anyBusy} onClick={() => openDuplicate(mode)}>
              Duplicate<span className="sr-only"> {mode.name}</span>
            </Button>

            {/* AI-02-02: the mode in use cannot be archived, so it is not offered. */}
            {!mode.is_archived && !mode.is_active && (
              <Button
                variant="text"
                loading={busy('archive')}
                loadingLabel="Archiving"
                disabled={anyBusy && !busy('archive')}
                onClick={() => void runRowAction(mode, 'archive')}
              >
                Archive<span className="sr-only"> {mode.name}</span>
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Review modes
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Choose what your drafts lean on
        </h1>
        <p className="max-w-2xl text-sm text-ink-muted">{MODE_EMPHASIS_NOTE}</p>
      </div>

      <Card
        title="Your modes"
        titleAs="h2"
        description={MODES_CARD_DESCRIPTION}
        actions={canManage ? <Button onClick={openCreate}>Create mode</Button> : undefined}
      >
        <div className="flex flex-col gap-4">
          {/*
            The explanation, not just the absence. Flow J's suspension is an admin action an owner
            cannot undo from this screen, so the note from `describeBusinessStatus` says what
            happened and that support is the route out — which the API's bare "This business is not
            active." does not.
          */}
          {!canManage && (
            <div className="rounded-card border border-line bg-surface p-3">
              <p className="m-0 text-sm font-semibold text-ink">
                Changes are unavailable right now
              </p>
              <p className="m-0 mt-1 text-sm text-ink-muted">{statusNote}</p>
            </div>
          )}

          {rowFailure !== null && <InlineError>{rowFailure.message}</InlineError>}

          {listIsStale && (
            <InlineError>
              Your change was saved, but this list could not be updated. Reload the page to see
              where things stand.
            </InlineError>
          )}

          {archivedCount > 0 && (
            <Toggle
              checked={showArchived}
              onCheckedChange={setShowArchived}
              label={`Show archived modes (${archivedCount})`}
              description={ARCHIVED_HINT}
            />
          )}

          <Table
            caption="Your review modes, and which one is in use"
            columns={columns}
            rows={visible}
            rowKey={(mode) => mode.id}
            empty={
              <EmptyState
                title="No review modes yet"
                description={
                  canManage ? (
                    <>
                      A mode is a small set of context hints — a cuisine, a service line, a room —
                      that a draft leans on. Saving your AI context creates a{' '}
                      <strong>Balanced</strong> mode for you, or you can create one now.
                    </>
                  ) : (
                    statusNote
                  )
                }
                action={canManage ? <Button onClick={openCreate}>Create mode</Button> : undefined}
              />
            }
          />
        </div>
      </Card>

      <Card title="Where the rest of the context lives" titleAs="h2">
        <p className="text-sm text-ink-muted">
          Every mode builds on your business summary, services and context terms — the background
          the assistant always has. A mode only shifts which of it gets emphasis.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/app/ai-review" className={TEXT_LINK}>
            Edit your AI context
          </Link>
        </p>
      </Card>

      {editor !== null && (
        <ModeEditor
          key={editor.key}
          open
          title={editorTitle(editor.target)}
          submitLabel={editor.target.kind === 'edit' ? 'Save changes' : 'Create mode'}
          initialValues={editor.values}
          busy={editorBusy}
          failure={editorFailure}
          onSubmit={(values) => void submitEditor(values)}
          onClose={() => {
            if (editorBusy) return;
            setEditor(null);
            setEditorFailure(null);
          }}
        />
      )}
    </div>
  );
}

function editorTitle(target: EditorTarget): string {
  switch (target.kind) {
    case 'create':
      return 'Create a review mode';
    case 'duplicate':
      return `Duplicate ${target.source.name}`;
    case 'edit':
      return `Edit ${target.mode.name}`;
  }
}

/**
 * Sends only what the owner actually changed, and nothing at all when they changed nothing.
 *
 * PATCH refuses an empty body by design — a request that changes nothing would still move
 * `updated_at` and report success — so the caller has to know the difference. `null` means there
 * was no request to make.
 */
async function saveEdit(mode: WireMode, values: ModeEditorValues): Promise<JsonResult | null> {
  const patch: Record<string, unknown> = {};

  if (values.name.trim() !== mode.name) patch.name = values.name;

  const description = values.description.trim() === '' ? null : values.description.trim();
  if (description !== mode.description) patch.description = description;

  if (!sameTerms(values.contextTerms, mode.context_terms)) {
    patch.context_terms = values.contextTerms;
  }

  if (Object.keys(patch).length === 0) return null;

  return sendJson(`/api/v1/ai/modes/${mode.id}`, 'PATCH', patch);
}

function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((term, index) => term === b[index]);
}
