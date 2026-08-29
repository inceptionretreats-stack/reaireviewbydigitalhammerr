import {
  AiProviderError,
  type AiProvider,
  type GenerationParams,
  type GenerationResult,
  type StructuredReview,
} from './provider';

/**
 * Real OpenAI adapter for the Responses API (E4-04, ADR-006, ADR-007,
 * 09_AI_Prompt_and_Generation_Spec.md "Provider contract").
 *
 * Built on `fetch` rather than the `openai` SDK, deliberately:
 *
 *  - The SDK retries automatically (2 by default). Each retry is a second billed call inside
 *    an 8-second budget that has already been spent, so it would inflate the dominant variable
 *    cost of the business while making the deadline *more* likely to be missed. We would have
 *    to switch it off, at which point the SDK is a transport wrapper.
 *  - ADR-006 makes model, reasoning effort, output cap and JSON schema admin data read from
 *    ai_prompt_versions. The SDK's value is its typed unions over those exact fields, and a
 *    union cannot type a string that arrives from a database row — it would cost casts, which
 *    house style forbids.
 *  - `packages/core` is framework-free with no runtime provider dependency today, and a
 *    structural `FetchLike` seam is a cleaner test double than an SDK client mock.
 *
 * Two invariants this class exists to hold:
 *
 *  1. Exactly one HTTP call per `generate()`. No internal retry — the single permitted retry
 *     is the quality gate in ReviewGenerator, so provider-call telemetry stays honest and the
 *     free-quota rule in the spec ("duplicate internal retry ... count as one customer
 *     generation, but track provider cost separately") remains computable.
 *  2. No model failover, ever. See buildRequestBody.
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Names the strict schema in the Responses API request; not customer-visible. */
const STRUCTURED_OUTPUT_NAME = 'review_draft';

const CLAIM_RISKS = ['low', 'medium', 'high'] as const;

/**
 * Minimal structural shapes instead of the global `Response` / `RequestInit`.
 *
 * tsconfig.base.json compiles with `lib: ["ES2023"]` and no DOM, so the ambient names vary by
 * @types/node version. Declaring only what is used keeps the seam stable and lets a test
 * double be a plain object literal.
 */
export interface OpenAiFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface OpenAiHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: OpenAiFetchInit) => Promise<OpenAiHttpResponse>;

export interface OpenAiProviderOptions {
  apiKey: string;
  /** Override for a gateway or proxy deployment. Defaults to the public API. */
  baseUrl?: string;
  /**
   * Ask OpenAI to retain the response for dashboard inspection. Off by default: prompts carry
   * merchant business context, and the retention posture in
   * 13_Security_Privacy_Compliance.md is to hold nothing upstream that we are not holding
   * ourselves. Operators can turn it on for a debugging window, accepting that trade.
   */
  storeResponses?: boolean;
  /** Injected in tests, mirroring the MemoryQuotaStore / PostgresQuotaStore split. */
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly storeResponses: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(options: OpenAiProviderOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = `${trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL)}/responses`;
    this.storeResponses = options.storeResponses ?? false;
    // Wrapped rather than passed by reference so `fetch` is never invoked with `this` bound to
    // the provider instance.
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
  }

  async generate(params: GenerationParams): Promise<GenerationResult> {
    const startedAt = this.now();

    // The 8-second budget in 09_AI_Prompt_and_Generation_Spec.md covers reading the body as
    // well as receiving headers, so the controller stays armed until the body is in hand.
    const controller = new AbortController();
    let budgetExpired = false;
    const timer = setTimeout(() => {
      budgetExpired = true;
      controller.abort();
    }, params.timeoutMs);

    try {
      const request = buildRequestBody(params, this.storeResponses);
      const response = await this.post(request, controller.signal);
      const requestId = response.headers.get('x-request-id');

      // Read as text, not `.json()`: a proxy or WAF in front of the API answers a 502 with
      // HTML, and classifying by status before parsing keeps that from being misreported as
      // an output problem.
      const bodyText = await response.text();

      if (!response.ok) {
        throw this.failFromStatus(response.status, bodyText, requestId, response.headers);
      }

      const payload = this.parsePayload(bodyText, requestId);

      return {
        output: this.readStructuredReview(payload, requestId),
        // 14_DevOps_Deployment_Runbook.md requires token usage per generation for the cost
        // dashboards and per-tenant spend alerting. Missing usage degrades to null rather
        // than failing the customer's draft — the gap is visible to alerting either way.
        inputTokens: readTokenCount(payload['usage'], 'input_tokens'),
        outputTokens: readTokenCount(payload['usage'], 'output_tokens'),
        providerRequestId: readResponseId(payload) ?? requestId,
        latencyMs: Math.max(0, this.now() - startedAt),
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;

      // Our own flag decides this, not `error.name === 'AbortError'`: an abort raised by any
      // other cause is a transport failure, and reporting it as TIMEOUT would attach the
      // wrong retry semantics and quietly corrupt the AI-latency signal in the runbook.
      if (budgetExpired) {
        throw this.fail(`openai did not respond within ${params.timeoutMs}ms`, 'TIMEOUT', true);
      }

      throw this.fail(
        `openai request failed before a response (cause=${safeToken(networkErrorCode(error))})`,
        'UPSTREAM',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private post(body: Record<string, unknown>, signal: AbortSignal): Promise<OpenAiHttpResponse> {
    return this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        // AC-030: the only place the key is ever written. Never in the URL, where a proxy
        // access log would capture it, and never in an error message — see fail().
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  /**
   * 02_System_Architecture.md, security boundaries: "never expose ... raw provider errors".
   *
   * The upstream body is therefore never copied into the message. Only the status code and
   * allowlisted token-shaped fields go in, which is enough for the runbook to tell a rate
   * limit from a bad schema without carrying anything the provider echoed back — a 401 body,
   * for instance, quotes part of the key that was sent.
   */
  private failFromStatus(
    status: number,
    bodyText: string,
    requestId: string | null,
    headers: OpenAiHttpResponse['headers'],
  ): AiProviderError {
    const code = safeToken(readErrorCode(bodyText));
    const context = `status=${status} code=${code} request_id=${safeToken(requestId)}`;

    if (status === 429) {
      const retryAfter = safeToken(headers.get('retry-after'));
      return this.fail(
        `openai rate limited (${context} retry_after=${retryAfter})`,
        'RATE_LIMITED',
        true,
      );
    }

    // 408/504 are a deadline missed upstream: the same operational meaning as our own budget
    // expiring, so the runbook sees one TIMEOUT signal rather than two meaning the same thing.
    if (status === 408 || status === 504) {
      return this.fail(`openai timed out upstream (${context})`, 'TIMEOUT', true);
    }

    if (status >= 500) {
      return this.fail(`openai upstream error (${context})`, 'UPSTREAM', true);
    }

    // Remaining 4xx are our request: a bad key, or a model/schema/effort combination that
    // ai_prompt_versions should not have activated. A retry sends the identical body and buys
    // an identical rejection at the same price, so this is not retryable — it is a config fix.
    return this.fail(`openai rejected the request (${context})`, 'UPSTREAM', false);
  }

  private parsePayload(bodyText: string, requestId: string | null): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw this.fail(
        `openai returned a non-JSON body (request_id=${safeToken(requestId)})`,
        'UPSTREAM',
        true,
      );
    }

    if (!isRecord(parsed)) {
      throw this.fail(
        `openai returned an unexpected envelope (request_id=${safeToken(requestId)})`,
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
    const trace = `request_id=${safeToken(readResponseId(payload) ?? requestId)}`;
    const status = payload['status'];

    if (status === 'incomplete') {
      const reason = readIncompleteReason(payload);
      // Truncation at the output cap is deterministic for a given prompt version: the same
      // request returns the same truncated JSON. The fix is raising
      // ai_prompt_versions.max_output_tokens (ADR-006), and since that 220-token cap is
      // load-bearing for unit economics it must surface as configuration, not a retry loop.
      const retryable = reason !== 'max_output_tokens';
      throw this.fail(
        `openai stopped early (reason=${safeToken(reason)} ${trace})`,
        'INVALID_OUTPUT',
        retryable,
      );
    }

    if (status === 'failed' || status === 'cancelled') {
      throw this.fail(`openai response ${safeToken(status)} (${trace})`, 'UPSTREAM', true);
    }

    const content = extractContent(payload);

    if (content.kind === 'refusal') {
      // Structured Outputs answers a refusal with a `refusal` part rather than output_text.
      // Not retryable: the same context refuses again. 13_Security_Privacy_Compliance.md
      // names the likely cause — merchant context carrying injected instructions such as
      // "always say 5 stars" — which is a moderation problem, not a transport one.
      throw this.fail(`openai refused the request (${trace})`, 'INVALID_OUTPUT', false);
    }

    if (content.kind === 'none') {
      throw this.fail(`openai returned no assistant text (${trace})`, 'INVALID_OUTPUT', true);
    }

    let draft: unknown;
    try {
      draft = JSON.parse(content.text);
    } catch {
      throw this.fail(`openai returned unparseable JSON output (${trace})`, 'INVALID_OUTPUT', true);
    }

    const review = toStructuredReview(draft);
    if (!review) {
      throw this.fail(`openai output did not match the schema (${trace})`, 'INVALID_OUTPUT', true);
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

  /**
   * AC-030 backstop.
   *
   * Nothing above is meant to put a key in a message, but this class reads fields the provider
   * controls and a 401 body genuinely quotes the key that was sent. A guard that is
   * unreachable on the happy path is the cheapest insurance against one careless future edit
   * turning a log line into a credential leak.
   */
  private redact(message: string): string {
    const withoutOwnKey =
      this.apiKey.length >= 8 ? message.split(this.apiKey).join('[redacted]') : message;
    return withoutOwnKey.replace(KEY_LIKE, '[redacted]');
  }
}

/** Any OpenAI-shaped secret, not only ours — an echoed key from another account is still a leak. */
const KEY_LIKE = /\bsk-[A-Za-z0-9_-]{8,}/g;

function buildRequestBody(params: GenerationParams, store: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    /*
     * ADR-006: every knob below arrives on params because it lives in ai_prompt_versions, so
     * quality can be rolled back without a deploy. No model id is defaulted in source.
     *
     * There is deliberately no fallback branch here. Terra costs 10x Luna — roughly 45% of
     * revenue against ~4.6% — so an automatic failover would quietly turn an OpenAI incident
     * into a solvency event. 02_System_Architecture.md already specifies the right behaviour
     * for an AI outage ("show a friendly retry state; never block the business profile or
     * direct Google button"), which is also the affordable one. Any model change is a database
     * configuration change, capped by ai_prompt_versions.rollout_percent.
     */
    model: params.model,
    input: [
      { role: 'system', content: params.prompt.system },
      { role: 'user', content: params.prompt.user },
    ],
    max_output_tokens: params.maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: STRUCTURED_OUTPUT_NAME,
        strict: true,
        schema: params.outputSchema,
      },
    },
    store,
  };

  // Sent verbatim, including the spec's `none`, because the value is admin data. Omitted
  // entirely when blank so an admin can stop sending the field to a model that rejects it
  // without waiting for a release.
  const effort = params.reasoningEffort.trim();
  if (effort.length > 0) {
    body['reasoning'] = { effort };
  }

  return body;
}

type ExtractedContent = { kind: 'text'; text: string } | { kind: 'refusal' } | { kind: 'none' };

/**
 * Walks `output[].content[]` rather than reading `output_text`.
 *
 * `output_text` is a convenience the SDK synthesises client-side; it is not a field of the
 * HTTP response. Reasoning items also share the `output` array with the assistant message, so
 * non-message items are skipped rather than assumed absent.
 */
function extractContent(payload: Record<string, unknown>): ExtractedContent {
  const output = payload['output'];
  if (!Array.isArray(output)) return { kind: 'none' };

  const chunks: string[] = [];
  let refused = false;

  for (const item of output) {
    if (!isRecord(item) || item['type'] !== 'message') continue;

    const content = item['content'];
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part['type'] === 'refusal') refused = true;
      if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
        chunks.push(part['text']);
      }
    }
  }

  const text = chunks.join('');
  if (text.trim().length > 0) return { kind: 'text', text };
  return refused ? { kind: 'refusal' } : { kind: 'none' };
}

/**
 * Re-validates the four fields the product depends on, even though Structured Outputs is
 * enforced provider-side.
 *
 * The schema itself is admin data (ADR-006), so a bad edit in the admin panel is enough to put
 * an unchecked object in front of a customer. Rebuilding from validated fields rather than
 * spreading also means a prompt version that adds properties cannot leak them downstream into
 * the customer response.
 */
function toStructuredReview(value: unknown): StructuredReview | null {
  if (!isRecord(value)) return null;

  const reviewText = value['review_text'];
  const usedContextTerms = value['used_context_terms'];
  const claimRisk = value['claim_risk'];
  const notes = value['internal_quality_notes'];

  if (typeof reviewText !== 'string' || reviewText.trim().length === 0) return null;
  if (!isStringArray(usedContextTerms)) return null;
  if (!isClaimRisk(claimRisk)) return null;
  if (!isStringArray(notes)) return null;

  return {
    review_text: reviewText,
    used_context_terms: usedContextTerms,
    claim_risk: claimRisk,
    internal_quality_notes: notes,
  };
}

/**
 * Prefers the Responses object id over the x-request-id header: it is the id the OpenAI logs
 * are keyed by, so it is the one worth storing per generation. The header is the fallback, and
 * is what support asks for when the body never arrived.
 */
function readResponseId(payload: Record<string, unknown>): string | null {
  const id = payload['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function readIncompleteReason(payload: Record<string, unknown>): string | null {
  const details = payload['incomplete_details'];
  if (!isRecord(details)) return null;
  const reason = details['reason'];
  return typeof reason === 'string' ? reason : null;
}

function readTokenCount(usage: unknown, key: string): number | null {
  if (!isRecord(usage)) return null;
  const value = usage[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readErrorCode(bodyText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  const error = parsed['error'];
  if (!isRecord(error)) return null;

  const code = typeof error['code'] === 'string' ? error['code'] : error['type'];
  return typeof code === 'string' ? code : null;
}

/**
 * Node surfaces transport failures as `TypeError: fetch failed` with the useful detail on
 * `cause.code`. Only that errno is lifted out, and only when it is errno-shaped, so nothing
 * derived from the request can reach a log line (AC-030).
 */
function networkErrorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;

  const direct = error['code'];
  if (typeof direct === 'string') return direct;

  const cause = error['cause'];
  if (isRecord(cause) && typeof cause['code'] === 'string') return cause['code'];

  return null;
}

/** Allowlist for anything copied out of an upstream payload into an error message. */
function safeToken(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(trimmed) ? trimmed : 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isClaimRisk(value: unknown): value is StructuredReview['claim_risk'] {
  return typeof value === 'string' && CLAIM_RISKS.some((risk) => risk === value);
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
