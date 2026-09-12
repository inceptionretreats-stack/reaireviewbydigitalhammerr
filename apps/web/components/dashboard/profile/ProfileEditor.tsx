'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { businessIdentityRequest } from '@ai-review/contracts';
import type { ReviewDestinationKind } from '@ai-review/core';
import { Badge, Button, Card, Field, InlineError, Input, Textarea } from '@ai-review/ui';
import { SECONDARY_LINK } from '../link-styles';
import { AppearanceCard } from './AppearanceCard';
import { ProfilePreview, type PreviewSection } from './ProfilePreview';
import { ReviewLocationCard } from './ReviewLocationCard';
import { SectionRow } from './SectionRow';
import { applyOrder, moveItem, resolveDragEnd, sameOrder } from './order';
import {
  applyEdit,
  currentOf,
  sectionPatch,
  storedOf,
  type EditorSection,
  type SectionEdit,
} from './row-state';
import { sendJson } from './request';
import {
  DEFAULT_SECTION_TYPES,
  SECTION,
  rendersPublicly,
  sectionTarget,
  type SectionType,
} from './sections';

/**
 * PROFILE-01 — `/app/profile`. The three states the screen spec requires are `editing`, `saved` and
 * `preview`; `editing` and `preview` are the two views below, and `saved` is the confirmation the
 * Save action produces.
 *
 * Two decisions about *when* things are written are worth stating, because they are not symmetrical.
 *
 *  - Order is saved the instant a section moves. AC-021 requires ordering to persist across devices
 *    and refresh, which makes it server state rather than part of a form; and a drag whose result is
 *    lost by navigating away is the classic drag-and-drop trap. `POST /business/links/reorder` exists
 *    for exactly this.
 *  - Everything else is saved by Save, one request per changed section plus one for the business
 *    details. That is what the spec's single Save action means, and it keeps a mistyped Instagram URL
 *    from blocking the WhatsApp number the owner actually came to fix.
 *
 * What is deliberately *not* here: logo and cover upload, and the brand accent. V1's route tree has
 * no upload endpoint and nothing consumes `businesses.brand_accent` — the public page renders from
 * the shared palette — so a file input could only take a file and drop it, and a colour picker could
 * only store a value with no visible effect. Both are shown as unavailable, in the same way the nav
 * marks a screen that does not exist yet, rather than faked. Reported in concerns.
 */

/** Mirrors businessIdentityRequest so the inputs cap length as they are typed. */
const NAME_MAX = 160;
const DESCRIPTION_MAX = 500; // AMENDMENT-009 narrowed the column to the 0-500 the screens specify.

/** ONB-01 and ONB-03 — the two setup screens this one hands work back to. */
const BUSINESS_STEP_PATH = '/onboarding/business';
const LINKS_STEP_PATH = '/onboarding/links';

export interface StoredSection {
  id: string;
  type: SectionType;
  label: string;
  url: string | null;
  phone: string | null;
  enabled: boolean;
}

/**
 * The identity fields PROFILE-01 lists, and the ones it does not.
 *
 * `businessIdentityRequest` requires category, city, state, timezone and slug on every PATCH, but
 * PROFILE-01's field list is the business name and the description. The rest is therefore round
 * tripped unchanged — including the slug, whose re-claim is a documented no-op when it is already
 * this business's primary (`SlugService.claim`). It also means a change made in setup on another tab
 * is overwritten by what this page loaded; the honest fix is a PATCH that accepts a partial identity,
 * which is a change to a contract this module must not edit. See concerns.
 */
export interface IdentityPassthrough {
  category: string;
  city: string;
  state: string;
  timezone: string;
  /** Null until ONB-01 has claimed one, which is the one case identity cannot be saved at all. */
  slug: string | null;
}

export interface ProfileEditorProps {
  name: string;
  description: string;
  passthrough: IdentityPassthrough;
  sections: readonly StoredSection[];
  /** From `review_destinations` — the single owner of the Google URL (AMENDMENT-003, AC-017). */
  reviewUrl: string | null;
  /** Raw stored value plus the server-validated URL that is safe to expose as an external link. */
  reviewLocation: {
    url: string | null;
    openUrl: string | null;
    kind: ReviewDestinationKind | null;
    enabled: boolean;
  };
  publicUrl: string | null;
  isLive: boolean;
  /** Set for a SUSPENDED or CLOSED tenant (Flow J): the screen explains and stops accepting edits. */
  frozenNote: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  brandAccent: string | null;
}

interface SectionFailure {
  message: string;
  /** Which input the API named in `details.fields`, when it named one. */
  field: string | null;
}

/** `form` carries a problem with a field this screen does not show, which belongs to setup. */
interface IdentityProblems {
  name?: string;
  description?: string;
  form?: string;
}

export function ProfileEditor(props: ProfileEditorProps) {
  const { passthrough, publicUrl, isLive, frozenNote, logoUrl, coverUrl, brandAccent } = props;

  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [reviewUrl, setReviewUrl] = useState(props.reviewUrl);

  const [name, setName] = useState(props.name);
  const [description, setDescription] = useState(props.description);
  const [storedIdentity, setStoredIdentity] = useState({
    name: props.name,
    description: props.description,
  });

  const [sections, setSections] = useState<readonly EditorSection[]>(() =>
    props.sections.map(toEditorSection),
  );
  /** The order the server last confirmed, and therefore the order a rejected reorder returns to. */
  const [storedOrder, setStoredOrder] = useState<readonly string[]>(() =>
    props.sections.map((section) => section.id),
  );

  const [identityErrors, setIdentityErrors] = useState<{ name?: string; description?: string }>({});
  const [sectionErrors, setSectionErrors] = useState<Record<string, SectionFailure>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [autoDisabled, setAutoDisabled] = useState<readonly string[]>([]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderStatus, setOrderStatus] = useState('');
  const [orderError, setOrderError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /**
   * Whether a real `drop` landed during the drag in flight.
   *
   * A ref rather than state because `drop` and `dragend` are two browser events in the same gesture
   * and the second has to read what the first recorded, synchronously — a state update would not
   * have been applied yet. See `resolveDragEnd` for why the distinction decides whether AC-021
   * persistence runs at all.
   */
  const droppedRef = useRef(false);

  const frozen = frozenNote !== null;
  const busy = saving || orderBusy;
  const identityEditable = passthrough.slug !== null;

  const identityDirty = name !== storedIdentity.name || description !== storedIdentity.description;
  const dirtySections = useMemo(
    () =>
      sections.filter((section) => sectionPatch(currentOf(section), storedOf(section)) !== null),
    [sections],
  );
  const hasUnsavedChanges = (identityDirty && identityEditable) || dirtySections.length > 0;

  /** D-014's five, minus whatever this tenant actually has. */
  const missingDefaults = useMemo(() => {
    const present = new Set(sections.map((section) => section.type));
    return DEFAULT_SECTION_TYPES.filter((type) => !present.has(type));
  }, [sections]);

  const previewSections = useMemo<readonly PreviewSection[]>(
    () =>
      sections
        // AC-020 as the owner's preview: a hidden section, or one with nothing to point at, is
        // absent here exactly as it is absent from the public HTML.
        .filter((section) => rendersPublicly(storedOf(section), reviewUrl))
        .map((section) => ({ id: section.id, type: section.type, label: section.stored.label })),
    [sections, reviewUrl],
  );

  const clearOutcome = useCallback(() => {
    setSaved(false);
    setAutoDisabled([]);
    setFormError(null);
  }, []);

  const updateSection = useCallback(
    (id: string, edit: SectionEdit) => {
      clearOutcome();
      setSections((current) =>
        current.map((section) => (section.id === id ? applyEdit(section, edit) : section)),
      );
      // A correction should not sit underneath the message it is fixing.
      setSectionErrors(({ [id]: _cleared, ...rest }) => rest);
    },
    [clearOutcome],
  );

  const persistOrder = useCallback(
    async (order: readonly string[]) => {
      if (sameOrder(order, storedOrder)) return;

      setOrderBusy(true);
      const result = await sendJson('/api/v1/business/links/reorder', 'POST', { order });
      setOrderBusy(false);

      if (result.ok) {
        setStoredOrder(order);
        setOrderStatus('Order saved.');
        return;
      }

      // AC-021 makes the server the authority on order, so a rejected reorder returns the screen to
      // what the server last confirmed rather than leaving a position that is not stored anywhere.
      // Only the arrangement is rolled back — anything typed since is left alone.
      setSections((current) => applyOrder(current, storedOrder));
      setOrderStatus('');
      setOrderError(result.failure.message);
    },
    [storedOrder],
  );

  /**
   * The one place a section changes position, whichever control asked.
   *
   * `persist` is false mid-drag: a pointer drag across four rows fires four moves, and posting each
   * one would be four writes for one gesture. A *completed* drop persists the arrangement that
   * resulted; an abandoned drag rolls it back instead — see `handleDragEnd`.
   */
  const move = useCallback(
    (from: number, to: number, persist: boolean) => {
      const next = moveItem(sections, from, to);

      if (next === sections) {
        const moved = sections[from];
        // A press at either end is answered rather than silently ignored: neither button is disabled,
        // because disabling the control just pressed would drop keyboard focus (AC-037).
        if (moved !== undefined) {
          setOrderStatus(
            to <= 0
              ? `${SECTION[moved.type].name} is already first.`
              : `${SECTION[moved.type].name} is already last.`,
          );
        }
        return;
      }

      clearOutcome();
      setOrderError(null);
      setSections(next);

      const moved = sections[from];
      if (moved !== undefined && persist) {
        const position = `position ${to + 1} of ${next.length}`;
        setOrderStatus(`${SECTION[moved.type].name} moved to ${position}.`);
      }

      if (persist) void persistOrder(next.map((section) => section.id));
    },
    [clearOutcome, persistOrder, sections],
  );

  const handleDragStart = useCallback((index: number) => {
    droppedRef.current = false;
    setDragIndex(index);
  }, []);

  const handleDragEnter = useCallback(
    (index: number) => {
      if (dragIndex === null || dragIndex === index) return;
      move(dragIndex, index, false);
      setDragIndex(index);
    },
    [dragIndex, move],
  );

  /** A real drop. Recorded here; `dragend` fires next and is what finishes the gesture. */
  const handleDrop = useCallback(() => {
    if (dragIndex === null) return;
    droppedRef.current = true;
  }, [dragIndex]);

  /**
   * The end of the gesture, dropped or abandoned.
   *
   * `dragend` fires either way, which is why it cannot persist on its own: an owner who drags
   * Instagram across two rows and then presses Escape has abandoned that arrangement, and writing it
   * would apply AC-021 persistence to a move they explicitly cancelled. `resolveDragEnd` draws that
   * line; only the positions are rolled back, so anything typed mid-drag survives.
   */
  const handleDragEnd = useCallback(() => {
    const resolution = resolveDragEnd(
      { dragIndex, dropped: droppedRef.current },
      sections,
      storedOrder,
    );
    droppedRef.current = false;
    if (resolution.outcome === 'ignore') return;

    setDragIndex(null);

    if (resolution.outcome === 'commit') {
      void persistOrder(resolution.order);
      return;
    }

    setSections(resolution.items);
    setOrderStatus('Move cancelled. The order on your page is unchanged.');
  }, [dragIndex, persistOrder, sections, storedOrder]);

  const removeSection = useCallback(
    async (id: string) => {
      clearOutcome();
      setSectionErrors(({ [id]: _cleared, ...rest }) => rest);

      setSaving(true);
      const result = await sendJson(`/api/v1/business/links/${id}`, 'DELETE');
      setSaving(false);

      if (!result.ok) {
        setSectionErrors((current) => ({
          ...current,
          [id]: { message: result.failure.message, field: null },
        }));
        return;
      }

      setSections((current) => current.filter((section) => section.id !== id));
      setStoredOrder((current) => current.filter((storedId) => storedId !== id));
    },
    [clearOutcome],
  );

  /**
   * Saves the business details and every changed section.
   *
   * Sequential rather than concurrent, on purpose: each request is its own write that bumps
   * `config_version`, and a failure has to be attributable to the section that caused it. Five
   * parallel PATCHes would be five transactions racing to bump one row for no gain at this size.
   *
   * A section that saves stays saved even when a later one fails, so a retry re-sends only what is
   * still outstanding.
   */
  const save = useCallback(async () => {
    if (frozen) return;

    setFormError(null);
    setSaved(false);
    setAutoDisabled([]);

    const identityProblems: IdentityProblems = identityEditable
      ? checkIdentity(name, description, passthrough)
      : {};
    const sectionProblems = checkSections(sections);

    setIdentityErrors({
      ...(identityProblems.name ? { name: identityProblems.name } : {}),
      ...(identityProblems.description ? { description: identityProblems.description } : {}),
    });
    setSectionErrors(sectionProblems);

    if (
      identityProblems.name ||
      identityProblems.description ||
      identityProblems.form ||
      Object.keys(sectionProblems).length > 0
    ) {
      setFormError(identityProblems.form ?? 'Please check the highlighted fields and try again.');
      return;
    }

    setSaving(true);
    const failures: Record<string, SectionFailure> = {};
    const switchedOff: string[] = [];
    let failed = false;

    if (identityDirty && identityEditable && passthrough.slug !== null) {
      const trimmedDescription = description.trim();
      const result = await sendJson('/api/v1/business', 'PATCH', {
        name: name.trim(),
        category: passthrough.category,
        // An empty box means "no description", which the endpoint stores as NULL. Sending '' would
        // store an empty string instead, and the two would then have to be told apart everywhere.
        ...(trimmedDescription === '' ? {} : { description: trimmedDescription }),
        city: passthrough.city,
        state: passthrough.state,
        slug: passthrough.slug,
        timezone: passthrough.timezone,
      });

      if (result.ok) {
        setStoredIdentity({ name: name.trim(), description: trimmedDescription });
        setName(name.trim());
        setDescription(trimmedDescription);
      } else {
        failed = true;
        const named = result.failure.fields;
        if (named.includes('name') || named.includes('description')) {
          setIdentityErrors({
            ...(named.includes('name') ? { name: result.failure.message } : {}),
            ...(named.includes('description') ? { description: result.failure.message } : {}),
          });
        } else {
          setFormError(result.failure.message);
        }
      }
    }

    for (const section of sections) {
      const patch = sectionPatch(currentOf(section), storedOf(section));
      if (patch === null) continue;

      const result = await sendJson(`/api/v1/business/links/${section.id}`, 'PATCH', patch);

      if (!result.ok) {
        failed = true;
        failures[section.id] = {
          message: result.failure.message,
          field: result.failure.fields[0] ?? null,
        };
        continue;
      }

      const stored = readSavedSection(result.payload);
      if (result.payload.autoDisabled === true) switchedOff.push(SECTION[section.type].name);

      setSections((current) =>
        current.map((item) =>
          item.id === section.id ? adoptStored(item, stored ?? currentValues(item)) : item,
        ),
      );
    }

    setSectionErrors(failures);
    setAutoDisabled(switchedOff);
    setSaving(false);
    if (!failed) setSaved(true);
  }, [description, frozen, identityDirty, identityEditable, name, passthrough, sections]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Business profile
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Your public page</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          This is the page a customer lands on from a QR code or a link you share. Anything you
          hide, or leave without a link, is not on the page at all.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {/* Two views, one at a time, so the pressed state says which one is showing. */}
          <div role="group" aria-label="View" className="flex flex-wrap gap-2">
            <Button
              variant={view === 'edit' ? 'primary' : 'secondary'}
              aria-pressed={view === 'edit'}
              onClick={() => setView('edit')}
            >
              Edit
            </Button>
            <Button
              variant={view === 'preview' ? 'primary' : 'secondary'}
              aria-pressed={view === 'preview'}
              onClick={() => setView('preview')}
            >
              Preview
            </Button>
          </div>

          {/*
            Open page appears only once the business is live: `lib/public-business.ts` resolves only
            an ACTIVE tenant, so before that the link would answer "unavailable" — the same rule the
            dashboard's PublicPageCard follows.
          */}
          {isLive && publicUrl !== null && (
            <a href={publicUrl} target="_blank" rel="noreferrer" className={SECONDARY_LINK}>
              Open live page
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>

      {frozenNote !== null && (
        <div
          role="status"
          className="rounded-card border border-warning bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <p className="font-semibold">
            <span aria-hidden="true">{'•••'}</span> Editing is paused
          </p>
          <p>{frozenNote}</p>
        </div>
      )}

      {view === 'preview' ? (
        <>
          <ProfilePreview
            name={storedIdentity.name}
            description={storedIdentity.description === '' ? null : storedIdentity.description}
            logoUrl={logoUrl}
            coverUrl={coverUrl}
            sections={previewSections}
            hiddenCount={sections.length - previewSections.length}
            hasUnsavedChanges={hasUnsavedChanges}
            publicUrl={publicUrl}
            isLive={isLive}
          />
          <div>
            <Button variant="secondary" onClick={() => setView('edit')}>
              Back to editing
            </Button>
          </div>
        </>
      ) : (
        <>
          <Card
            title="Business details"
            titleAs="h2"
            description="Your name and description as customers read them."
          >
            {identityEditable ? (
              <div className="flex flex-col gap-5">
                <Field label="Business name" required error={identityErrors.name ?? null}>
                  {(control) => (
                    <Input
                      {...control}
                      name="name"
                      value={name}
                      maxLength={NAME_MAX}
                      autoComplete="organization"
                      disabled={busy || frozen}
                      onChange={(event) => {
                        clearOutcome();
                        setIdentityErrors(({ name: _cleared, ...rest }) => rest);
                        setName(event.target.value);
                      }}
                    />
                  )}
                </Field>

                <Field
                  label="Short description"
                  hint="Optional. A line or two about what you do."
                  error={identityErrors.description ?? null}
                >
                  {(control) => (
                    <>
                      <Textarea
                        {...control}
                        name="description"
                        rows={3}
                        value={description}
                        maxLength={DESCRIPTION_MAX}
                        disabled={busy || frozen}
                        onChange={(event) => {
                          clearOutcome();
                          setIdentityErrors(({ description: _cleared, ...rest }) => rest);
                          setDescription(event.target.value);
                        }}
                      />
                      {/*
                        No live region on the counter: announcing a number on every keystroke is
                        chatter, and the limit is already in the field's description.
                      */}
                      <p className="text-sm text-ink-muted" aria-hidden="true">
                        {DESCRIPTION_MAX - description.length} characters left
                      </p>
                    </>
                  )}
                </Field>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Your page needs a web address before these can be saved.{' '}
                <Link
                  href={BUSINESS_STEP_PATH}
                  className="font-medium text-accent underline-offset-4 hover:underline"
                >
                  Choose one in setup
                </Link>
                , and this card becomes editable.
              </p>
            )}
          </Card>

          <ReviewLocationCard
            initialUrl={props.reviewLocation.url}
            initialOpenUrl={props.reviewLocation.openUrl}
            initialKind={props.reviewLocation.kind}
            initialEnabled={props.reviewLocation.enabled}
            disabled={busy || frozen}
            onSaved={setReviewUrl}
          />

          <AppearanceCard logoUrl={logoUrl} coverUrl={coverUrl} brandAccent={brandAccent} />

          <Card
            title="Sections"
            titleAs="h2"
            description="Each section is one button on your page. Drag a section, or use the up and down buttons, to change the order visitors see."
          >
            <div className="flex flex-col gap-4">
              {orderError !== null && <InlineError>{orderError}</InlineError>}

              {/*
                Polite, and outside the list: reordering is announced here because moving a row does
                not otherwise say anything to a screen reader, and because a keyboard press at either
                end is answered rather than silently ignored (AC-037).
              */}
              <p role="status" aria-live="polite" className="min-h-5 text-sm text-ink-muted">
                {orderStatus}
              </p>

              {sections.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Your page has no sections yet.{' '}
                  <Link
                    href={LINKS_STEP_PATH}
                    className="font-medium text-accent underline-offset-4 hover:underline"
                  >
                    Add your contact buttons in setup
                  </Link>
                  .
                </p>
              ) : (
                /*
                  role="list" is restored deliberately: `list-style: none` drops list semantics in
                  Safari, and how many sections there are — and which position each is in — is the
                  point of this list.
                */
                /*
                  The list is a drop target as well as each row.

                  Only rows accepted a drop before, so releasing in the gap between two of them —
                  or just past the last one — landed on nothing, dragend saw no drop, and the
                  arrangement was rolled back. The owner had done everything right and the reorder
                  silently vanished. Committing at the last hovered position is what they meant;
                  Escape still cancels, because that path never sets droppedRef.
                */
                <ul
                  role="list"
                  className="m-0 flex list-none flex-col gap-3 p-0"
                  onDragOver={(event) => {
                    if (dragIndex !== null) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (dragIndex === null) return;
                    event.preventDefault();
                    handleDrop();
                  }}
                >
                  {sections.map((section, index) => (
                    <SectionRow
                      key={section.id}
                      section={section}
                      index={index}
                      total={sections.length}
                      reviewUrl={reviewUrl}
                      disabled={busy || frozen}
                      error={sectionErrors[section.id] ?? null}
                      onChange={updateSection}
                      onMove={(from, to) => move(from, to, true)}
                      onRemove={removeSection}
                      onDragStart={handleDragStart}
                      onDragEnter={handleDragEnter}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                      isDragging={dragIndex === index}
                    />
                  ))}
                </ul>
              )}

              {missingDefaults.length > 0 && (
                <p className="text-sm text-ink-muted">
                  {missingDefaults.map((type) => SECTION[type].name).join(', ')}{' '}
                  {missingDefaults.length === 1 ? 'is' : 'are'} not on your page yet.{' '}
                  <Link
                    href={LINKS_STEP_PATH}
                    className="font-medium text-accent underline-offset-4 hover:underline"
                  >
                    Add them in setup
                  </Link>
                  .
                </p>
              )}

              {/*
                Add section is listed by the screen spec, and there is no endpoint that creates one:
                GET/PUT /business/links writes the five defaults only. Marked unavailable rather than
                rendered as a button that cannot work. Reported in concerns.
              */}
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                <Button variant="secondary" disabled>
                  Add section
                </Button>
                <Badge tone="neutral">Soon</Badge>
                <p className="text-sm text-ink-muted">
                  Extra sections — a website, directions, a link of your own — are not available
                  yet.
                </p>
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-3">
            {formError !== null && <InlineError>{formError}</InlineError>}

            {autoDisabled.length > 0 && (
              <p
                role="status"
                className="rounded-card border border-warning bg-warning-soft px-4 py-3 text-sm text-warning"
              >
                {autoDisabled.join(', ')} {autoDisabled.length === 1 ? 'was' : 'were'} switched off,
                because a section with no link cannot be shown on your page.
              </p>
            )}

            {saved && (
              <p
                role="status"
                className="rounded-card border border-success bg-success-soft px-4 py-3 text-sm text-success"
              >
                <span aria-hidden="true">{'✓'}</span> Saved. Your page is up to date.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                loading={saving}
                loadingLabel="Saving your page…"
                disabled={frozen || !hasUnsavedChanges}
                onClick={() => void save()}
              >
                Save changes
              </Button>
              <Button variant="secondary" onClick={() => setView('preview')}>
                Preview
              </Button>
              {!hasUnsavedChanges && !saved && (
                <p className="text-sm text-ink-muted">Nothing to save right now.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function toEditorSection(section: StoredSection): EditorSection {
  const values = {
    label: section.label,
    url: section.url ?? '',
    phone: section.phone ?? '',
    enabled: section.enabled,
  };
  return { id: section.id, type: section.type, ...values, stored: values };
}

function currentValues(section: EditorSection): {
  label: string;
  url: string;
  phone: string;
  enabled: boolean;
} {
  return {
    label: section.label,
    url: section.url,
    phone: section.phone,
    enabled: section.enabled,
  };
}

/**
 * Adopts what the server stored, not what was typed.
 *
 * It normalises a phone number to E.164 (D-002: a bare 10-digit Indian number becomes +91…) and may
 * have switched the section off because its target was cleared, so showing the typed value back would
 * misreport the row until the next reload.
 */
function adoptStored(
  section: EditorSection,
  stored: { label: string; url: string; phone: string; enabled: boolean },
): EditorSection {
  return { ...section, ...stored, stored };
}

function readSavedSection(
  payload: Record<string, unknown>,
): { label: string; url: string; phone: string; enabled: boolean } | null {
  const section = payload.section;
  if (typeof section !== 'object' || section === null) return null;

  const row = section as Record<string, unknown>;
  if (typeof row.label !== 'string' || typeof row.enabled !== 'boolean') return null;

  return {
    label: row.label,
    url: typeof row.url === 'string' ? row.url : '',
    phone: typeof row.phone === 'string' ? row.phone : '',
    enabled: row.enabled,
  };
}

/**
 * Checks the identity against the contract before spending a request on it.
 *
 * `businessIdentityRequest` is authoritative — the endpoint parses the same schema — so the rules are
 * not restated here, only the messages. An issue on a field this screen does not show is reported as
 * a form-level problem pointing at setup, because there is no box here to attach it to.
 */
function checkIdentity(
  name: string,
  description: string,
  passthrough: IdentityPassthrough,
): IdentityProblems {
  const trimmedDescription = description.trim();
  const parsed = businessIdentityRequest.safeParse({
    name: name.trim(),
    category: passthrough.category,
    ...(trimmedDescription === '' ? {} : { description: trimmedDescription }),
    city: passthrough.city,
    state: passthrough.state,
    slug: passthrough.slug ?? '',
    timezone: passthrough.timezone,
  });

  if (parsed.success) return {};

  const problems: IdentityProblems = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field === 'name') {
      problems.name ??= 'Enter your business name — at least 2 characters.';
    } else if (field === 'description') {
      problems.description ??= `Keep your description to ${DESCRIPTION_MAX} characters or fewer.`;
    } else {
      problems.form ??= 'Some of your business details need fixing in setup before this can save.';
    }
  }
  return problems;
}

/**
 * The checks worth making before a request, and only those.
 *
 * An empty button text and a url without a scheme are both certain refusals, so catching them here
 * saves a round trip. Phone shape is deliberately left to the server: `normalizePhone` in
 * `@ai-review/core` is authoritative and cannot be imported into a browser bundle — the barrel reaches
 * @node-rs/argon2 and ioredis — and a third hand-written copy of it in the app is how the client and
 * the server start disagreeing about which numbers are valid.
 */
function checkSections(sections: readonly EditorSection[]): Record<string, SectionFailure> {
  const problems: Record<string, SectionFailure> = {};

  for (const section of sections) {
    if (sectionPatch(currentOf(section), storedOf(section)) === null) continue;

    if (section.label.trim() === '') {
      problems[section.id] = { message: 'Give the button a name.', field: 'label' };
      continue;
    }

    if (sectionTarget(section.type) === 'url' && section.url.trim() !== '') {
      if (!isHttpsUrl(section.url.trim())) {
        problems[section.id] = {
          // The endpoint's own sentence, so an immediate check and the authoritative one never
          // describe one problem two ways.
          message: 'Enter a full web address starting with https://',
          field: 'url',
        };
      }
    }
  }

  return problems;
}

/** Mirrors both endpoints: only https is stored, so only https is accepted. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
