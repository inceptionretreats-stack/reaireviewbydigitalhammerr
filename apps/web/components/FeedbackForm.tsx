'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { submitFeedbackRequest } from '@ai-review/contracts';

/**
 * FB-01 — private feedback.
 *
 * Available to every visitor, unconditionally (D-010, AC-024, FB-01-01). There is no rating
 * gate here and there cannot be one: no star rating is collected anywhere in the customer flow
 * (D-009, AC-006), so there is nothing to branch on. That is not an oversight to be tidied up
 * later — routing unhappy customers away from Google is precisely what
 * 13_Security_Privacy_Compliance.md rule 3 forbids, and rule 6 requires this to be an equal
 * option rather than a consolation prize.
 *
 * Validation uses the shared contract rather than a local copy of the rules, which is the
 * stated purpose of packages/contracts: a field cannot then be validated one way in the browser
 * and another on the server. The server re-validates regardless — the client check exists only
 * so the customer sees the problem before a round trip.
 */

/** FB-01: message 5-2000 chars. Mirrors submitFeedbackRequest; used for the counter and hint. */
const MESSAGE_MIN = 5;
const MESSAGE_MAX = 2000;
const NAME_MAX = 120;
const MOBILE_MAX = 20;

type Status = 'default' | 'submitting' | 'success' | 'error';

export interface FeedbackFormProps {
  slug: string;
  businessName: string;
}

export function FeedbackForm({ slug, businessName }: FeedbackFormProps) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('default');
  const [formError, setFormError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);

  const statusRef = useRef<HTMLDivElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  // AC-037: after submitting, focus moves to whichever region now carries the outcome, so a
  // keyboard or screen-reader user is not left on a control that has been replaced.
  useEffect(() => {
    if (status === 'success') statusRef.current?.focus();
    if (status === 'error' && messageError) messageRef.current?.focus();
  }, [status, messageError]);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(null);
      setMessageError(null);

      // Trim before validating: five spaces satisfies a bare min-length check but is not a
      // message, and the server trims identically before it stores anything.
      const candidate = {
        slug,
        name: name.trim() || undefined,
        mobile: mobile.trim() || undefined,
        message: message.trim(),
      };

      const parsed = submitFeedbackRequest.safeParse(candidate);
      if (!parsed.success) {
        const messageIssue = parsed.error.issues.find((issue) => issue.path[0] === 'message');
        const lengthHint = `Please write between ${MESSAGE_MIN} and ${MESSAGE_MAX} characters.`;
        setMessageError(messageIssue ? lengthHint : null);
        setFormError(messageIssue ? null : 'Please check the details you entered and try again.');
        setStatus('error');
        return;
      }

      setStatus('submitting');

      try {
        const response = await fetch('/api/v1/public/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        });

        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          setFormError(extractMessage(payload));
          setStatus('error');
          return;
        }

        setStatus('success');
      } catch {
        setFormError('We could not send your feedback just now. Please try again in a moment.');
        setStatus('error');
      }
    },
    [message, mobile, name, slug],
  );

  if (status === 'success') {
    return (
      <div className="stack">
        <div className="notice" role="status" tabIndex={-1} ref={statusRef}>
          <p>Thank you. Your feedback has gone to {businessName}.</p>
          {/*
            FB-01-02 and AC-039: this is private. Saying so is the point of the screen — the
            customer has just handed over a complaint and possibly their phone number, and
            13_Security_Privacy_Compliance.md keeps both off every public surface.
          */}
          <p className="muted">
            It is private: only {businessName} can read it, and nothing is posted publicly.
          </p>
        </div>
        <a className="btn btn-secondary" href={`/${slug}`}>
          Back to {businessName}
        </a>
      </div>
    );
  }

  const remaining = MESSAGE_MAX - message.length;

  // AC-037: the field announces its rule on focus, and the validation message joins it when
  // there is one, so the requirement is heard before it is failed rather than only after. The
  // live character count is deliberately not in here — it is announced by its own polite
  // region as it changes, and describing it twice makes every keystroke verbose.
  const describedBy = messageError
    ? 'feedback-message-hint feedback-message-error'
    : 'feedback-message-hint';

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      {formError && (
        <p className="notice notice-error" role="alert">
          {formError}
        </p>
      )}

      <div>
        <label className="muted" style={LABEL_STYLE} htmlFor="feedback-name">
          Your name (optional)
        </label>
        <input
          id="feedback-name"
          name="name"
          type="text"
          autoComplete="name"
          maxLength={NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={FIELD_STYLE}
        />
      </div>

      <div>
        <label className="muted" style={LABEL_STYLE} htmlFor="feedback-mobile">
          Mobile number (optional)
        </label>
        <input
          id="feedback-mobile"
          name="mobile"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={MOBILE_MAX}
          value={mobile}
          onChange={(event) => setMobile(event.target.value)}
          aria-describedby="feedback-mobile-hint"
          style={FIELD_STYLE}
        />
        <p className="muted" id="feedback-mobile-hint">
          Only so the business can reply to you.
        </p>
      </div>

      <div>
        <label className="muted" style={LABEL_STYLE} htmlFor="feedback-message">
          What would you like the business to know?
        </label>
        <p className="muted" id="feedback-message-hint">
          Required, at least {MESSAGE_MIN} characters.
        </p>
        <textarea
          id="feedback-message"
          name="message"
          ref={messageRef}
          required
          maxLength={MESSAGE_MAX}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            if (messageError) setMessageError(null);
          }}
          aria-invalid={messageError !== null}
          aria-describedby={describedBy}
        />
        {messageError && (
          <p className="notice notice-error" id="feedback-message-error" role="alert">
            {messageError}
          </p>
        )}
        <p className="muted" aria-live="polite">
          {remaining} characters remaining
        </p>
      </div>

      <button type="submit" className="btn btn-primary" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Sending…' : 'Submit Feedback'}
      </button>

      <a className="btn btn-text" href={`/${slug}`}>
        Back
      </a>
    </form>
  );
}

/** 23_API_Error_Codes.md envelope. Falls back rather than showing a raw payload (AC-030). */
function extractMessage(payload: unknown): string {
  const fallback = 'We could not send your feedback just now. Please try again in a moment.';
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;

  const error = (payload as { error: { message?: string } }).error;
  return error.message ?? fallback;
}

/**
 * Inline styles rather than utility classes: apps/web ships a hand-written stylesheet
 * (app/globals.css) with no Tailwind entrypoint, so utility class names would render unstyled.
 * These two rules deliberately mirror the stylesheet's existing `textarea` rule — same tokens,
 * same 48px minimum touch target — so text inputs and the message box stay visually identical
 * and share one AA-contrast palette (AC-038).
 */
const FIELD_STYLE: CSSProperties = {
  width: '100%',
  minHeight: '48px',
  padding: '0.75rem',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  font: 'inherit',
  color: 'inherit',
  background: 'var(--bg)',
};

const LABEL_STYLE: CSSProperties = { display: 'block', marginBottom: '0.35rem' };
