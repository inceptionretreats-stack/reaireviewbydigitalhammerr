/**
 * The load-bearing sentences on the two AI screens, in one place.
 *
 * These are not here to save typing. Each one is the only place a product decision is explained to
 * the person it constrains, so rewording any of them is a compliance change rather than an edit:
 *
 * - CONTEXT_HELPER is quoted verbatim from 09_AI_Prompt_and_Generation_Spec.md, "Merchant keywords
 *   implementation". Its second sentence is D-025 and AC-010 — terms are hints, not required words
 *   — said at the moment the owner is typing them.
 * - MODE_EMPHASIS_NOTE is the same spec's rule that a mode must never mean "positive only",
 *   "5 star" or "negative suppress", in the owner's language. It is also the answer to the question
 *   a list of modes invites, which is "which one makes the reviews better".
 * - QR_UNAFFECTED_NOTE is AI-02-03. It reads as reassurance and it is: an owner who suspects that
 *   switching modes reprints their standees will never switch, and modes become dead weight.
 * - PREVIEW_FREE_NOTE is AI-01-01, stated before the button rather than after. An owner who
 *   suspects a preview spends their free customer generations will not press it, and the feature
 *   that exists to build confidence fails at the only job it has.
 * - DRAFT_FRAMING_NOTE is ADR-008 and D-008: what comes back is a draft the customer edits and
 *   affirms, and nobody is asked for a rating anywhere in the flow (D-009, AC-006).
 *
 * `components/onboarding/AiContextStep.tsx` holds its own copy of the first two because it predates
 * this module and was outside this change; see the concern raised with it.
 */

export const CONTEXT_HELPER =
  'Add services or topics that help Ai understand your business. These are context hints and may ' +
  'not appear in every review.';

export const MODE_EMPHASIS_NOTE =
  'A mode changes which topics a draft leans on — food, service, ambience, a particular service ' +
  'line. It never makes a draft more positive, it never asks anyone for a rating, and it never ' +
  'holds back what a customer wants to say.';

export const QR_UNAFFECTED_NOTE =
  'Switching modes does not change your QR codes. Every printed code keeps pointing at the same ' +
  'page, so nothing needs reprinting.';

export const PREVIEW_FREE_NOTE =
  'Previews are free — they never use any of your free customer generations.';

export const DRAFT_FRAMING_NOTE =
  'A starting point, not a finished review: your customer rewrites whatever they like and ' +
  'confirms it reflects their own experience before copying it. Nobody is asked for a star ' +
  'rating on your page.';
