'use client';

import { useCallback, useState } from 'react';
import type { ReviewDestinationKind } from '@ai-review/core';
import { Badge, Button, Card, Field, FOCUS_RING, InlineError, Input } from '@ai-review/ui';
import { SECONDARY_LINK } from '../link-styles';
import { sendJson } from './request';

const ENDPOINT = '/api/v1/business/review-destination';
const URL_MAX = 2048;

export interface ReviewLocationCardProps {
  /** The stored database value, including a legacy value that now needs replacing. */
  initialUrl: string | null;
  /** A server-validated URL. Raw input is never promoted into an external href. */
  initialOpenUrl: string | null;
  initialKind: ReviewDestinationKind | null;
  initialEnabled: boolean;
  disabled: boolean;
  onSaved: (url: string, kind: ReviewDestinationKind) => void;
}

/**
 * The dashboard-native editor for the destination every dynamic QR resolves to.
 *
 * This intentionally does not reuse `ReviewLinkStep`: that component is coupled to WizardShell,
 * where Continue advances to the next onboarding route. An owner changing shops needs to stay in
 * their workspace, see the saved result, and understand that the printed QR itself does not change.
 */
export function ReviewLocationCard({
  initialUrl,
  initialOpenUrl,
  initialKind,
  initialEnabled,
  disabled,
  onSaved,
}: ReviewLocationCardProps) {
  const [value, setValue] = useState(initialUrl ?? '');
  const [storedUrl, setStoredUrl] = useState(initialUrl);
  const [openUrl, setOpenUrl] = useState(initialOpenUrl);
  const [kind, setKind] = useState(initialKind);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const trimmed = value.trim();
  // Saving an unchanged but disabled destination is a repair action: the PUT re-enables the row,
  // which makes the public review button and every QR journey use it again.
  const dirty = trimmed !== (storedUrl ?? '') || (!enabled && trimmed.length > 0);

  const clearOutcome = useCallback(() => {
    setFieldError(null);
    setFormError(null);
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    if (disabled || saving || !dirty) return;
    clearOutcome();

    if (trimmed.length === 0) {
      setFieldError('Paste the Google review link for your business.');
      return;
    }
    if (trimmed.length > URL_MAX) {
      setFieldError(`Keep the Google review link to ${URL_MAX} characters or fewer.`);
      return;
    }

    setSaving(true);
    const result = await sendJson(ENDPOINT, 'PUT', { url: trimmed });
    setSaving(false);

    if (!result.ok) {
      if (result.failure.fields.includes('url')) setFieldError(result.failure.message);
      else setFormError(result.failure.message);
      return;
    }

    const normalized = readUrl(result.payload);
    if (normalized === null) {
      // A 2xx means the write may have happened. Asking for a refresh is safer than inviting a
      // second write while showing a value that may no longer be authoritative.
      setFormError(
        'That change went through, but we could not read the saved link. Refresh this page before trying again.',
      );
      return;
    }

    const savedKind = readKind(result.payload);
    setValue(normalized);
    setStoredUrl(normalized);
    setOpenUrl(normalized);
    setKind(savedKind);
    setEnabled(true);
    setSaved(true);
    onSaved(normalized, savedKind);
  }, [clearOutcome, dirty, disabled, onSaved, saving, trimmed]);

  const status = destinationStatus(storedUrl, openUrl, kind, enabled);

  return (
    <section id="review-location" className="scroll-mt-24" aria-labelledby="review-location-title">
      <Card
        className="dashboard-section-card dashboard-section-card--green relative overflow-hidden"
        title={
          <span className="flex items-center gap-2.5" id="review-location-title">
            <span
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-success-soft text-success"
              aria-hidden="true"
            >
              <MapPinIcon />
            </span>
            <span>Google review location</span>
          </span>
        }
        titleAs="h2"
        description="Change the Google Business Profile customers open after they copy their review."
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      >
        <span className="absolute inset-x-0 top-0 flex h-1" aria-hidden="true">
          <i className="flex-1 bg-brand-blue" />
          <i className="flex-1 bg-brand-red" />
          <i className="flex-1 bg-brand-yellow" />
          <i className="flex-1 bg-brand-green" />
        </span>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.42fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <Field
              label="Google review or Maps link"
              required
              error={fieldError}
              hint="Paste the full https:// link from the Google Business Profile for this shop."
            >
              {(control) => (
                <Input
                  {...control}
                  name="review_location_url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="https://g.page/r/…/review"
                  maxLength={URL_MAX}
                  value={value}
                  disabled={disabled || saving}
                  onChange={(event) => {
                    clearOutcome();
                    setValue(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void save();
                  }}
                />
              )}
            </Field>

            {formError !== null && <InlineError>{formError}</InlineError>}

            {!enabled && storedUrl !== null && (
              <p className="rounded-card border border-warning bg-warning-soft p-3 text-sm text-warning">
                This location is currently disconnected. Save it again to reconnect the review
                button and every QR journey.
              </p>
            )}

            {enabled && openUrl === null && storedUrl !== null && (
              <p className="rounded-card border border-warning bg-warning-soft p-3 text-sm text-warning">
                The saved link needs attention. Replace it with a Google review or Maps link before
                sending more customers to it.
              </p>
            )}

            {kind === 'listing' && openUrl !== null && (
              <p className="rounded-card border border-warning bg-warning-soft p-3 text-sm text-ink">
                This Maps link opens your listing. It works, but a direct link from{' '}
                <strong>Ask for reviews</strong> opens the review box with one fewer tap.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                loading={saving}
                loadingLabel="Saving location…"
                disabled={disabled || !dirty}
                onClick={() => void save()}
              >
                Save location
              </Button>

              {openUrl !== null && (
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={SECONDARY_LINK}
                >
                  Open saved location
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>

            <p className="min-h-5 text-sm text-ink-muted" role="status" aria-live="polite">
              {saved ? 'Saved. Every existing QR now uses this location.' : ''}
            </p>
          </div>

          <aside className="rounded-card border border-brand-blue/25 bg-accent-soft p-4 text-sm">
            <p className="font-semibold text-ink">Your printed QR stays the same</p>
            <p className="mt-1.5 leading-6 text-ink-muted">
              Each code opens your Ai review page first, then uses the location saved here. Change
              shops whenever you need to—there is nothing to reprint.
            </p>
            <details className="mt-3 border-t border-brand-blue/20 pt-3">
              <summary className={`cursor-pointer rounded font-semibold text-accent ${FOCUS_RING}`}>
                How to find the best link
              </summary>
              <p className="mt-2 leading-6 text-ink-muted">
                Open your Google Business Profile, choose <strong>Ask for reviews</strong>, and copy
                its link. A Google Maps share link also works when you want to point at a new shop.
              </p>
            </details>
          </aside>
        </div>
      </Card>
    </section>
  );
}

function readUrl(payload: Record<string, unknown>): string | null {
  return typeof payload.url === 'string' && payload.url.length > 0 ? payload.url : null;
}

function readKind(payload: Record<string, unknown>): ReviewDestinationKind {
  return payload.kind === 'composer' || payload.kind === 'listing' ? payload.kind : 'unknown';
}

function destinationStatus(
  storedUrl: string | null,
  openUrl: string | null,
  kind: ReviewDestinationKind | null,
  enabled: boolean,
): { tone: 'success' | 'warning' | 'neutral'; label: string } {
  if (storedUrl === null) return { tone: 'neutral', label: 'Not connected' };
  if (!enabled) return { tone: 'warning', label: 'Disconnected' };
  if (openUrl === null) return { tone: 'warning', label: 'Needs attention' };
  if (kind === 'composer') return { tone: 'success', label: 'Direct review link' };
  if (kind === 'listing') return { tone: 'success', label: 'Maps location connected' };
  return { tone: 'success', label: 'Google link connected' };
}

function MapPinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.7" />
    </svg>
  );
}
