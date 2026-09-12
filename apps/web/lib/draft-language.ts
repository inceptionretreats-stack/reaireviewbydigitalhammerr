import { DEFAULT_DRAFT_LANGUAGE, DRAFT_LANGUAGES, type DraftLanguage } from '@ai-review/contracts';

/**
 * The owner-facing side of the draft-language setting (CHANGE-003).
 *
 * Lives in `lib/`, imports only the contracts package, and carries no `'use client'` directive
 * on purpose: the Server Component pages that read the stored value need `isDraftLanguage`, the
 * client forms need the options, and a Server Component may not import a value from a client
 * module (the same constraint `toStringArray` documents in components/onboarding/ai-context.ts).
 * Nothing here may import `@ai-review/core` — that package drags pg, ioredis and argon2 into a
 * browser bundle.
 *
 * On the copy: it says what the setting changes — the language of the draft — and nothing else.
 * The E2E body-text sweeps forbid any wording that reads as required keywords or as a rating,
 * and `copy.test.ts` polices the same vocabulary for the rest of the Ai screens.
 */

export { DEFAULT_DRAFT_LANGUAGE, DRAFT_LANGUAGES, type DraftLanguage };

export interface DraftLanguageOption {
  value: DraftLanguage;
  label: string;
}

export const DRAFT_LANGUAGE_OPTIONS: readonly DraftLanguageOption[] = [
  { value: 'hinglish', label: 'Hinglish — Hindi in English letters, mixed with English' },
  { value: 'en', label: 'English' },
];

export const DRAFT_LANGUAGE_LABEL = 'Draft language';

export const DRAFT_LANGUAGE_HINT =
  'Hinglish is how most customers in India write Google reviews. Your customer can still rewrite the draft however they like.';

/** Narrows a value read straight from the database, which Drizzle types but does not check. */
export function isDraftLanguage(value: unknown): value is DraftLanguage {
  return typeof value === 'string' && (DRAFT_LANGUAGES as readonly string[]).includes(value);
}

/** The stored value, or the platform default when the business has never saved a context row. */
export function toDraftLanguage(value: unknown): DraftLanguage {
  return isDraftLanguage(value) ? value : DEFAULT_DRAFT_LANGUAGE;
}
