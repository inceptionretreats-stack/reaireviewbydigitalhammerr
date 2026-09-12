/**
 * The language a draft is written in (CHANGE-003).
 *
 * Declared here as well as in @ai-review/db and @ai-review/contracts, because this package may
 * not depend on either at runtime and client bundles may not depend on this one. A test in
 * apps/web pins the three lists to each other.
 *
 * Its own module so that guidance.ts and prompt-builder.ts can both import it without importing
 * each other.
 */
export const DRAFT_LANGUAGES = ['en', 'hinglish'] as const;
export type DraftLanguage = (typeof DRAFT_LANGUAGES)[number];
export const DEFAULT_DRAFT_LANGUAGE: DraftLanguage = 'hinglish';

/** The user-prompt line that names the language. Shared with the stub so the two cannot drift. */
export function draftLanguageLine(language: DraftLanguage): string {
  return `DRAFT_LANGUAGE=${language}`;
}

/**
 * Reads the language back out of a built user prompt.
 *
 * Line-anchored on purpose: PREVIOUS_DRAFTS embeds earlier drafts verbatim, and a customer's
 * draft could contain the literal text "DRAFT_LANGUAGE=en" without meaning it. Prompts built
 * before CHANGE-003 carry no line at all and are English, which is what they were.
 */
export function readDraftLanguage(userPrompt: string): DraftLanguage {
  const match = /^DRAFT_LANGUAGE=(en|hinglish)$/m.exec(userPrompt);
  return match ? (match[1] as DraftLanguage) : 'en';
}
