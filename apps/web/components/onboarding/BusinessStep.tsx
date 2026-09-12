'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { businessIdentityRequest } from '@ai-review/contracts';
import {
  Badge,
  Button,
  Field,
  InlineError,
  Input,
  Select,
  Spinner,
  Textarea,
  type SelectOption,
} from '@ai-review/ui';
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  PLACE_MAX,
  contractMessage,
  describeUnavailable,
  isFieldKey,
  readAvailability,
  readFailure,
  readSaved,
  requiredErrors,
  saveOutcome,
  type Availability,
  type BusinessIdentityValues,
  type FieldErrors,
  type FieldKey,
  type SavedIdentity,
} from './business-identity';
import { WizardShell } from './WizardShell';

// Re-exported because the page imports it from here; the definition moved, the import site did not.
export type { BusinessIdentityValues };

/**
 * ONB-01 — business identity.
 *
 * The screen spec asks for five states: `default`, `slug available`, `slug unavailable`,
 * `uploading` and `saved`. Four are here. `uploading` is not, and neither is the logo field it
 * belongs to: 03_Screen_Field_Button_Spec.md specifies the upload, but V1's route tree has no
 * upload endpoint, so a file input here could only take a file and drop it. Left out and reported
 * rather than faked.
 *
 * Saving is this screen's job — WizardShell owns the chrome, the progress rail and the routing, and
 * only wants a boolean back. `onContinue` and `onSaveAndExit` are therefore the same function
 * (`submit`): both persist the same identity, and where the owner goes afterwards is the shell's
 * business. The one exception is the Flow I redirect notice, which has to be read before the shell
 * routes away from it — see `submit`.
 *
 * The branch-heavy pure parts — required fields, rejection copy, payload narrowing — live in
 * ./business-identity so they can be unit tested; the unit suite has no DOM.
 */

/**
 * Debounce before asking whether an address is free.
 *
 * A request per keystroke would put roughly ten authenticated round trips per second per owner onto
 * /business/slug-available — each one resolving a session and hitting the slug namespace — to
 * answer a question that only matters once typing settles.
 */
const AVAILABILITY_DEBOUNCE_MS = 450;

/**
 * The cap is stated in the hint, not only in the counter beside the box.
 *
 * Field wires the hint to the control with aria-describedby, so it is read out with the field. The
 * counter is aria-hidden (see below) and `maxLength` truncates silently, so without this a screen
 * reader user is told neither that a limit exists nor that input has stopped being accepted
 * (AC-037, AC-038).
 */
const DESCRIPTION_HINT =
  `Optional, up to ${DESCRIPTION_MAX} characters. ` +
  'A line or two about what you do — the Ai uses it as background.';

/**
 * India-focused starting list.
 *
 * Not an enumeration the spec provides: 19_Admin_Panel_Spec.md lists "available business
 * categories" as platform configuration, which does not exist yet. Each value is its own label
 * because businesses.category is free text (varchar 100) that the prompt builder hands to the model
 * as-is (packages/core/src/ai/prompt-builder.ts), so the stored string has to read as natural
 * language rather than as a key. When platform_settings owns this list it should carry stable keys
 * plus display labels; see concerns.
 */
const CATEGORY_LABELS: readonly string[] = [
  'Restaurant',
  'Cafe or coffee shop',
  'Bakery or sweet shop',
  'Cloud kitchen',
  'Salon or spa',
  'Gym or fitness studio',
  'Clinic or doctor',
  'Dental clinic',
  'Diagnostics or pathology lab',
  'Pharmacy',
  'Hospital',
  'Veterinary clinic or pet care',
  'Grocery or kirana store',
  'Retail store',
  'Clothing store or boutique',
  'Jewellery store',
  'Mobile or electronics store',
  'Furniture or home decor',
  'Hardware or building material',
  'Optician',
  'Car or bike service',
  'Automobile showroom',
  'Hotel or guest house',
  'Travel agency or tour operator',
  'Event planning',
  'Photography or videography',
  'Interior design',
  'Real estate agency',
  'Packers and movers',
  'Courier or logistics',
  'Laundry or dry cleaning',
  'Coaching or tuition centre',
  'School or preschool',
  'Computer or IT services',
  'Digital marketing agency',
  'Chartered accountant or tax consultant',
  'Legal services',
  'Insurance or financial services',
  'Home services (plumbing, electrical, cleaning)',
  'Tattoo studio',
  'Other',
];

const CATEGORY_OPTIONS: readonly SelectOption[] = CATEGORY_LABELS.map((label) => ({
  value: label,
  label,
}));

/**
 * Constants that live in @ai-review/core, passed in as props rather than imported.
 *
 * '@ai-review/core' exposes one root entry point that re-exports the whole domain, so importing
 * SLUG_MIN_LENGTH or normalizeSlug here would pull pg, ioredis and @node-rs/argon2 into the browser
 * bundle. Slug rules therefore stay server-side entirely: these numbers arrive as data, and
 * normalization is done by the server (see the availability effect below).
 */
export interface BusinessStepRules {
  slugMinLength: number;
  slugMaxLength: number;
  /** Flow I: how long a replaced address keeps redirecting. */
  aliasRetentionDays: number;
}

export interface BusinessStepProps {
  initial: BusinessIdentityValues;
  /**
   * False while no address has been claimed, which is what licenses this screen to keep rewriting
   * the slug as the business name is typed. Once one is claimed it is the tenant's public identity
   * and is never overwritten on their behalf.
   */
  slugClaimed: boolean;
  rules: BusinessStepRules;
  /** e.g. `review.digitalhammerr.com/`, so an owner reads the whole address before committing. */
  publicUrlPrefix: string;
}

/**
 * What the availability endpoint has said about the address currently in the field.
 *
 * There is deliberately no "which address is this about" member: every edit to the slug or to the
 * name re-runs the effect below, which immediately replaces the verdict with `checking` or `idle`.
 * The verdict therefore always describes what is on screen, and nothing has to compare strings to
 * work out whether it has gone stale.
 */
type SlugVerdict =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'unavailable'; message: string; suggestions: readonly string[] };

export function BusinessStep({ initial, slugClaimed, rules, publicUrlPrefix }: BusinessStepProps) {
  const { slugMinLength, slugMaxLength, aliasRetentionDays } = rules;

  const [values, setValues] = useState<BusinessIdentityValues>(initial);
  const [slugEdited, setSlugEdited] = useState(slugClaimed);
  const [verdict, setVerdict] = useState<SlugVerdict>(
    // A claimed address belongs to this business, so isAvailableFor would answer yes; asking on
    // every visit to the step would spend a request confirming what the row already says.
    slugClaimed && initial.slug !== '' ? { kind: 'available' } : { kind: 'idle' },
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedIdentity | null>(null);
  /**
   * True while a Flow I redirect notice is on screen unread. See `submit`: it is what stops
   * WizardShell routing away from the only copy that tells an owner their old address still works.
   */
  const [noticePending, setNoticePending] = useState(false);
  const [busy, setBusy] = useState(false);

  const slugStatusId = useId();

  /** The question already answered, as `mode:query`, so a re-render cannot re-ask it. */
  const answered = useRef(slugClaimed && initial.slug !== '' ? `slug:${initial.slug}` : '');

  /**
   * A category the platform set before this list existed — the seed's 'Restaurant', or anything an
   * admin wrote — has to stay selectable, or revisiting this step would silently replace it.
   */
  const categoryOptions = useMemo<readonly SelectOption[]>(() => {
    if (initial.category === '' || CATEGORY_LABELS.includes(initial.category)) {
      return CATEGORY_OPTIONS;
    }
    return [...CATEGORY_OPTIONS, { value: initial.category, label: initial.category }];
  }, [initial.category]);

  const update = useCallback((field: FieldKey, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    // Clears this field's error, so a correction is not made under a stale message.
    setFieldErrors(({ [field]: _cleared, ...rest }) => rest);
    setFormError(null);
    // The panel described what was saved, which this edit no longer matches. Dropping the pending
    // flag with it is what makes the next Continue save the edit instead of navigating away.
    setSaved(null);
    setNoticePending(false);
  }, []);

  const applyAvailability = useCallback(
    (availability: Availability, askedAbout: 'slug' | 'name') => {
      const adopt = (slug: string) =>
        setValues((current) => (current.slug === slug ? current : { ...current, slug }));

      if (availability.available) {
        if (askedAbout === 'name') adopt(availability.slug);
        setVerdict({ kind: 'available' });
        return;
      }

      const message = describeUnavailable(availability.reason, slugMinLength, slugMaxLength);

      if (askedAbout === 'name') {
        /*
         * A business name is almost never a legal address — capitals, spaces, an apostrophe — so
         * the endpoint's verdict on the raw name is not something to show anybody. Its suggestions
         * are normalized forms it has already confirmed are free, so the first of them is the seed.
         *
         * With no suggestion left (every derivative taken, or the name too short to normalize into
         * anything legal) the normalized name is adopted anyway, so that the message under the
         * field is about the address the field actually shows.
         */
        const [best] = availability.suggestions;
        adopt(best ?? availability.slug);
        setVerdict(
          best === undefined
            ? { kind: 'unavailable', message, suggestions: [] }
            : { kind: 'available' },
        );
        return;
      }

      setVerdict({ kind: 'unavailable', message, suggestions: availability.suggestions });
    },
    [slugMaxLength, slugMinLength],
  );

  /**
   * Live availability, and the other half of seeding the address from the business name.
   *
   * While the owner has not touched the slug field, the question asked is about the *name*: the
   * endpoint answers with the normalized form alongside free alternatives, which is how
   * normalizeSlug stays one implementation instead of being copied into the browser. Once they have
   * edited the field the question is about the field, and their text is never rewritten under them.
   */
  useEffect(() => {
    const askedAbout = slugEdited ? 'slug' : 'name';
    const query = (slugEdited ? values.slug : values.name).trim();
    const key = `${askedAbout}:${query}`;

    /*
     * Both guards forget what was answered before going idle. Without that, deleting back to an
     * empty field (or below the minimum) and then retyping the same text hits `key ===
     * answered.current` below and returns with the verdict still forced to `idle` — an address that
     * shows as valid with no "Available" badge and no status line at all. Re-asking once after the
     * debounce is far cheaper than a silently blank verdict, and the memo's actual job — not asking
     * per keystroke — is untouched.
     */
    if (query === '') {
      answered.current = '';
      setVerdict({ kind: 'idle' });
      return;
    }
    // Normalization only ever removes characters, so a name shorter than the minimum cannot yield a
    // legal address yet. Asking would report "too short" at every keystroke of a short name.
    if (askedAbout === 'name' && query.length < slugMinLength) {
      answered.current = '';
      setVerdict({ kind: 'idle' });
      return;
    }
    if (key === answered.current) return;

    setVerdict({ kind: 'checking' });

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/v1/business/slug-available?slug=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          );
          const availability = response.ok ? readAvailability(await response.json()) : null;

          if (!availability) {
            // This check is advisory. PATCH is what actually claims the address and is
            // authoritative — two tenants can race for the same free one — so a failed check must
            // never be the thing that stops someone continuing.
            setVerdict({ kind: 'idle' });
            return;
          }

          answered.current = key;
          applyAvailability(availability, askedAbout);
        } catch {
          // An aborted request is this effect being superseded, not a failure worth reporting.
          if (!controller.signal.aborted) setVerdict({ kind: 'idle' });
        }
      })();
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [applyAvailability, slugEdited, slugMinLength, values.name, values.slug]);

  function chooseSuggestion(slug: string) {
    // The endpoint only offers alternatives it has confirmed are free, so this needs no re-check.
    answered.current = `slug:${slug}`;
    setValues((current) => ({ ...current, slug }));
    setSlugEdited(true);
    setVerdict({ kind: 'available' });
    setFieldErrors(({ slug: _cleared, ...rest }) => rest);
    // Same reason as in `update`: the address on screen is no longer the one that was saved.
    setSaved(null);
    setNoticePending(false);
  }

  /**
   * Persists the identity, answering with what the tenant now holds — or null if it holds nothing
   * new, in which case the reason is already on screen.
   *
   * The saved identity rather than a boolean, because the caller has to know whether this save
   * replaced an address: that is the difference between moving on and stopping to say so.
   */
  const persist = useCallback(async (): Promise<SavedIdentity | null> => {
    setFormError(null);
    setSaved(null);
    setNoticePending(false);

    const description = values.description.trim();
    const body = {
      name: values.name.trim(),
      category: values.category,
      // An empty box means "no description", which the endpoint stores as NULL. Sending '' would
      // store an empty string instead, and the two would then have to be told apart everywhere.
      description: description === '' ? undefined : description,
      city: values.city.trim(),
      state: values.state.trim(),
      slug: values.slug.trim(),
      timezone: values.timezone,
    };

    const errors = requiredErrors(body);

    const parsed = businessIdentityRequest.safeParse(body);
    if (!parsed.success) {
      let unattributed = false;
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (isFieldKey(field)) {
          errors[field] ??= contractMessage(field, slugMinLength, slugMaxLength);
        } else {
          unattributed = true;
        }
      }
      // An issue with no field to attach to would otherwise be an invisible refusal to save.
      if (unattributed) setFormError('Please check the details you entered.');
    }

    // The check is advisory, but there is no point spending a PATCH on an address it has already
    // said is taken.
    if (verdict.kind === 'unavailable') errors.slug ??= verdict.message;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return null;
    }
    setFieldErrors({});

    setBusy(true);
    try {
      const response = await fetch('/api/v1/business', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const failure = readFailure(payload);
        const named = failure.fields.filter(isFieldKey);

        if (named.length === 0) {
          setFormError(failure.message);
          return null;
        }

        setFieldErrors(Object.fromEntries(named.map((field) => [field, failure.message])));
        // The claim is authoritative: if it says the address is taken, the field has to stop
        // showing "Available" beside it.
        if (named.includes('slug')) {
          setVerdict({ kind: 'unavailable', message: failure.message, suggestions: [] });
          answered.current = '';
        }
        return null;
      }

      const identity = readSaved(payload, body.slug);
      answered.current = `slug:${identity.slug}`;
      setValues((current) => ({ ...current, slug: identity.slug }));
      // Claimed now, so it stops following the business name for the rest of this session.
      setSlugEdited(true);
      setVerdict({ kind: 'available' });
      setSaved(identity);
      return identity;
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [slugMaxLength, slugMinLength, values, verdict]);

  /**
   * What WizardShell calls for both Continue and Save & exit.
   *
   * Flow I's disclosure versus the shell's routing. The shell navigates on every truthy return —
   * `handleContinue` pushes the next step, `handleSaveAndExit` pushes /app — which would unmount the
   * `saved` panel in the same tick it appeared. That panel is the only place an owner is ever told
   * that the address they just replaced keeps redirecting for `aliasRetentionDays` days, and Flow I
   * says they should be told rather than discover it.
   *
   * So a save that replaced an address answers false: the identity IS persisted, the notice stays on
   * screen, and Continue relabels to ask for an acknowledgement. The next press leaves without
   * re-saving, and an edit in between clears the flag so that the edit is saved instead (`update`).
   * Nothing is retried and nothing is lost either way.
   */
  const submit = useCallback(async (): Promise<boolean> => {
    // The notice has been on screen since the last press, so it has had its chance to be read.
    if (noticePending) return true;

    const outcome = saveOutcome(await persist());
    if (outcome === 'hold-for-notice') setNoticePending(true);
    return outcome === 'leave';
  }, [noticePending, persist]);

  /*
   * The Continue button is at the foot of a long form and the panel is at its head, so on a phone
   * the notice can be held for a disclosure the owner never sees scrolled off the top. Assistive
   * technology gets it from the panel's role="status"; this is the same courtesy for everyone else.
   * Default (instant) scrolling, so there is no animation to opt out of.
   */
  const noticeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (noticePending) noticeRef.current?.scrollIntoView({ block: 'center' });
  }, [noticePending]);

  const descriptionLeft = DESCRIPTION_MAX - values.description.length;

  return (
    <WizardShell
      stepId="business"
      heading="Tell us about your business"
      description="This is what customers see when they land on your review page."
      onContinue={submit}
      // The same function: both persist this identity, and only the destination differs — which is
      // the shell's decision, not this screen's.
      onSaveAndExit={submit}
      // Says what the press does while the redirect notice is waiting to be read: this one leaves,
      // it does not save again.
      continueLabel={noticePending ? 'Got it, continue' : undefined}
      busy={busy}
    >
      <div className="flex flex-col gap-5">
        {formError && <InlineError>{formError}</InlineError>}

        {saved && (
          <div
            ref={noticeRef}
            role="status"
            className="rounded-card border border-success bg-success-soft px-4 py-3 text-sm text-success"
          >
            <p className="font-semibold">
              <span aria-hidden="true">{'✓'}</span> Saved
            </p>
            <p>
              Your page address is{' '}
              <span className="font-semibold break-all">
                {publicUrlPrefix}
                {saved.slug}
              </span>
              .
            </p>
            {saved.previousSlug !== null && (
              // Flow I: the address this replaced keeps working, and an owner should be told so
              // rather than discovering it — anything already printed still leads here.
              <>
                <p className="mt-1 break-all">
                  {publicUrlPrefix}
                  {saved.previousSlug} will redirect here for the next {aliasRetentionDays} days.
                </p>
                <p className="mt-1">Your details are saved — continue when you have read this.</p>
              </>
            )}
          </div>
        )}

        <Field
          label="Business name"
          required
          error={fieldErrors.name}
          hint="Exactly as customers know it."
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              autoComplete="organization"
              maxLength={NAME_MAX}
              disabled={busy}
            />
          )}
        </Field>

        <Field
          label="Category"
          required
          error={fieldErrors.category}
          hint="Helps the Ai describe the kind of place you are. Pick the closest match."
        >
          {(control) => (
            <Select
              {...control}
              name="category"
              options={categoryOptions}
              placeholder="Choose a category"
              value={values.category}
              onChange={(event) => update('category', event.target.value)}
              disabled={busy}
            />
          )}
        </Field>

        <Field label="Short description" error={fieldErrors.description} hint={DESCRIPTION_HINT}>
          {(control) => (
            <>
              <Textarea
                {...control}
                name="description"
                value={values.description}
                onChange={(event) => update('description', event.target.value)}
                maxLength={DESCRIPTION_MAX}
                rows={3}
                disabled={busy}
              />
              {/*
                No live region on the counter: announcing a number on every keystroke is chatter,
                and the limit is already in the hint, which assistive technology reads out with the
                field.
              */}
              <p className="text-sm text-ink-muted" aria-hidden="true">
                {descriptionLeft} characters left
              </p>
            </>
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="City" required error={fieldErrors.city}>
            {(control) => (
              <Input
                {...control}
                name="city"
                value={values.city}
                onChange={(event) => update('city', event.target.value)}
                autoComplete="address-level2"
                maxLength={PLACE_MAX}
                disabled={busy}
              />
            )}
          </Field>

          <Field label="State" required error={fieldErrors.state}>
            {(control) => (
              <Input
                {...control}
                name="state"
                value={values.state}
                onChange={(event) => update('state', event.target.value)}
                autoComplete="address-level1"
                maxLength={PLACE_MAX}
                disabled={busy}
              />
            )}
          </Field>
        </div>

        <Field
          label="Your page address"
          required
          error={fieldErrors.slug}
          hint="Lowercase letters, numbers and hyphens. We suggest one from your business name."
        >
          {(control) => (
            <div className="flex flex-col gap-2">
              <Input
                {...control}
                // The status line lives outside Field's error slot (see below), so its id is added
                // to the description the control already carries rather than replacing it.
                aria-describedby={describedBy(control['aria-describedby'], slugStatusId)}
                aria-invalid={
                  control['aria-invalid'] ?? (verdict.kind === 'unavailable' || undefined)
                }
                name="slug"
                value={values.slug}
                // Folded to lowercase as it is typed. The namespace is case-insensitive (ONB-01-01,
                // a citext primary key), so this refuses nothing the server would accept — it only
                // heads off the commonest false rejection.
                onChange={(event) => {
                  setSlugEdited(true);
                  update('slug', event.target.value.toLowerCase());
                }}
                inputMode="url"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={slugMaxLength}
                disabled={busy}
              />

              <p className="text-sm break-all text-ink-muted">
                <span className="sr-only">Your page address will be </span>
                {publicUrlPrefix}
                <span className="font-semibold text-ink">{values.slug || 'your-business'}</span>
              </p>

              {/*
                Polite, and deliberately not Field's `error` slot. Field renders InlineError with
                role="alert", which is right for a submit-time failure and wrong here: this verdict
                changes every time typing settles, and an assertive interruption per debounce tick
                talks over somebody still entering their address. The field's own error slot stays
                for the errors Continue raises.
              */}
              <div
                id={slugStatusId}
                role="status"
                aria-live="polite"
                className="flex min-h-6 flex-wrap items-center gap-2 text-sm"
              >
                <SlugVerdictLine verdict={verdict} />
              </div>

              {verdict.kind === 'unavailable' && verdict.suggestions.length > 0 && (
                // Outside the live region: buttons appearing inside one get read out with it.
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-ink-muted">These are free — pick one to use it:</p>
                  <div className="flex flex-wrap gap-2">
                    {verdict.suggestions.map((suggestion) => (
                      <Button
                        key={suggestion}
                        variant="secondary"
                        disabled={busy}
                        onClick={() => chooseSuggestion(suggestion)}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Field>
      </div>
    </WizardShell>
  );
}

/**
 * The availability verdict as one line of text.
 *
 * Each state pairs a word or a glyph with its colour, never colour alone
 * (18_UI_UX_Design_System_Brief.md): "Available" is a word in a badge, and an unavailable address
 * gets InlineError's warning glyph plus the reason.
 */
function SlugVerdictLine({ verdict }: { verdict: SlugVerdict }) {
  switch (verdict.kind) {
    case 'checking':
      return (
        <>
          <Spinner size="sm" />
          <span className="text-ink-muted">Checking whether that address is free…</span>
        </>
      );
    case 'available':
      return (
        <>
          <Badge tone="success">Available</Badge>
          <span className="text-ink-muted">This address is yours to take.</span>
        </>
      );
    case 'unavailable':
      return <InlineError role="status">{verdict.message}</InlineError>;
    case 'idle':
      return null;
  }
}

function describedBy(existing: string | undefined, statusId: string): string {
  return [existing, statusId].filter((value): value is string => value !== undefined).join(' ');
}
