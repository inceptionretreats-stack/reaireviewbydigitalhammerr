import { DRAFT_LANGUAGES, type DraftLanguage } from './draft-language';

/**
 * The writing rules, as data (ADR-006, ADMIN-03, E4-08).
 *
 * These lines used to be constants in prompt-builder.ts, which meant that changing how every
 * business's drafts read — the register, the emoji, what counts as a claim — was a developer's
 * job and a deploy. They belong on the prompt version row: an admin edits a draft version,
 * activates it, and the next generation uses it; rolling back is activating the previous one.
 *
 * The shape is deliberately plain — lists of strings, one rule per line, keyed by what the
 * builder does with them — so an admin screen can present them as text areas and a reviewer can
 * read a diff. The builder owns the *mechanism* (which language block, which opening hint this
 * generation gets); the version owns the *words*.
 *
 * `DEFAULT_GUIDANCE` is the seed's content for the current version and the fallback for a row
 * whose column is empty or damaged, so a generation never runs with no rules at all.
 */

export interface PromptGuidance {
  /** Per language: the first line introduces the language, the rest are rules. */
  language_rules: Record<DraftLanguage, string[]>;
  /** Claims the model must not make in any language. */
  claim_rules: string[];
  /** How emoji are used; one entry per rule. */
  emoji_rules: string[];
  /** Opening angles, rotated per generation. At least one. */
  opening_hints: string[];
  /** Emoji placements, rotated per generation on a different stride. At least one. */
  emoji_placements: string[];
}

const CLAIM_RULES = [
  '- Say nothing about speed, waiting or timing — not slow, not quick, not on time, not how long anything took. The customer has not told you.',
  '- Do not add a complaint or a caveat to seem balanced. If the customer has one, they will write it themselves.',
];

export const DEFAULT_GUIDANCE: PromptGuidance = {
  language_rules: {
    en: ['LANGUAGE_RULES: Write the draft in plain, natural English.'],
    hinglish: [
      'LANGUAGE_RULES: Write the draft in Hinglish — everyday spoken Hindi written in English letters (Roman script), naturally mixed with common English words, the way people in India write Google reviews.',
      '- Do not use Devanagari or any other script. Do not translate the business name or the names of dishes and services.',
      '- Write the way someone would actually say it, not as a word-for-word translation of an English review.',
      '- Register example, for tone only — do not reuse its words or its structure: "Khana bahut tasty tha aur staff bhi kaafi friendly the. Overall experience accha raha."',
      '- Keep it 45 to 85 words. No superlatives such as sabse best, behtareen or perfect; no stars, ratings, prices, discounts or exact times.',
      '- Do not say when the visit happened — no kal, aaj, pichhle hafte or any date. The customer may be there right now.',
    ],
  },
  claim_rules: CLAIM_RULES,
  emoji_rules: [
    'EMOJI: Use one to three emoji the way people do in Google reviews — 😋 🤤 for food, 🙌 ❤️ ✨ 👌 😊 for the experience — placed after the thing they react to or at the end. Never one per sentence, never the same emoji twice, never as a list.',
  ],
  opening_hints: [
    'Open with what you came for — the dish, the service, the reason for the visit.',
    'Open with the atmosphere or the place itself, before anything about the food or service.',
    'Open with how the visit went overall, then one specific thing.',
    'Open with the people — how you were treated — before anything else.',
    'Open mid-thought, the way people actually write, without introducing the business by name.',
    'Open with a small detail you noticed, then widen to the visit as a whole.',
    'Open with who you went with or what the occasion was, without naming a date.',
    'Open with a question you had before going, and whether the visit answered it.',
    'Open with what you would tell a friend who asked about this place.',
    'Open with the one thing you would come back for.',
  ],
  emoji_placements: [
    'one emoji, at the very end',
    'one emoji right after the dish or service you name, and one at the end',
    'two emoji in the middle of the text, none at the end',
    'one emoji after the first sentence, nowhere else',
    'two or three, wherever they feel natural — but never in every sentence',
  ],
};

const MAX_LINES = 40;
const MAX_LINE_LENGTH = 600;

function lines(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= MAX_LINE_LENGTH);
  return out.slice(0, MAX_LINES);
}

/**
 * Reads a stored `guidance` column into a usable shape.
 *
 * Every list falls back to the default when it is missing or malformed, and the two lists the
 * builder indexes into (openings, placements) fall back when empty, because a modulo by zero is
 * not a prompt. A version an admin has emptied on purpose therefore still generates — with the
 * defaults — rather than failing every customer until someone notices.
 */
export function parseGuidance(raw: unknown): PromptGuidance {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const languageRaw =
    typeof source['language_rules'] === 'object' && source['language_rules'] !== null
      ? (source['language_rules'] as Record<string, unknown>)
      : {};

  const language_rules = Object.fromEntries(
    DRAFT_LANGUAGES.map((lang) => [
      lang,
      lines(languageRaw[lang])?.length
        ? lines(languageRaw[lang])!
        : DEFAULT_GUIDANCE.language_rules[lang],
    ]),
  ) as Record<DraftLanguage, string[]>;

  const listOr = (key: 'claim_rules' | 'emoji_rules', allowEmpty: boolean) => {
    const parsed = lines(source[key]);
    if (parsed === null) return DEFAULT_GUIDANCE[key];
    return parsed.length === 0 && !allowEmpty ? DEFAULT_GUIDANCE[key] : parsed;
  };
  const rotation = (key: 'opening_hints' | 'emoji_placements') => {
    const parsed = lines(source[key]);
    return parsed && parsed.length > 0 ? parsed : DEFAULT_GUIDANCE[key];
  };

  return {
    language_rules,
    // An admin may legitimately turn claim or emoji rules off by emptying the list.
    claim_rules: listOr('claim_rules', true),
    emoji_rules: listOr('emoji_rules', true),
    opening_hints: rotation('opening_hints'),
    emoji_placements: rotation('emoji_placements'),
  };
}
