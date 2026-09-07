import { isShell } from '../../lib/tenant-shell';
import type { OnboardingStepId } from './steps';
import type { SubmitState } from '../auth/use-form-submit';

/**
 * The pure projections behind ONB-05 (Flow A steps 8-12).
 *
 * Extracted from `app/(app)/onboarding/finish/page.tsx` and `FinishStep.tsx` so both halves of the
 * screen read the same rules and both can be unit tested. Nothing here is presentational: each
 * function answers a question the owner is entitled to a correct answer to — which requirement
 * publish will actually refuse them for, and which buttons the public page will actually render —
 * and a wrong answer is a lie on screen rather than a cosmetic slip.
 *
 * `isShell` is imported by relative path rather than through the `@/` alias because the unit
 * suite resolves no path aliases; the rule it encodes must have exactly one definition.
 */

export interface PreviewSection {
  /** business_links.id, or a synthetic id for the default section publish will create. */
  id: string;
  label: string;
  /** The Review Us button, which is the public page primary action wherever it sits (D-015). */
  isPrimary: boolean;
}

/** The `business_links` columns a preview needs. */
export interface PreviewLinkRow {
  id: string;
  linkType: string;
  label: string;
  url: string | null;
  phone: string | null;
}

/** What POST /business/publish tests, in the shape this screen can read before pressing it. */
export interface PublishReadiness {
  /** businesses.name exactly as stored, signup placeholder included — isShell judges it. */
  name: string;
  /** businesses.category exactly as stored, SHELL_CATEGORY included. */
  category: string;
  /** A primary row in business_slugs exists. */
  hasPrimarySlug: boolean;
  /** A primary row in review_destinations exists. */
  hasReviewDestination: boolean;
}

/**
 * What POST /business/publish would refuse this tenant for, derived before the button is pressed.
 *
 * The keys are the endpoint's own vocabulary (`details.missing`), so the screen carries one
 * key-to-step mapping rather than two, and a 409 arriving later renders through the same list.
 *
 * The three tests below are the endpoint's three tests, against the same columns and in the same
 * order — deliberately NOT `loadOnboardingProgress.hasBusinessDetails`, which is a different
 * predicate. That helper answers "is ONB-01 finished", so it also requires a non-empty city and
 * folds the web address in. Reading publish readiness off it produced two wrong answers: a tenant
 * with a name, a category and a slug but no city (businessIdentityRequest permits an empty city —
 * see requiredErrors in BusinessStep.tsx) was told to go add details publish does not require,
 * and a tenant missing only its web address was labelled with the wrong requirement, which made
 * the `web_address` row in REQUIREMENTS unreachable until a 409 produced it.
 *
 * `hasContactLinks` and `hasAiContext` are deliberately absent: publish requires neither (ONB-03
 * is skippable and publish seeds the D-014 defaults itself), so listing them here would invent a
 * requirement the API does not have. They appear as optional prompts inside the previews.
 */
export function derivePublishBlockers(readiness: PublishReadiness): string[] {
  const missing: string[] = [];
  if (isShell(readiness.name, readiness.category)) missing.push('business_details');
  if (!readiness.hasPrimarySlug) missing.push('web_address');
  if (!readiness.hasReviewDestination) missing.push('google_review_link');
  return missing;
}

/**
 * The sections the public page will actually render.
 *
 * Mirrors the rule in `app/[slug]/page.tsx` — a section without a resolvable target is absent,
 * not disabled (AC-020) — at the grain a preview needs: presence of a target, rather than the
 * scheme check that renderer performs before emitting an href. That renderer stays
 * authoritative. The rule is repeated here only because previewing a button the public page
 * would drop makes the preview a lie.
 */
export function buildPreviewSections(
  links: readonly PreviewLinkRow[],
  hasReviewDestination: boolean,
): PreviewSection[] {
  const sections = links
    .filter((link) => hasTarget(link, hasReviewDestination))
    .map((link) => ({
      id: link.id,
      label: link.label,
      isPrimary: link.linkType === 'GOOGLE_REVIEW',
    }));

  // A tenant that skipped ONB-03 has no link rows yet, but publish creates the D-014 defaults
  // with GOOGLE_REVIEW enabled. Without this the preview would show a page with no Review Us
  // button seconds before publish adds one.
  if (hasReviewDestination && !sections.some((section) => section.isPrimary)) {
    sections.unshift({ id: 'default-google-review', label: 'Review Us', isPrimary: true });
  }

  return sections;
}

export function hasTarget(link: PreviewLinkRow, hasReviewDestination: boolean): boolean {
  // AMENDMENT-003: the GOOGLE_REVIEW row is presentation only and carries no url of its own, so
  // whether it can render depends on review_destinations.
  if (link.linkType === 'GOOGLE_REVIEW') return hasReviewDestination;
  return (link.url?.trim().length ?? 0) > 0 || (link.phone?.trim().length ?? 0) > 0;
}

/**
 * Whether "Only Review Us and private feedback will show" is a true statement about this preview.
 *
 * It needs the Review Us row to actually be there. `buildPreviewSections` returns an empty list
 * for a tenant with no review destination and no other targeted link, and this page deliberately
 * does not redirect an unfinished tenant, so that state reaches the screen — where promising a
 * Review Us button that the preview box does not show and that "Finish these first" lists as
 * missing would contradict the rest of the screen twice over.
 */
export function showsOnlyDefaultSections(sections: readonly PreviewSection[]): boolean {
  return sections.length > 0 && sections.every((section) => section.isPrimary);
}

/** context_terms is jsonb, so its stored shape is a promise rather than a guarantee. */
export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Every requirement the publish endpoint can name, and the step that satisfies it.
 *
 * One table serves both paths — the list derived server-side on render, and the `details.missing`
 * of a 409 — so the two cannot label the same key differently. Step ids come from `steps.ts`
 * rather than as path strings, because that file is the contract for where a step lives.
 */
export const REQUIREMENTS: Record<string, { label: string; step: OnboardingStepId }> = {
  business_details: { label: 'Your business name, category and city', step: 'business' },
  web_address: { label: 'Your web address', step: 'business' },
  google_review_link: { label: 'Your Google review link', step: 'review-link' },
};

export interface Blocker {
  key: string;
  label: string;
  /** null when the endpoint named a requirement this screen has not been taught. */
  step: OnboardingStepId | null;
}

export interface Refusal {
  message: string;
  /** Keys from `details.missing`, when the failure carried them. */
  missing: readonly string[] | null;
}

export interface Publication {
  publicUrl: string | null;
  qrCode: string | null;
}

export function describeBlocker(key: string): Blocker {
  const known = REQUIREMENTS[key];
  if (known) return { key, label: known.label, step: known.step };

  // Forward compatibility: publish may grow a requirement this screen predates. Showing a raw key
  // with no way forward is a dead end, so it goes to the resume router, which derives the right
  // step from the tenant itself.
  return { key, label: humanizeKey(key), step: null };
}

export function humanizeKey(key: string): string {
  const words = key.replaceAll('_', ' ').trim();
  return words.length > 0 ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'One more detail';
}

export function previewDraft(state: SubmitState): string | null {
  if (state.status !== 'success') return null;
  const text = state.payload.review_text;
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
}

export function readRefusal(payload: unknown): Refusal {
  const fallback: Refusal = { message: 'Something went wrong. Please try again.', missing: null };
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;

  const error = (payload as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return fallback;

  const envelope = error as { message?: unknown; details?: unknown };
  const details =
    typeof envelope.details === 'object' && envelope.details !== null
      ? (envelope.details as { missing?: unknown })
      : undefined;

  return {
    // 23_API_Error_Codes.md guarantees a safe, user-facing message on every failure, so it is
    // shown as sent rather than remapped from the code here.
    message: typeof envelope.message === 'string' ? envelope.message : fallback.message,
    missing: Array.isArray(details?.missing)
      ? details.missing.filter((key): key is string => typeof key === 'string')
      : null,
  };
}

export function readPublication(payload: unknown): Publication {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

  return {
    publicUrl: typeof record.public_url === 'string' ? record.public_url : null,
    qrCode: typeof record.qr_code === 'string' ? record.qr_code : null,
  };
}
