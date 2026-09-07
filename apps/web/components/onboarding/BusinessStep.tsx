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
import type { SubmitFailure } from '../auth/use-form-submit';
import { WizardShell } from './WizardShell';

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
 * only wants a boolean back. `onContinue` and `onSaveAndExit` are therefore the same function: both
 * persist the same identity, and where the owner goes afterwards is the shell's business.
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
 * Mirrors businessIdentityRequest so the inputs can cap length as they are typed. The contract is
 * authoritative and is what actually gates the save; these only stop an owner writing 900
 * characters and then being told to cut them.
 */
const NAME_MAX = 160;
const DESCRIPTION_MAX = 500; // ONB-01: 0-500 (AMENDMENT-009 narrowed the column to match).
const PLACE_MAX = 100;

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

const FIELD_KEYS = [
  'name',
  'category',
  'description',
  'city',
  'state',
  'slug',
  'timezone',
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type FieldErrors = Partial<Record<FieldKey, string>>;

export type BusinessIdentityValues = Record<FieldKey, string>;

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

interface Availability {
  slug: string;
  available: boolean;
  reason: string | null;
  suggestions: readonly string[];
}

interface SavedIdentity {
  slug: string;
  /** Flow I: the address this one replaced, which keeps redirecting rather than breaking. */
  previousSlug: string | null;
}

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
    setSaved(null);
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

    if (query === '') {
      setVerdict({ kind: 'idle' });
      return;
    }
    // Normalization only ever removes characters, so a name shorter than the minimum cannot yield a
    // legal address yet. Asking would report "too short" at every keystroke of a short name.
    if (askedAbout === 'name' && query.length < slugMinLength) {
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
  }

  /**
   * Persists the identity. Returns true only when the tenant now holds what is on screen, which is
   * exactly what WizardShell needs in order to decide whether to move on.
   */
  const save = useCallback(async (): Promise<boolean> => {
    setFormError(null);
    setSaved(null);

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
      return false;
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
          return false;
        }

        setFieldErrors(Object.fromEntries(named.map((field) => [field, failure.message])));
        // The claim is authoritative: if it says the address is taken, the field has to stop
        // showing "Available" beside it.
        if (named.includes('slug')) {
          setVerdict({ kind: 'unavailable', message: failure.message, suggestions: [] });
          answered.current = '';
        }
        return false;
      }

      const identity = readSaved(payload, body.slug);
      answered.current = `slug:${identity.slug}`;
      setValues((current) => ({ ...current, slug: identity.slug }));
      // Claimed now, so it stops following the business name for the rest of this session.
      setSlugEdited(true);
      setVerdict({ kind: 'available' });
      setSaved(identity);
      return true;
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [slugMaxLength, slugMinLength, values, verdict]);

  const descriptionLeft = DESCRIPTION_MAX - values.description.length;

  return (
    <WizardShell
      stepId="business"
      heading="Tell us about your business"
      description="This is what customers see when they land on your review page."
      onContinue={save}
      // The same function: both persist this identity, and only the destination differs — which is
      // the shell's decision, not this screen's.
      onSaveAndExit={save}
      busy={busy}
    >
      <div className="flex flex-col gap-5">
        {formError && <InlineError>{formError}</InlineError>}

        {saved && (
          <div
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
              <p className="mt-1 break-all">
                {publicUrlPrefix}
                {saved.previousSlug} will redirect here for the next {aliasRetentionDays} days.
              </p>
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
          hint="Helps the AI describe the kind of place you are. Pick the closest match."
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

        <Field
          label="Short description"
          error={fieldErrors.description}
          hint="Optional. A line or two about what you do — the AI uses it as background."
        >
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

function isFieldKey(value: string): value is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(value);
}

/**
 * ONB-01 marks name, category, city, state and the address required.
 *
 * businessIdentityRequest does not enforce all of that — city and state are `z.string().max(100)`
 * with no minimum — so PATCH would accept an empty city, loadOnboardingProgress would then report
 * this step unfinished, and the owner would be sent back here with nothing visibly wrong. Enforced
 * here, and raised as a contract gap rather than left to this screen forever.
 */
function requiredErrors(body: {
  name: string;
  category: string;
  city: string;
  state: string;
  slug: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (body.name === '') errors.name = 'Enter your business name.';
  if (body.category === '') errors.category = 'Choose the category that fits best.';
  if (body.city === '') errors.city = 'Enter the city you operate in.';
  if (body.state === '') errors.state = 'Enter your state.';
  if (body.slug === '') errors.slug = 'Choose an address for your page.';
  return errors;
}

function contractMessage(field: FieldKey, slugMin: number, slugMax: number): string {
  switch (field) {
    case 'name':
      return `Use between 2 and ${NAME_MAX} characters.`;
    case 'category':
      return 'That category is too long. Please pick one from the list.';
    case 'description':
      return `Keep the description to ${DESCRIPTION_MAX} characters or fewer.`;
    case 'city':
    case 'state':
      return `Use ${PLACE_MAX} characters or fewer.`;
    case 'slug':
      return `Use between ${slugMin} and ${slugMax} characters.`;
    case 'timezone':
      // Never entered on this screen; it is carried through from the tenant.
      return 'We could not save your timezone setting. Please contact support.';
  }
}

/**
 * Copy for the rejection codes /business/slug-available returns.
 *
 * That endpoint answers with codes and no prose, so the wording lives here. Kept in step with the
 * messages PATCH /api/v1/business returns for the same codes, so an owner is never told two
 * different things about one rule.
 */
function describeUnavailable(reason: string | null, slugMin: number, slugMax: number): string {
  switch (reason) {
    case 'TAKEN':
      return 'That address is already taken. Please choose another.';
    case 'TOO_SHORT':
      return `Use at least ${slugMin} characters.`;
    case 'TOO_LONG':
      return `Use at most ${slugMax} characters.`;
    case 'RESERVED':
      return 'That address is reserved. Please choose another.';
    case 'NUMERIC_ONLY':
      return 'Include at least one letter.';
    case 'INVALID_CHARACTERS':
      return 'Use only lowercase letters, numbers and hyphens.';
    case 'CONSECUTIVE_HYPHENS':
      return 'Avoid two hyphens in a row.';
    case 'LEADING_OR_TRAILING_HYPHEN':
      return 'Do not start or end with a hyphen.';
    default:
      return 'That address cannot be used. Please choose another.';
  }
}

function readAvailability(payload: unknown): Availability | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.slug !== 'string' || typeof record.available !== 'boolean') return null;

  return {
    slug: record.slug,
    available: record.available,
    reason: typeof record.reason === 'string' ? record.reason : null,
    suggestions: Array.isArray(record.suggestions)
      ? record.suggestions.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function readSaved(payload: unknown, fallbackSlug: string): SavedIdentity {
  if (typeof payload !== 'object' || payload === null) {
    return { slug: fallbackSlug, previousSlug: null };
  }
  const record = payload as Record<string, unknown>;

  return {
    slug: typeof record.slug === 'string' ? record.slug : fallbackSlug,
    previousSlug: typeof record.previous_slug === 'string' ? record.previous_slug : null,
  };
}

/**
 * The error envelope from 23_API_Error_Codes.md.
 *
 * components/auth/use-form-submit.ts unpacks the same shape, but that hook only issues POSTs and
 * this screen saves with PATCH. The SubmitFailure type is imported rather than redeclared so the
 * two cannot drift apart in shape; generalising the hook to take a method would remove the
 * duplication outright, but that module is not this one's to change.
 */
function readFailure(payload: unknown): SubmitFailure {
  const fallback: SubmitFailure = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
    fields: [],
  };

  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;

  const error = (payload as { error: Record<string, unknown> }).error;
  const details = error.details as { fields?: unknown } | undefined;

  return {
    code: typeof error.code === 'string' ? error.code : fallback.code,
    message: typeof error.message === 'string' ? error.message : fallback.message,
    fields: Array.isArray(details?.fields)
      ? details.fields.filter((value): value is string => typeof value === 'string')
      : [],
  };
}
