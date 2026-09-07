import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  AnthropicProvider,
  redactAnthropicSecrets,
  type AnthropicMessagesClient,
} from '../anthropic-provider';
import { AiProviderError, type GenerationParams } from '../provider';

/**
 * The Anthropic adapter, driven entirely through an injected client.
 *
 * No network, no key, no spend — the same discipline as the OpenAI adapter's suite. What is
 * worth pinning here is not that the SDK works but that this adapter's *contract* holds: one
 * call per generate, the admin-owned schema forwarded verbatim, `reasoningEffort` never sent,
 * and every failure mapped to the class ReviewGenerator branches on.
 */

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['review_text', 'used_context_terms', 'claim_risk', 'internal_quality_notes'],
  properties: {
    review_text: { type: 'string' },
    used_context_terms: { type: 'array', items: { type: 'string' } },
    claim_risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    internal_quality_notes: { type: 'array', items: { type: 'string' } },
  },
};

const PARAMS: GenerationParams = {
  prompt: { system: 'You are an AI review-writing assistant.', user: 'BUSINESS={"name":"Cafe"}' },
  model: 'claude-haiku-4-5',
  maxOutputTokens: 220,
  reasoningEffort: 'none',
  timeoutMs: 8000,
  outputSchema: SCHEMA,
};

const DRAFT = {
  review_text:
    'Dropped in on a weekday and was seen quickly. Straightforward from start to finish.',
  used_context_terms: ['filter coffee'],
  claim_risk: 'low',
  internal_quality_notes: [],
};

function messageWith(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_01ABC',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(DRAFT), citations: null }],
    usage: { input_tokens: 512, output_tokens: 96 },
    ...overrides,
  } as Anthropic.Message;
}

function clientReturning(message: Anthropic.Message) {
  const create = vi.fn().mockResolvedValue(message);
  return { client: { messages: { create } } as AnthropicMessagesClient, create };
}

function clientThrowing(error: unknown) {
  const create = vi.fn().mockRejectedValue(error);
  return { client: { messages: { create } } as AnthropicMessagesClient, create };
}

describe('AnthropicProvider', () => {
  it('sends the admin-owned model, cap and schema, and exactly one call', async () => {
    const { client, create } = clientReturning(messageWith());
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', client });

    await provider.generate(PARAMS);

    expect(create).toHaveBeenCalledTimes(1);
    const [body, options] = create.mock.calls[0]!;
    expect(body).toMatchObject({
      model: 'claude-haiku-4-5',
      max_tokens: 220,
      system: PARAMS.prompt.system,
      messages: [{ role: 'user', content: PARAMS.prompt.user }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    expect(options).toEqual({ timeout: 8000 });
  });

  /**
   * Anthropic has no reasoning-effort field, and sending `thinking` would spend the 220-token
   * cap on reasoning instead of the draft — the review would be truncated before it finished.
   * The value still arrives in params because the OpenAI adapter needs it.
   */
  it('never forwards reasoning effort or a thinking config', async () => {
    const { client, create } = clientReturning(messageWith());
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', client });

    await provider.generate({ ...PARAMS, reasoningEffort: 'high' });

    // Asserting the exact key set, not the absence of the string "high" — the schema's own
    // claim_risk enum contains that word, so a substring check passes or fails for the wrong
    // reason. What matters is that no effort or thinking field is sent at all.
    const [body] = create.mock.calls[0]!;
    expect(Object.keys(body as object).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'output_config',
      'system',
    ]);
  });

  it('returns the structured draft with usage and the message id', async () => {
    const { client } = clientReturning(messageWith());
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      client,
      now: (() => {
        let t = 1000;
        return () => (t += 250);
      })(),
    });

    const result = await provider.generate(PARAMS);

    expect(result.output).toEqual(DRAFT);
    expect(result.inputTokens).toBe(512);
    expect(result.outputTokens).toBe(96);
    expect(result.providerRequestId).toBe('msg_01ABC');
    expect(result.latencyMs).toBe(250);
  });

  it('joins multiple text blocks before parsing', async () => {
    const json = JSON.stringify(DRAFT);
    const split = messageWith({
      content: [
        { type: 'text', text: json.slice(0, 20), citations: null },
        { type: 'text', text: json.slice(20), citations: null },
      ] as Anthropic.Message['content'],
    });
    const { client } = clientReturning(split);

    const result = await new AnthropicProvider({ apiKey: 'k', client }).generate(PARAMS);
    expect(result.output.review_text).toBe(DRAFT.review_text);
  });

  /**
   * Rebuilt field by field rather than spread, so a mis-edited admin schema cannot leak an extra
   * property through to a customer.
   */
  it('drops properties the schema does not define', async () => {
    const leaky = messageWith({
      content: [
        { type: 'text', text: JSON.stringify({ ...DRAFT, secret: 'leak' }), citations: null },
      ] as Anthropic.Message['content'],
    });
    const { client } = clientReturning(leaky);

    const result = await new AnthropicProvider({ apiKey: 'k', client }).generate(PARAMS);
    expect(result.output).not.toHaveProperty('secret');
  });

  describe('rejects output that cannot be trusted', () => {
    const cases: Array<[string, Anthropic.Message, boolean]> = [
      ['a refusal', messageWith({ stop_reason: 'refusal' }), false],
      ['a truncated response', messageWith({ stop_reason: 'max_tokens' }), false],
      ['no assistant text', messageWith({ content: [] as Anthropic.Message['content'] }), true],
      [
        'unparseable JSON',
        messageWith({
          content: [
            { type: 'text', text: 'not json', citations: null },
          ] as Anthropic.Message['content'],
        }),
        true,
      ],
      [
        'JSON that misses a required field',
        messageWith({
          content: [
            { type: 'text', text: JSON.stringify({ review_text: 'x' }), citations: null },
          ] as Anthropic.Message['content'],
        }),
        true,
      ],
    ];

    for (const [name, message, retryable] of cases) {
      it(`classifies ${name} as INVALID_OUTPUT (retryable: ${retryable})`, async () => {
        const { client } = clientReturning(message);
        const provider = new AnthropicProvider({ apiKey: 'k', client });

        await expect(provider.generate(PARAMS)).rejects.toMatchObject({
          errorClass: 'INVALID_OUTPUT',
          retryable,
        });
      });
    }
  });

  describe('maps transport and status failures', () => {
    it('treats 429 as retryable rate limiting', async () => {
      const { client } = clientThrowing(
        new Anthropic.APIError(429, undefined, 'slow down', undefined),
      );
      await expect(
        new AnthropicProvider({ apiKey: 'k', client }).generate(PARAMS),
      ).rejects.toMatchObject({ errorClass: 'RATE_LIMITED', retryable: true });
    });

    it('treats 5xx as retryable upstream', async () => {
      const { client } = clientThrowing(new Anthropic.APIError(503, undefined, 'down', undefined));
      await expect(
        new AnthropicProvider({ apiKey: 'k', client }).generate(PARAMS),
      ).rejects.toMatchObject({ errorClass: 'UPSTREAM', retryable: true });
    });

    /**
     * The case that matters operationally: a bad key or a model id that does not exist. Retrying
     * spends money to fail identically, so it must not be retryable.
     */
    it('treats other 4xx as a non-retryable configuration error', async () => {
      const { client } = clientThrowing(
        new Anthropic.APIError(404, undefined, 'model_not_found', undefined),
      );
      await expect(
        new AnthropicProvider({ apiKey: 'k', client }).generate(PARAMS),
      ).rejects.toMatchObject({ errorClass: 'UPSTREAM', retryable: false });
    });

    it('treats a timeout as retryable TIMEOUT', async () => {
      const { client } = clientThrowing(new Anthropic.APIConnectionTimeoutError({}));
      await expect(
        new AnthropicProvider({ apiKey: 'k', client }).generate(PARAMS),
      ).rejects.toMatchObject({ errorClass: 'TIMEOUT', retryable: true });
    });

    it('treats a connection failure as retryable UPSTREAM', async () => {
      const { client } = clientThrowing(
        new Anthropic.APIConnectionError({ message: 'econnreset' }),
      );
      await expect(
        new AnthropicProvider({ apiKey: 'k', client }).generate(PARAMS),
      ).rejects.toMatchObject({ errorClass: 'UPSTREAM', retryable: true });
    });

    it('maps an unrecognised throw rather than letting it escape', async () => {
      const { client } = clientThrowing(new Error('something else'));
      const error = await new AnthropicProvider({ apiKey: 'k', client })
        .generate(PARAMS)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiProviderError);
    });
  });

  /** AC-030: nothing key-shaped may reach a log line, let alone a client. */
  describe('redactAnthropicSecrets', () => {
    it('masks a key anywhere in a string', () => {
      expect(redactAnthropicSecrets('failed with sk-ant-api03-AbCdEf123456 while calling')).toBe(
        'failed with sk-ant-*** while calling',
      );
    });

    it('leaves text without a key untouched', () => {
      expect(redactAnthropicSecrets('provider error 503')).toBe('provider error 503');
    });
  });
});
