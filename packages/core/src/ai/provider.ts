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
    const pool =
      selected.length > 0
        ? stubServiceDrafts(selected, language === 'hinglish')
        : language === 'hinglish'
          ? STUB_DRAFTS_HINGLISH
          : STUB_DRAFTS;

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

function stubServiceDrafts(services: string[], hinglish: boolean): string[] {
  const names = services.join(', ');
  // These neutral synthetic fixtures deliberately avoid making up satisfaction or outcomes.
  // They are never a production fallback: production configuration requires a real provider.
  return hinglish
    ? [
        `${names} ke liye mera yahan ka experience tha. Meri baat inhi services se judi hai; yahan ka anubhav mere liye isi kaam se sambandhit raha, kisi aur offering se nahi.`,
        `Maine ${names} liya tha. Yahan likhi baat usi kaam tak seemit hai, kisi aur suvidha ke baare mein nahi. Mere experience ka sandarbh bhi wahi hai jo maine khud istemal kiya.`,
        `Is business se ${names} lene ke baad apni baat likh raha hoon. Yahan se mera sambandh inhi services ka raha hai. Doosri offerings ki jagah apne istemal ki hui services ka zikr hai.`,
        `${names} mere experience ka hissa tha. Apni zaroorat aur usse jude kaam ko lekar yeh review hai. Yahan jo maine liya, meri baat bhi usi se sambandhit hai.`,
        `Mera sambandh yahan ${names} se raha hai. Kisi doosre kaam par tipanni nahi kar raha. Apna nazariya batane ke liye in services ko review ka vishay rakha hai.`,
        `Yeh likhte waqt ${names} ko dhyan mein rakh raha hoon. Baat usi cheez ki hai jo maine khud li, baaki business ki offerings ki nahi. Is jagah se mera kaam isi tarah juda tha.`,
        `${names} maine istemal kiya hai aur review ka sandarbh wahi hai. Yahan mere liye yahi services relevant thi. Poore business ki jagah meri baat apne liye liye gaye kaam par hai.`,
        `Apna review ${names} ke sambandh mein likh raha hoon. In services ke zariye is business ke saath mera experience raha hai. Yahan mera zikr bhi isi istemal tak seemit hai.`,
      ]
    : [
        `${names} are the services I used. My review relates to this part of my experience with the business, rather than any of the other services it may offer to its customers.`,
        `I came to this business for ${names}. Those services are the subject of my feedback. My experience here concerns that work, so this account is specific to what I used.`,
        `The reason for writing here is my use of ${names}. My connection with this business is through those services, and the comments relate to that part of its work.`,
        `Having used ${names} through this business, that is the context of my review. This account concerns my own use of those services, rather than anyone else's experience.`,
        `My connection with the business concerns ${names}. Any opinion I share should relate to what I actually used, without speaking for other customers or describing unrelated offerings.`,
        `For this review, the focus is ${names}. Those are the services behind my experience here. I am referring to the work I used, not making an assessment of the business's other offerings.`,
        `${names} form the background to my experience with this business. They are what brought me here as a customer, and the account I am sharing concerns those particular services.`,
        `I am writing about ${names}, which I used through this business. My thoughts belong to that specific experience. These services are the basis of my own connection with the business.`,
      ];
}

/**
 * Eight, not four: the similarity gate compares against the last three drafts and the generator
 * makes up to three attempts, so a pool that small could be exhausted inside one session.
 */
export const STUB_DRAFTS = [
  'Visited recently and found the whole thing straightforward. Staff were helpful when I had a question, and I would happily come back another time.',
  'Dropped by this week without an appointment. Everything moved along at a comfortable pace and I left satisfied with how the visit went overall.',
  'Called in during the afternoon. The place was tidy, the people there answered what I asked, and nothing about the visit felt like a hassle.',
  'Been meaning to write about my visit here. It was an easy experience from start to finish and I have no complaints worth mentioning at all.',
  'Stopped in on a weekday morning and was seen without much of a wait. The people here were patient with my questions and I left knowing what I needed to.',
  'Came here on a recommendation from a neighbour. Everything was explained clearly before anything went ahead, which I appreciated more than I expected to.',
  'A straightforward visit with no surprises. I was told what to expect at the start and that is roughly how it went, which is all I really wanted.',
  'Went in expecting to wait around and did not have to. Simple to deal with, easy to find, and I would not hesitate to come back if I need to.',
];

/**
 * The Hinglish pool (CHANGE-003) — the same eight-draft shape, in the register the owner asked
 * for: everyday Hindi in Roman script mixed with English. Each passes every compliance gate,
 * carries no digit or "star", and every pair sits below the similarity threshold; the unit
 * suite pins all of that so an edit here cannot quietly break the stub-driven E2E flow.
 */
export const STUB_DRAFTS_HINGLISH = [
  'Pichhle hafte yahan gaya tha aur experience accha raha 😊. Staff ne meri baatein dhyan se suni aur jo pucha uska seedha jawab mila. Dobara aana chahunga 🙌',
  'Bina appointment ke drop in kiya tha, phir bhi kaam aaram se ho gaya. Jagah saaf thi aur log bhi kaafi friendly the. Overall visit se main santusht hoon.',
  'Dopahar mein visit kiya. Sab kuch pehle se samjha diya gaya tha, isliye koi confusion nahi hui ✨. Simple aur seedha experience raha, koi jhanjhat nahi.',
  'Ek neighbour ki recommendation par yahan aaya tha. Jo bataya gaya tha waisa hi hua, aur staff ka behaviour bhi acha laga. Zaroorat padi to phir aaunga.',
  'Weekday subah gaya tha aur zyada wait nahi karna pada. Meri queries patiently sun kar jawab diya gaya, aur main jo jaanna chahta tha wo clear ho gaya.',
  'Kaafi time se yahan ke baare mein likhna tha. Shuru se aakhir tak sab smooth raha aur koi shikayat nahi hai. Aise hi kaam karte rahein ❤️',
  'Yahan ka mahaul shaant aur saaf tha. Jo poocha, uska theek se jawab mila aur kisi cheez ke liye zor nahi diya gaya. Accha laga, phir kabhi aaunga.',
  'Socha tha wait karna padega, par aisa hua nahi. Deal karna easy tha, jagah dhoondhna bhi aasaan, aur zaroorat par wapas aane mein koi hichkichahat nahi.',
];

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
