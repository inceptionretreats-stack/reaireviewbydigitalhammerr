import { readDraftLanguage, type BuiltPrompt } from './prompt-builder';
import { checkVariation } from './similarity';

/**
 * Provider adapter (E4-04, ADR-006, ADR-007).
 *
 * Deliberately thin, for two reasons. The model id is admin data in ai_prompt_versions rather
 * than source, so quality can be rolled back without a deploy (ADMIN-03-03). And the AI line
 * is the dominant variable cost of the business — roughly 4.6% of revenue on Luna against
 * ~45% on Terra — so being able to change provider or model by configuration is a commercial
 * control, not just an architectural nicety.
 */

export interface GenerationParams {
  prompt: BuiltPrompt;
  model: string;
  maxOutputTokens: number;
  reasoningEffort: string;
  timeoutMs: number;
  outputSchema: Record<string, unknown>;
}

/** Matches the strict output schema in 10_AI_Prompt_Templates.json. */
export interface StructuredReview {
  review_text: string;
  used_context_terms: string[];
  claim_risk: 'low' | 'medium' | 'high';
  /** Never shown to the customer (09_AI_Prompt_and_Generation_Spec.md). */
  internal_quality_notes: string[];
}

export interface GenerationResult {
  output: StructuredReview;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
  latencyMs: number;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly errorClass: 'TIMEOUT' | 'RATE_LIMITED' | 'INVALID_OUTPUT' | 'UPSTREAM',
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiProvider {
  readonly name: string;
  generate(params: GenerationParams): Promise<GenerationResult>;
}

/**
 * Deterministic stub used by CI and local development.
 *
 * Every automated test in the pack's required suites — the quota boundary, the confirmation
 * gate, the funnel — needs generation to work without reaching a paid provider.
 *
 * Selection is derived from `params`, never from instance state. It used to come from a call
 * counter, which was correct in a unit test holding one provider for a whole scenario and wrong
 * everywhere else: the route builds a fresh provider per request, so the counter restarted at 0
 * on every call while the similarity gate compared against drafts that had been *persisted*.
 * The third generation in a session therefore proposed two already-stored drafts, exhausted its
 * attempts and returned AI_OUTPUT_REJECTED — permanently, because the anonymous cookie lives for
 * thirty days. Deriving from the request makes the stub behave the same however it is
 * constructed, which is the only property that made the bug possible to miss.
 */
export class StubAiProvider implements AiProvider {
  readonly name = 'stub';
  private callCount = 0;

  constructor(private readonly behaviour: 'ok' | 'fail' | 'repetitive' = 'ok') {}

  /** Kept for tests that assert how many provider calls a scenario made. */
  get calls(): number {
    return this.callCount;
  }

  generate(params: GenerationParams): Promise<GenerationResult> {
    this.callCount += 1;

    if (this.behaviour === 'fail') {
      return Promise.reject(new AiProviderError('stub failure', 'UPSTREAM', true));
    }

    return Promise.resolve({
      output: {
        review_text: this.draftFor(params),
        used_context_terms: [],
        claim_risk: 'low',
        internal_quality_notes: [],
      },
      inputTokens: 420,
      outputTokens: 96,
      providerRequestId: `stub-${this.callCount}`,
      latencyMs: 5,
    });
  }

  /**
   * The first draft the prompt has not already seen.
   *
   * buildPrompt embeds PREVIOUS_DRAFTS verbatim, so the prompt itself says which texts would be
   * rejected as too similar — no new interface, and no guessing. A real provider does this by
   * writing something new; the stub does it by choosing something unused, which is the closest
   * honest imitation available to a fixed pool.
   */
  private draftFor(params: GenerationParams): string {
    const seen = params.prompt.user;
    // The pool follows the language the prompt asks for, so a Hinglish business gets Hinglish
    // from the stub too. Without this the no-key demo would quietly show English for a setting
    // that claims otherwise, and no end-to-end test could tell the setting did anything.
    const language = readDraftLanguage(seen);
    const selected = stubSelectedServices(seen);
    const business = stubBusiness(seen);
    const pool =
      selected.length > 0
        ? stubServiceDrafts(selected, business.name, language === 'hinglish')
        : stubGeneralDrafts(business, language === 'hinglish');

    // 'repetitive' must always return the same text: it exists so the variation gate can be
    // tested for real, and picking a fresh draft would defeat exactly that.
    if (this.behaviour === 'repetitive') return pool[0]!;

    // A changed service name can make an old template look "unused" while it remains too
    // similar to the prior draft. Match the real gate instead of retrying that template forever.
    const previousDrafts = selected.length > 0 ? stubPreviousDrafts(seen) : [];
    const unused = pool.find(
      (draft) => !seen.includes(draft) && checkVariation(draft, previousDrafts).passed,
    );
    if (unused) return unused;

    // Pool exhausted — more prior drafts than the pool holds. Fall back to a prompt-derived
    // index so the answer still varies with the request rather than with call order.
    return pool[hashToIndex(seen, pool.length)]!;
  }
}

/** Test/dev provider only: respect the same service-scoped prompt exercised in production. */
function stubSelectedServices(prompt: string): string[] {
  const raw = /^CUSTOMER_SELECTED_SERVICES=(.*)$/m.exec(prompt)?.[1];
  if (!raw) return [];
  try {
    const values: unknown = JSON.parse(raw);
    return Array.isArray(values)
      ? values
          .filter((value): value is string => typeof value === 'string' && value.length <= 80)
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function stubPreviousDrafts(prompt: string): string[] {
  const raw = /^PREVIOUS_DRAFTS=(.*)$/m.exec(prompt)?.[1];
  if (!raw) return [];
  try {
    const values: unknown = JSON.parse(raw);
    return Array.isArray(values)
      ? values.filter((value): value is string => typeof value === 'string').slice(-3)
      : [];
  } catch {
    return [];
  }
}

interface StubBusiness {
  name: string;
}

const DEFAULT_STUB_BUSINESS: StubBusiness = {
  name: 'Demo South Cafe',
};

/** The stub uses only the same business facts the real model sees, never invented outcomes. */
function stubBusiness(prompt: string): StubBusiness {
  const raw = /^BUSINESS=(.*)$/m.exec(prompt)?.[1];
  if (!raw) return DEFAULT_STUB_BUSINESS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return DEFAULT_STUB_BUSINESS;
    const fields = value as Record<string, unknown>;
    return {
      name:
        typeof fields['name'] === 'string' && fields['name'].trim()
          ? fields['name'].trim()
          : DEFAULT_STUB_BUSINESS.name,
    };
  } catch {
    return DEFAULT_STUB_BUSINESS;
  }
}

function stubServiceDrafts(services: string[], businessName: string, hinglish: boolean): string[] {
  // "SEO aur Graphic design", not "SEO, Graphic design": a list read aloud, not a label.
  const names =
    services.length > 1
      ? `${services.slice(0, -1).join(', ')} ${hinglish ? 'aur' : 'and'} ${services.at(-1)}`
      : (services[0] ?? '');
  // Synthetic fixtures in the voice the real prompt asks for: warm, about the selected work,
  // and free of anything a customer did not supply (no figures, names, timings or results).
  // They are never a production fallback: production configuration requires a real provider.
  return hinglish
    ? [
        `${businessName} se ${names} ka kaam karwaya aur experience kaafi accha raha. Kaam saaf-suthra aur dhyan se kiya gaya tha. Zaroorat padi to dobara inhi ke paas aaunga.`,
        `${names} ke liye maine ${businessName} ko chuna tha, aur yeh decision sahi nikla. Kaam professional laga aur meri zaroorat ke hisaab se hua. Overall main khush hoon.`,
        `Mujhe ${businessName} ka ${names} wala kaam bahut pasand aaya. Har cheez aaram se samjhayi gayi aur final kaam neat tha. Accha anubhav raha.`,
        `Agar aapko ${names} karwana hai to ${businessName} ek accha option hai. Mera experience smooth raha aur kaam dekh kar tasalli hui.`,
        `${names} ka kaam ${businessName} se liya, aur jaisa socha tha waisa hi laga. Kaam mein mehnat saaf dikhti hai. Aage bhi inhe hi try karunga 🙌`,
        `${businessName} ke saath ${names} ka mera anubhav accha raha hai. Sab kuch tareeke se hua aur kaam ki quality pasand aayi. Inke paas phir se aana chahunga.`,
        `Maine ${businessName} par ${names} karwaya tha aur kaafi satisfied hoon. Kaam polished laga, bilkul waisa jaisa mujhe chahiye tha 😊`,
        `${names} ke liye ${businessName} gaya tha aur wahan ka kaam achha laga. Sab kuch dhang se samjha aur kiya gaya. Agli baar bhi inhi ko chununga.`,
      ]
    : [
        `Got ${names} done through ${businessName} and came away happy with it. The work felt thoughtful and well put together, and it matched what I had in mind.`,
        `${businessName} handled ${names} for me. Everything was clear along the way, and I liked how carefully the work was done. I would use them again.`,
        `Pleased with the ${names} work from ${businessName}. It came out neat and professional and fit what I needed. Glad I picked them 👍`,
        `If you need ${names}, ${businessName} is worth a look. My own experience with them was smooth, and the finished work looked good to me.`,
        `My experience with ${businessName} for ${names} was a good one. The work was done with care and felt right for what I wanted. Happy to go back to them.`,
        `Chose ${businessName} for ${names} and it turned out to be a good decision. The approach was easy to follow and the work looked polished. Satisfied overall 😊`,
        `Really liked the ${names} I got from ${businessName}. It looked tidy, felt well thought out, and suited what I was after. Would return for more.`,
        `${names} at ${businessName} left a good impression on me. Things were explained simply and the finished work looked solid. Glad I went with them.`,
      ];
}

/**
 * Eight, not four: the similarity gate compares against the last three drafts and the generator
 * makes up to three attempts, so a pool that small could be exhausted inside one session.
 */
function stubGeneralDrafts(business: StubBusiness, hinglish: boolean): string[] {
  const { name } = business;
  return hinglish
    ? [
        `${name} ke saath mera experience kaafi accha raha. Sab kuch tareeke se hua aur kaam dhyan se kiya gaya. Dobara zaroor aaunga.`,
        `${name} ne mujh par accha impression chhoda. Service samajhne mein aasaan thi aur final kaam neat laga. Inhe chunna sahi raha.`,
        `Agar koi ${name} ke baare mein puchhe to main kahunga ki yahan ka kaam bharose layak hai. Mera anubhav smooth aur pleasant raha 😊`,
        `Mujhe ${name} ki service bahut pasand aayi. Kaam professional tha aur mujhe kisi baat ki fikar nahi karni padi. Overall khush hoon.`,
        `${name} par kaam karwa ke tasalli hui. Har cheez saaf-suthre dhang se hui aur zaroorat ke hisaab se kaam mila. Phir se inhi ke paas jaunga.`,
        `Achhi service chahiye thi aur ${name} ne nirash nahi kiya. Kaam mein mehnat dikhi aur sab aaram se hua. Accha anubhav raha 🙌`,
        `${name} ka mera anubhav positive raha hai. Kaam ki quality pasand aayi aur cheezein samjhaane ka tareeka bhi theek tha. Aage bhi yahin aaunga.`,
        `${name} se jo service li, usse main satisfied hoon. Kaam polished laga aur poora process aaram se hua. Doston ko bhi inke baare mein bataunga.`,
      ]
    : [
        `Had a good experience with ${name}. Everything felt well organised and the work was done with care. I would happily go back.`,
        `${name} left a good impression on me. The service was easy to follow and the end result looked neat. Glad I chose them 👍`,
        `If a friend asked about ${name}, I would say the work here is dependable. My experience was smooth and pleasant from start to end.`,
        `Really liked the service at ${name}. It felt professional and I never had to worry about anything. Happy with how it went overall.`,
        `Getting things done at ${name} was a relief. Everything was handled neatly and the work suited what I needed. I would return.`,
        `I wanted reliable service and ${name} did not disappoint. You can see the effort in the work, and the process was relaxed 😊`,
        `My experience with ${name} has been a positive one. I liked the quality of the work and how clearly things were explained. Will come back.`,
        `Satisfied with the service I got from ${name}. The work looked polished and the whole process went comfortably. Worth considering.`,
      ];
}

export const STUB_DRAFTS = stubGeneralDrafts(DEFAULT_STUB_BUSINESS, false);

/**
 * The Hinglish pool (CHANGE-003) — the same eight-draft shape, in the register the owner asked
 * for: everyday Hindi in Roman script mixed with English. Each passes every compliance gate,
 * carries no digit or "star", and every pair sits below the similarity threshold; the unit
 * suite pins all of that so an edit here cannot quietly break the stub-driven E2E flow.
 */
export const STUB_DRAFTS_HINGLISH = stubGeneralDrafts(DEFAULT_STUB_BUSINESS, true);

/**
 * Words that mark a draft as Hinglish rather than English. Used by tests — including E2E, which
 * copies the pattern literally because Playwright must not import this package.
 */
export const HINGLISH_MARKER = /\b(?:tha|thi|aur|hai|raha|bahut|kaafi|accha|acha)\b/i;

/** FNV-1a, for a stable index from a string. Not security-sensitive. */
function hashToIndex(value: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % buckets;
}
