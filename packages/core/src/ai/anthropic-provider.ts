import Anthropic from '@anthropic-ai/sdk';
import {
  AiProviderError,
  type AiProvider,
  type GenerationParams,
  type GenerationResult,
} from './provider';
import { parseStructuredReview } from './structured-review';

/**
 * Anthropic adapter for the Messages API (E4-04, ADR-006, ADR-007).
 *
 * Built on the official SDK, where the sibling OpenAI adapter uses raw `fetch`. That asymmetry
 * is deliberate rather than drift, and the two objections that adapter records do not survive
 * contact with this SDK:
 *
 *  - Automatic retries would put a second billed call inside a budget already partly spent.
 *    Answered by `maxRetries: 0` — the single permitted retry belongs to ReviewGenerator's
 *    quality gate, so provider-call telemetry stays honest and "one customer generation, two
 *    provider calls" remains computable.
 *  - Typed unions cannot type a model string that arrives from a database row. Not true here:
 *    `Model` ends in `(string & {})`, so an admin-set id passes with no cast, and
 *    `JSONOutputFormat.schema` is `Record<string, unknown>` — exactly the shape
 *    `ai_prompt_versions.output_schema` already holds.
 *
 * What the SDK buys in return is the part most likely to rot: the request and response shapes of
 * an API that has changed repeatedly. Hand-writing those from memory is how an adapter ends up
 * correct on the day it is written and quietly wrong a release later.
 *
 * Two invariants, the same ones the OpenAI adapter holds:
 *
 *  1. Exactly one API call per `generate()`. No internal retry.
 *  2. No model failover, ever. A silent switch to a costlier model turns a quality incident into
 *     a billing one; 02_System_Architecture.md specifies degrading to a retry state instead.
 */

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Override for a gateway or proxy deployment. */
  baseUrl?: string;
  /**
   * Injected in tests, mirroring the MemoryQuotaStore / PostgresQuotaStore split. Structural
   * rather than the SDK class, so a test double is a plain object literal and no test needs a
   * network stub or a real key.
   */
  client?: AnthropicMessagesClient;
  now?: () => number;
}

/** The one method this adapter uses, so a test can supply it without an SDK client. */
export interface AnthropicMessagesClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): Promise<Anthropic.Message>;
  };
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  private readonly client: AnthropicMessagesClient;
  private readonly now: () => number;

  constructor(options: AnthropicProviderOptions) {
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        // Invariant 1. The SDK retries twice by default; each retry is a billed call inside a
        // deadline that has already partly elapsed, so it would raise the dominant variable cost
        // of the business while making the 8-second budget *more* likely to be missed.
        maxRetries: 0,
      });
    this.now = options.now ?? (() => Date.now());
  }

  async generate(params: GenerationParams): Promise<GenerationResult> {
    const startedAt = this.now();

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: params.model,
          max_tokens: params.maxOutputTokens,
          system: params.prompt.system,
          messages: [{ role: 'user', content: params.prompt.user }],
          // Structured outputs — the direct analogue of the OpenAI adapter's `text.format`. The
          // schema is admin data read from ai_prompt_versions, never hard-coded here.
          output_config: { format: { type: 'json_schema', schema: params.outputSchema } },
          //
          // `params.reasoningEffort` is deliberately not forwarded. Anthropic has no equivalent
          // field, and leaving `thinking` unset is what keeps a 220-token cap spendable on the
          // draft itself: with thinking enabled, reasoning tokens count against max_tokens and a
          // 45-85 word review would be truncated before it finished. The OpenAI adapter has the
          // mirror-image trap, which is why that field exists at all.
        },
        { timeout: params.timeoutMs },
      );
    } catch (error) {
      throw toProviderError(error);
    }

    const latencyMs = this.now() - startedAt;

    // Checked before the content is read: on a refusal or a truncation the blocks can still
    // parse, and handing back half a draft as though it were whole is worse than failing.
    if (message.stop_reason === 'refusal') {
      throw new AiProviderError('provider declined the request', 'INVALID_OUTPUT', false);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new AiProviderError(
        'output truncated by max_tokens; raise the prompt version cap',
        'INVALID_OUTPUT',
        false,
      );
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (text.trim().length === 0) {
      throw new AiProviderError('provider returned no assistant text', 'INVALID_OUTPUT', true);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiProviderError('provider output was not valid JSON', 'INVALID_OUTPUT', true);
    }

    const output = parseStructuredReview(parsed);
    if (!output) {
      throw new AiProviderError('provider output did not match the schema', 'INVALID_OUTPUT', true);
    }

    return {
      output,
      inputTokens: message.usage?.input_tokens ?? null,
      outputTokens: message.usage?.output_tokens ?? null,
      providerRequestId: message.id ?? null,
      latencyMs,
    };
  }
}

/**
 * Maps an SDK error onto the adapter taxonomy, class for class with the OpenAI adapter, so
 * ReviewGenerator behaves identically whichever provider is configured.
 *
 * `retryable` describes the error, not this adapter's behaviour — nothing here retries.
 */
function toProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;

  if (error instanceof Anthropic.APIUserAbortError) {
    return new AiProviderError('generation budget expired', 'TIMEOUT', true);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError('provider request timed out', 'TIMEOUT', true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError('could not reach the provider', 'UPSTREAM', true);
  }

  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;

    if (status === 429) return new AiProviderError('provider rate limited', 'RATE_LIMITED', true);
    if (status === 408) return new AiProviderError('provider request timed out', 'TIMEOUT', true);
    if (status >= 500) return new AiProviderError(`provider error ${status}`, 'UPSTREAM', true);

    // Any other 4xx is a request this deployment will keep getting wrong until someone changes
    // configuration — a bad key, or a model id that does not exist. Retrying spends money to
    // fail identically, so it is non-retryable and surfaces as a 503 an operator can act on.
    // The upstream body is never copied into the message: AC-030 keeps provider internals out
    // of anything a customer could reach.
    return new AiProviderError(`provider rejected the request (${status})`, 'UPSTREAM', false);
  }

  return new AiProviderError('provider call failed', 'UPSTREAM', true);
}

/**
 * Removes anything key-shaped from a string before it is logged.
 *
 * AC-030 forbids provider internals reaching a client, and a credential is the worst of them.
 * Exported so anything logging around this adapter uses the same sweep rather than inventing a
 * second one that misses a prefix.
 */
export function redactAnthropicSecrets(value: string): string {
  return value.replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-***');
}
