import {
  AiProviderError,
  type AiProvider,
  type GenerationParams,
  type GenerationResult,
  type StructuredReview,
} from './provider';
import { isRecord, parseStructuredReview } from './structured-review';

/**
 * Google Gemini adapter — the third provider behind the same `AiProvider` seam.
 *
 * It exists because the Gemini API has a genuine free tier: on Google AI Studio's free plan a
 * Flash-class model costs nothing per token, which is the difference between a demo that can
 * run and one that cannot for an owner who has no card on file yet. Two things are true about
 * that tier and are stated here so nobody discovers them in production:
 *
 *  - Google's pricing page says free-tier content is "used to improve our products". Prompts
 *    carry merchant business context and nothing about the customer (V1 asks them nothing),
 *    but it is still a data-handling posture the owner is choosing, not one the product hides.
 *  - Its rate limits are per-project and visible only in AI Studio. A busy launch day can hit
 *    the daily cap, which arrives here as a 429 and reaches the customer as the fixed
 *    "assistant unavailable" message with the direct Google link still offered (AC-036).
 *
 * Built on `fetch` against `generateContent`, deliberately, for the same reasons the OpenAI
 * adapter is: one HTTP call per generate, no SDK retry loop spending money on our behalf, and
 * every field the request carries traceable to `ai_prompt_versions` (ADR-006).
 *
 * The one place Gemini differs materially from the other two: **thinking tokens count against
 * `maxOutputTokens`**. A Flash model left at its default thinking level spends several hundred
 * tokens reasoning before it writes a word, and a 320-token cap then truncates the draft — which
 * is a non-retryable failure, not a shorter review. The reasoning-effort value from the prompt
 * version is therefore mapped onto Gemini's `thinkingLevel` (see `thinkingLevelFor`), and the
 * seeded default pairs a model that accepts `minimal` with an effort that asks for it.
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Structural shapes only, for the same reason as the OpenAI adapter: no DOM lib, stable seam. */
export interface GeminiFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface GeminiHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type GeminiFetchLike = (url: string, init: GeminiFetchInit) => Promise<GeminiHttpResponse>;

export interface GeminiProviderOptions {
  apiKey: string;
  /** Override for a proxy deployment. Defaults to the public API. */
  baseUrl?: string;
  fetchImpl?: GeminiFetchLike;
  now?: () => number;
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: GeminiFetchLike;
  private readonly now: () => number;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
  }

  async generate(params: GenerationParams): Promise<GenerationResult> {
    const startedAt = this.now();

    const controller = new AbortController();
    let budgetExpired = false;
    const timer = setTimeout(() => {
      budgetExpired = true;
      controller.abort();
    }, params.timeoutMs);

    try {
      const response = await this.post(params, controller.signal);
      const requestId = response.headers.get('x-request-id');
      const bodyText = await response.text();

      if (!response.ok) {
        throw this.failFromStatus(response.status, bodyText, requestId, response.headers);
      }

      const payload = this.parsePayload(bodyText, requestId);
      const usage = payload['usageMetadata'];

      return {
        output: this.readStructuredReview(payload, requestId),
        inputTokens: readTokenCount(usage, 'promptTokenCount'),
        // Thinking tokens are billed as output and count against the cap, so they are output
        // for every purpose the cost dashboards have. Summed only when both are present; a
        // missing candidates count is a missing figure, not zero.
        outputTokens: sumTokens(
          readTokenCount(usage, 'candidatesTokenCount'),
          readTokenCount(usage, 'thoughtsTokenCount'),
        ),
        providerRequestId: readResponseId(payload) ?? requestId,
        latencyMs: Math.max(0, this.now() - startedAt),
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;

      if (budgetExpired) {
        throw this.fail(`gemini did not respond within ${params.timeoutMs}ms`, 'TIMEOUT', true);
      }

      throw this.fail(
        `gemini request failed before a response (cause=${safeToken(networkErrorCode(error))})`,
        'UPSTREAM',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private post(params: GenerationParams, signal: AbortSignal): Promise<GeminiHttpResponse> {
    // The model is a path segment, so it is validated as one: a value that could carry a
    // slash or a query string is refused here rather than sent somewhere unexpected.
    const model = params.model.trim();
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) {
      throw this.fail('gemini model id is not a valid model name', 'UPSTREAM', false);
    }

    return this.fetchImpl(`${this.baseUrl}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        // The header form, never the documented `?key=` query form: a query string is what a
        // proxy access log keeps (AC-030).
        'x-goog-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(buildRequestBody(params)),
      signal,
    });
  }

  private failFromStatus(
    status: number,
    bodyText: string,
    requestId: string | null,
    headers: GeminiHttpResponse['headers'],
  ): AiProviderError {
    const code = safeToken(readErrorStatus(bodyText));
    const context = `status=${status} code=${code} request_id=${safeToken(requestId)}`;

    // Both the per-minute limit and the free tier's daily cap arrive as 429 RESOURCE_EXHAUSTED.
    if (status === 429) {
      const retryAfter = safeToken(headers.get('retry-after'));
      return this.fail(
        `gemini rate limited (${context} retry_after=${retryAfter})`,
        'RATE_LIMITED',
        true,
      );
    }

    if (status === 408 || status === 504) {
      return this.fail(`gemini timed out upstream (${context})`, 'TIMEOUT', true);
    }

    // 503 UNAVAILABLE is the free tier's "model is overloaded", which really is transient.
    if (status >= 500) {
      return this.fail(`gemini upstream error (${context})`, 'UPSTREAM', true);
    }

    // 400 INVALID_ARGUMENT (schema, thinking level the model does not take), 403 (key), 404
    // (model): our request, so a retry buys the same answer. A config fix, not a retry.
    return this.fail(`gemini rejected the request (${context})`, 'UPSTREAM', false);
  }

  private parsePayload(bodyText: string, requestId: string | null): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw this.fail(
        `gemini returned a non-JSON body (request_id=${safeToken(requestId)})`,
        'UPSTREAM',
        true,
      );
    }
    if (!isRecord(parsed)) {
      throw this.fail(
        `gemini returned an unexpected envelope (request_id=${safeToken(requestId)})`,
        'UPSTREAM',
        true,
      );
    }
    return parsed;
  }

  private readStructuredReview(
    payload: Record<string, unknown>,
    requestId: string | null,
  ): StructuredReview {
    const id = safeToken(requestId);

    // The prompt itself was refused — a safety block on the input. Nothing was generated and
    // nothing will be on a retry with the same input.
    const feedback = payload['promptFeedback'];
    if (isRecord(feedback) && typeof feedback['blockReason'] === 'string') {
      throw this.fail(
        `gemini blocked the prompt (reason=${safeToken(feedback['blockReason'])} request_id=${id})`,
        'INVALID_OUTPUT',
        false,
      );
    }

    const candidates = payload['candidates'];
    const candidate = Array.isArray(candidates) ? candidates[0] : undefined;
    if (!isRecord(candidate)) {
      throw this.fail(`gemini returned no candidate (request_id=${id})`, 'INVALID_OUTPUT', true);
    }

    const finishReason = candidate['finishReason'];
    if (finishReason === 'MAX_TOKENS') {
      // Config, not chance: the cap is too small for this model's thinking plus a draft.
      // Retrying spends the same tokens to be cut off at the same place.
      throw this.fail(
        `gemini stopped early (reason=MAX_TOKENS request_id=${id})`,
        'INVALID_OUTPUT',
        false,
      );
    }
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      throw this.fail(
        `gemini withheld the output (reason=${safeToken(finishReason)} request_id=${id})`,
        'INVALID_OUTPUT',
        false,
      );
    }
    if (typeof finishReason === 'string' && finishReason !== 'STOP') {
      throw this.fail(
        `gemini stopped early (reason=${safeToken(finishReason)} request_id=${id})`,
        'INVALID_OUTPUT',
        true,
      );
    }

    const text = readText(candidate);
    if (text === null) {
      throw this.fail(`gemini returned no text (request_id=${id})`, 'INVALID_OUTPUT', true);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.fail(`gemini output was not JSON (request_id=${id})`, 'INVALID_OUTPUT', true);
    }

    const review = parseStructuredReview(parsed);
    if (review === null) {
      throw this.fail(
        `gemini output did not match the schema (request_id=${id})`,
        'INVALID_OUTPUT',
        true,
      );
    }
    return review;
  }

  private fail(
    message: string,
    errorClass: AiProviderError['errorClass'],
    retryable: boolean,
  ): AiProviderError {
    return new AiProviderError(this.redact(message), errorClass, retryable);
  }

  private redact(message: string): string {
    return redactGeminiSecrets(message, this.apiKey);
  }
}

/** AC-030. Any Google-shaped API key, not only ours. */
/**
 * The classic `AIza…` form and the `AQ.…` form AI Studio issues now. The configured key
 * is also removed by exact match, so this is the backstop for someone else's key echoed back.
 */
const KEY_LIKE = /\b(?:AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,})/g;

export function redactGeminiSecrets(message: string, ownKey = ''): string {
  const withoutOwnKey = ownKey.length >= 8 ? message.split(ownKey).join('[redacted]') : message;
  return withoutOwnKey.replace(KEY_LIKE, '[redacted]');
}

/**
 * Gemini's thinking control, derived from the prompt version's reasoning effort.
 *
 * The stored value is provider-neutral admin data: `none` is what the spec pack wrote for
 * OpenAI, and it is the right intent here too — spend nothing on reasoning before a 60-word
 * draft. Gemini has no "off"; its floor is `minimal` on the models that accept it, so `none`
 * and `minimal` both become `minimal`. The three named levels pass through. Blank, or anything
 * else, sends nothing and lets the model default — which on a Flash model means several hundred
 * thinking tokens inside the cap, and is exactly why the seeded default is not blank.
 */
export function thinkingLevelFor(reasoningEffort: string): string | null {
  const effort = reasoningEffort.trim().toLowerCase();
  if (effort === 'none' || effort === 'minimal') return 'minimal';
  if (effort === 'low' || effort === 'medium' || effort === 'high') return effort;
  return null;
}

function buildRequestBody(params: GenerationParams): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: params.maxOutputTokens,
    responseMimeType: 'application/json',
    // The admin-owned schema, verbatim — the same object the other adapters send. Output is
    // still re-validated field by field by parseStructuredReview.
    responseJsonSchema: params.outputSchema,
  };

  const thinkingLevel = thinkingLevelFor(params.reasoningEffort);
  if (thinkingLevel !== null) {
    generationConfig['thinkingConfig'] = { thinkingLevel };
  }

  return {
    systemInstruction: { parts: [{ text: params.prompt.system }] },
    contents: [{ role: 'user', parts: [{ text: params.prompt.user }] }],
    generationConfig,
  };
}

function readText(candidate: Record<string, unknown>): string | null {
  const content = candidate['content'];
  if (!isRecord(content)) return null;
  const parts = content['parts'];
  if (!Array.isArray(parts)) return null;

  const texts = parts
    .filter(isRecord)
    // Thought summaries come back as parts flagged `thought`; they are not the answer.
    .filter((part) => part['thought'] !== true)
    .map((part) => part['text'])
    .filter((text): text is string => typeof text === 'string');

  if (texts.length === 0) return null;
  const joined = texts.join('');
  return joined.trim().length > 0 ? joined : null;
}

function readResponseId(payload: Record<string, unknown>): string | null {
  const id = payload['responseId'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function readTokenCount(usage: unknown, key: string): number | null {
  if (!isRecord(usage)) return null;
  const value = usage[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumTokens(candidates: number | null, thoughts: number | null): number | null {
  if (candidates === null) return null;
  return candidates + (thoughts ?? 0);
}

/** Gemini errors are `{ error: { code, message, status } }`; `status` is the enum-like name. */
function readErrorStatus(bodyText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const error = parsed['error'];
  if (!isRecord(error)) return null;
  const status = error['status'];
  return typeof status === 'string' ? status : null;
}

function networkErrorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  const direct = error['code'];
  if (typeof direct === 'string') return direct;
  const cause = error['cause'];
  if (isRecord(cause) && typeof cause['code'] === 'string') return cause['code'];
  return null;
}

function safeToken(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(trimmed) ? trimmed : 'unknown';
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
