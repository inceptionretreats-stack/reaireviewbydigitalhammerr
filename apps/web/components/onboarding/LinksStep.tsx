'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Card, Field, InlineError, Input, type BadgeTone } from '@ai-review/ui';
import type { SubmitFailure } from '@/components/auth/use-form-submit';
import { WizardShell } from './WizardShell';

/**
 * ONB-03 — default contact and social links.
 *
 * Four of the five default sections are collected here, not five. AMENDMENT-003 settled that the
 * D-014 defaults are GOOGLE_REVIEW plus WhatsApp, Call, Instagram and Facebook, and that the
 * GOOGLE_REVIEW row carries no url of its own (ck_google_review_has_no_url) because
 * review_destinations owns the destination — which is what makes AC-017 work. So there is
 * deliberately no Google input on this screen: an empty one would imply a second place to set the
 * destination, and the owner already set it on ONB-02. The summary still lists the Review Us
 * button, so "where did my Google button go?" never needs asking.
 *
 * Website is the fifth input because 03_Screen_Field_Button_Spec.md lists it under ONB-03, even
 * though it is not one of the D-014 defaults. See the note on the payload below: the PUT handler
 * validates a WEBSITE section but currently writes only the five defaults, so that handler needs
 * widening before this field round-trips.
 *
 * ONB-03-02 — "blank optional URLs are not rendered publicly" — is a consequence the owner has
 * to be able to see, or a blank field reads as an unfinished form rather than a choice. Hence
 * the summary card: every default section, with whether it currently produces a button. The API
 * enforces the same rule from the other side, enabling a section only once it has a target, so
 * the screen and the public page cannot disagree.
 */

type FieldId = 'whatsapp' | 'call' | 'instagram' | 'facebook' | 'website';

/** Whatever is already stored, keyed exactly as the inputs are. */
export type SavedContactLinks = Record<FieldId, string>;

interface ContactField {
  id: FieldId;
  /**
   * The business_links.link_type this input writes. Lowercased it is also the field name the API
   * returns in `details.fields`, which is why the two sets are kept identical here.
   */
  linkType: 'WHATSAPP' | 'CALL' | 'INSTAGRAM' | 'FACEBOOK' | 'WEBSITE';
  kind: 'phone' | 'url';
  /** Wording from 03_Screen_Field_Button_Spec.md ONB-03, kept verbatim for traceability. */
  label: string;
  /** How the section is labelled on the public page, so the summary names the real button. */
  button: string;
  hint: string;
  inputType: 'tel' | 'url';
  inputMode: 'tel' | 'url';
  autoComplete: string;
  /** Phones only: business_links.phone is varchar(20), so longer input cannot be stored anyway. */
  maxLength?: number;
}

const FIELD: Record<FieldId, ContactField> = {
  whatsapp: {
    id: 'whatsapp',
    linkType: 'WHATSAPP',
    kind: 'phone',
    label: 'WhatsApp number',
    button: 'WhatsApp',
    hint: 'Opens a chat with you. 10 digits, or start with + and a country code.',
    inputType: 'tel',
    inputMode: 'tel',
    autoComplete: 'off',
    maxLength: 20,
  },
  call: {
    id: 'call',
    linkType: 'CALL',
    kind: 'phone',
    label: 'Call number',
    button: 'Call',
    hint: 'Dials this number when a visitor taps Call.',
    inputType: 'tel',
    inputMode: 'tel',
    autoComplete: 'off',
    maxLength: 20,
  },
  instagram: {
    id: 'instagram',
    linkType: 'INSTAGRAM',
    kind: 'url',
    label: 'Instagram URL',
    button: 'Instagram',
    hint: 'The full address of your profile, starting with https://',
    inputType: 'url',
    inputMode: 'url',
    autoComplete: 'off',
  },
  facebook: {
    id: 'facebook',
    linkType: 'FACEBOOK',
    kind: 'url',
    label: 'Facebook URL',
    button: 'Facebook',
    hint: 'The full address of your page, starting with https://',
    inputType: 'url',
    inputMode: 'url',
    autoComplete: 'off',
  },
  website: {
    id: 'website',
    linkType: 'WEBSITE',
    kind: 'url',
    label: 'Website URL',
    button: 'Website',
    hint: 'Your own site, starting with https://',
    inputType: 'url',
    inputMode: 'url',
    autoComplete: 'url',
  },
};

/** Screen order, and the order the summary lists the buttons in. */
const FIELDS: readonly ContactField[] = [
  FIELD.whatsapp,
  FIELD.call,
  FIELD.instagram,
  FIELD.facebook,
  FIELD.website,
];

/**
 * Word for word what the PUT handler answers with, so the immediate check and the authoritative
 * one never describe the same problem two different ways.
 */
const PHONE_MESSAGE = 'Enter a valid 10-digit mobile number.';
const URL_MESSAGE = 'Enter a full web address starting with https://';

/**
 * What a section is currently doing, said in words rather than carried by badge colour alone
 * (AC-038, and the design brief rule on never conveying state by colour).
 */
type SectionState = 'saved' | 'pending' | 'removing' | 'invalid' | 'empty';

const SECTION_STATE: Record<SectionState, { tone: BadgeTone; label: string }> = {
  saved: { tone: 'success', label: 'Shows on your page' },
  pending: { tone: 'accent', label: 'Shows once you continue' },
  removing: { tone: 'warning', label: 'Will be removed' },
  invalid: { tone: 'danger', label: 'Needs a fix' },
  empty: { tone: 'neutral', label: 'Not added, so no button' },
};

export interface LinksStepProps {
  /** Already-stored values, so leaving via Save & exit and resuming shows the real state. */
  saved: SavedContactLinks;
}

export function LinksStep({ saved }: LinksStepProps) {
  const [values, setValues] = useState<SavedContactLinks>(saved);
  const [storedValues, setStoredValues] = useState<SavedContactLinks>(saved);
  const [errors, setErrors] = useState<Partial<Record<FieldId, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FieldId | null>(null);
  const inputs = useRef<Partial<Record<FieldId, HTMLInputElement | null>>>({});

  const setValue = useCallback((id: FieldId, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));

    // A correction should not sit underneath the message it is fixing.
    setErrors((current) => {
      if (current[id] === undefined) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * AC-037: the shell keeps the owner on this step, so focus has to land on the field that
   * stopped them rather than leaving them on a Continue button that appeared to do nothing.
   *
   * Applied from an effect rather than at the point of failure, because on a server rejection the
   * inputs are still `disabled` at that moment — `saving` has not re-rendered as false yet — and
   * focus() on a disabled element silently does nothing.
   */
  useEffect(() => {
    if (focusTarget === null || saving) return;
    inputs.current[focusTarget]?.focus();
    setFocusTarget(null);
  }, [focusTarget, saving]);

  /**
   * Saves the four defaults plus Website, and reports whether the wizard may move on.
   *
   * Serves both Continue and Save & exit: those differ only in where the shell goes afterwards,
   * which is the shell's business and not this screen's.
   */
  const persist = useCallback(async (): Promise<boolean> => {
    setFormError(null);

    // Canonical form up front: a phone becomes the E.164 the server will store, so the summary
    // can tell that "98765 43210" and "+919876543210" are the same already-saved number.
    const canonical: SavedContactLinks = {
      whatsapp: canonicalValue(FIELD.whatsapp, values.whatsapp),
      call: canonicalValue(FIELD.call, values.call),
      instagram: canonicalValue(FIELD.instagram, values.instagram),
      facebook: canonicalValue(FIELD.facebook, values.facebook),
      website: canonicalValue(FIELD.website, values.website),
    };

    const problems: Partial<Record<FieldId, string>> = {};
    for (const field of FIELDS) {
      const value = canonical[field.id];
      if (value.length === 0) continue;
      if (field.kind === 'phone' ? normalizeMobile(value) === null : !isHttpsUrl(value)) {
        problems[field.id] = field.kind === 'phone' ? PHONE_MESSAGE : URL_MESSAGE;
      }
    }

    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setFocusTarget(firstProblemField(problems));
      return false;
    }
    setErrors({});

    // "Skip optional", genuinely: nothing entered and nothing stored means no request at all,
    // rather than a write whose only purpose is to look busy. Nothing is lost by skipping — the
    // publish handler creates the GOOGLE_REVIEW default for a tenant that skipped this screen,
    // and PROFILE-01 can add any section later. ONB-03-01 reads as though the five sections must
    // be created *here*; that publish safety net is where the pack resolves it, and this screen
    // follows it rather than writing five empty rows on the owner's behalf.
    const hasSomethingToWrite = FIELDS.some(
      (field) => canonical[field.id].length > 0 || storedValues[field.id].length > 0,
    );
    if (!hasSomethingToWrite) return true;

    setSaving(true);
    try {
      const result = await sendJson('/api/v1/business/links', 'PUT', {
        // GOOGLE_REVIEW is deliberately absent: the handler creates and keeps that row itself,
        // and it has no url for this screen to send (AMENDMENT-003). An empty string is how a
        // section is cleared — the handler reads it as "no target" and disables the button.
        sections: FIELDS.map((field) =>
          field.kind === 'phone'
            ? { type: field.linkType, phone: canonical[field.id] }
            : { type: field.linkType, url: canonical[field.id] },
        ),
      });

      if (!result.ok) {
        const fieldErrors: Partial<Record<FieldId, string>> = {};
        for (const field of FIELDS) {
          if (result.failure.fields.includes(field.id)) {
            fieldErrors[field.id] = result.failure.message;
          }
        }

        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
          setFocusTarget(firstProblemField(fieldErrors));
        } else {
          setFormError(result.failure.message);
        }
        return false;
      }

      // Show what was stored rather than what was typed: the server normalises a phone to E.164,
      // and that normalised value is what the public page will dial.
      setValues(canonical);
      setStoredValues(canonical);
      return true;
    } finally {
      setSaving(false);
    }
  }, [values, storedValues]);

  const sections = FIELDS.map((field) => ({
    field,
    state: sectionState({
      current: canonicalValue(field, values[field.id]),
      stored: canonicalValue(field, storedValues[field.id]),
      invalid: errors[field.id] !== undefined,
    }),
  }));

  // With nothing entered and nothing stored, Continue has nothing to do but move on, so it says
  // so. ONB-03 asks for a "Skip optional" action and the shell owns forward navigation, so this
  // is that action rather than a second button that would have to route around the shell.
  const nothingToSave = sections.every((section) => section.state === 'empty');

  return (
    <WizardShell
      stepId="links"
      heading="Add your contact buttons"
      description={
        <>
          Every one of these is optional. Whatever you add becomes a button on your public page, and
          anything you leave blank simply does not appear.
        </>
      }
      onContinue={persist}
      onSaveAndExit={persist}
      busy={saving}
      continueLabel={nothingToSave ? 'Skip optional' : undefined}
    >
      <div className="flex flex-col gap-5">
        {formError !== null && <InlineError>{formError}</InlineError>}

        {FIELDS.map((field) => {
          const error = errors[field.id];
          return (
            <Field
              key={field.id}
              label={field.label}
              error={error ?? null}
              hint={error === undefined ? field.hint : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  ref={(element) => {
                    inputs.current[field.id] = element;
                  }}
                  name={field.id}
                  type={field.inputType}
                  inputMode={field.inputMode}
                  autoComplete={field.autoComplete}
                  maxLength={field.maxLength}
                  value={values[field.id]}
                  disabled={saving}
                  onChange={(event) => setValue(field.id, event.target.value)}
                  onBlur={
                    field.kind === 'url'
                      ? (event) => setValue(field.id, withHttps(event.target.value))
                      : undefined
                  }
                />
              )}
            </Field>
          );
        })}

        <Card
          title="Your public page buttons"
          description={
            <>
              Only a section with a link is shown to visitors, so a blank field means one less
              button — not a broken one.
            </>
          }
        >
          {/*
            role="list" is restored on purpose: list-style:none drops list semantics in Safari,
            and how many buttons there are is the whole point of this summary.
          */}
          <ul role="list" className="m-0 list-none divide-y divide-line p-0">
            <li className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Review Us</p>
                <p className="text-xs text-ink-muted">
                  Opens the Google link you added on the previous step.
                </p>
              </div>
              <Badge tone="success">Always shows</Badge>
            </li>

            {sections.map(({ field, state }) => {
              const presentation = SECTION_STATE[state];
              return (
                <li key={field.id} className="flex items-center justify-between gap-3 py-2.5">
                  <p className="min-w-0 text-sm font-medium text-ink">{field.button}</p>
                  <Badge tone={presentation.tone}>{presentation.label}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </WizardShell>
  );
}

/** The topmost field carrying a message, which is where focus belongs. */
function firstProblemField(problems: Partial<Record<FieldId, string>>): FieldId | null {
  return FIELDS.find((field) => problems[field.id] !== undefined)?.id ?? null;
}

function sectionState({
  current,
  stored,
  invalid,
}: {
  current: string;
  stored: string;
  invalid: boolean;
}): SectionState {
  if (invalid) return 'invalid';
  if (current.length === 0) return stored.length > 0 ? 'removing' : 'empty';
  return current === stored ? 'saved' : 'pending';
}

function canonicalValue(field: ContactField, raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  if (field.kind !== 'phone') return trimmed;

  // An un-normalisable number is passed through unchanged so validation can report it, rather
  // than being quietly rewritten into something the owner did not type.
  return normalizeMobile(trimmed) ?? trimmed;
}

/**
 * Client-side mirror of `normalizePhone` (packages/core) for immediate feedback.
 *
 * Not an import, which is the awkward part and worth stating plainly: `@ai-review/core` publishes
 * only its barrel, and that barrel reaches @node-rs/argon2 and ioredis, so it cannot go into a
 * client bundle. The server value stays authoritative — this exists to catch a typo before a
 * round trip and to canonicalise for the summary. Same India-first rules (D-002): a bare
 * 10-digit number is +91, and only Indian numbers get a shape check.
 */
function normalizeMobile(input: string): string | null {
  const cleaned = input.replace(/[^\d+]/g, '');
  if (cleaned.length === 0) return null;

  if (cleaned.startsWith('+') && !cleaned.startsWith('+91')) {
    const digits = cleaned.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // Strip a trunk prefix first, then an embedded country code: '091-9876543210' carries both,
  // and testing for the country code before dropping the zero leaves 12 digits that fail.
  const digits = cleaned.replace(/\D/g, '').replace(/^0+/, '');
  const national = digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits;

  // Indian mobile numbers begin 6-9.
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

/** Mirrors the handler's own check: only https is stored, so only https is accepted here. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Adds the scheme an owner pasting "instagram.com/mycafe" left off.
 *
 * A value that already carries a scheme is never touched — silently promoting http:// to https://
 * would change where the button points, which is not a formatting fix.
 */
function withHttps(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, '');
  if (trimmed.length === 0) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return trimmed.includes('.') ? `https://${trimmed}` : trimmed;
}

type JsonResult =
  { ok: true; payload: Record<string, unknown> } | { ok: false; failure: SubmitFailure };

/**
 * One JSON mutation, with the error envelope unpacked (23_API_Error_Codes.md).
 *
 * Deliberately character-for-character the same helper as the ones in `ReviewLinkStep.tsx` and
 * `AiContextStep.tsx`. `useFormSubmit` is POST-only and this screen saves with PUT; three wizard
 * steps now need the same thing, and the real fix is one helper in `apps/web/lib` that all three
 * import — which is outside every one of those modules' paths. Keeping the copies identical is
 * what makes that extraction a delete rather than a merge.
 */
async function sendJson(
  endpoint: string,
  method: 'POST' | 'PUT',
  body: Record<string, unknown>,
): Promise<JsonResult> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // A network failure, not a rejected request: says so rather than implying the input is wrong.
    return {
      ok: false,
      failure: {
        code: 'NETWORK',
        message: 'Could not reach the server. Check your connection and try again.',
        fields: [],
      },
    };
  }

  const payload = await readJsonBody(response);
  return response.ok ? { ok: true, payload } : { ok: false, failure: readFailure(payload) };
}

/** A body that is missing or not JSON (a proxy's 502 page) is treated as an empty one. */
async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 204) return {};

  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The API returns a safe, user-facing message for every failure, so it is shown verbatim rather
 * than remapped here; `details.fields` names the inputs to mark (AC-030 keeps the internal detail
 * on the server side of that line).
 */
function readFailure(payload: Record<string, unknown>): SubmitFailure {
  const fallback: SubmitFailure = {
    code: 'INTERNAL_ERROR',
    message: 'We could not save your buttons just now. Please try again.',
    fields: [],
  };

  const error = payload.error;
  if (typeof error !== 'object' || error === null) return fallback;

  const { code, message, details } = error as Record<string, unknown>;
  const fields = (details as { fields?: unknown } | null | undefined)?.fields;

  return {
    code: typeof code === 'string' ? code : fallback.code,
    message: typeof message === 'string' ? message : fallback.message,
    fields: Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : [],
  };
}
