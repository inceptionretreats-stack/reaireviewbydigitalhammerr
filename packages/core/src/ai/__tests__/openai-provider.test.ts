import { describe, expect, it } from 'vitest';
import { AiProviderError, type GenerationParams } from '../provider';
import {
  OpenAiProvider,
  type FetchLike,
  type OpenAiFetchInit,
  type OpenAiHttpResponse,
} from '../openai-provider';

/**
 * The whole file runs against an injected fetch: no network, no key, no spend. The scenarios
 * are the ones the runbook has to distinguish (timeout / 429 / 5xx / bad output) plus AC-030,
 * which is the one failure here that is a security incident rather than an outage.
 */

const API_KEY = 'sk-live-TEST-0123456789abcdef';

const PARAMS: GenerationParams = {
  prompt: { system: 'You are an AI review-writing assistant.', user: 'BUSINESS={"name":"X"}' },
  model: 'gpt-5.6-luna',
  maxOutputTokens: 220,
  reasoningEffort: 'none',
  timeoutMs: 8000,
  outputSchema: { type: 'object', additionalProperties: false, required: ['review_text'] },
};

const DRAFT = {
  review_text:
    'Dropped by this week without an appointment. Everything moved along at a comfortable pace and I left satisfied with how the visit went.',
  used_context_terms: ['filter coffee'],
  claim_risk: 'low',
  internal_quality_notes: [],
};

interface Call {
  url: string;
  init: OpenAiFetchInit;
}

interface Harness {
  provider: OpenAiProvider;
  calls: Call[];
}

function harness(
  handler: (call: Call) => OpenAiHttpResponse | Promise<OpenAiHttpResponse>,
  options: { now?: () => number; storeResponses?: boolean } = {},
): Harness {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(handler({ url, init }));
  };

  return {
    calls,
    provider: new OpenAiProvider({ apiKey: API_KEY, fetchImpl, ...options }),
  };
}

function httpResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): OpenAiHttpResponse {
  const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    text: () => Promise.resolve(body),
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): OpenAiHttpResponse {
  return httpResponse(status, JSON.stringify(body), headers);
}

/** A completed Responses payload. The reasoning item is real: the extractor must skip it. */
function completed(outputText: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id: 'resp_abc123',
    status: 'completed',
    model: 'gpt-5.6-luna',
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: outputText }],
      },
    ],
    usage: { input_tokens: 512, output_tokens: 118, total_tokens: 630 },
    ...extra,
  };
}

function okDraft(overrides: Record<string, unknown> = {}): OpenAiHttpResponse {
  return jsonResponse(200, completed(JSON.stringify({ ...DRAFT, ...overrides })), {
    'x-request-id': 'req_header_1',
  });
}

async function failureOf(promise: Promise<unknown>): Promise<AiProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiProviderError) return error;
    throw error;
  }
  throw new Error('expected generate() to reject with an AiProviderError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sentBody(calls: Call[]): Record<string, unknown> {
  const [call] = calls;
  if (!call) throw new Error('expected exactly one HTTP call');
  const parsed: unknown = JSON.parse(call.init.body);
  if (!isRecord(parsed)) throw new Error('expected a JSON object body');
  return parsed;
}

describe('OpenAiProvider request', () => {
  it('sends the model, cap, effort and schema that arrived on params (ADR-006)', async () => {
    const { provider, calls } = harness(() => okDraft());

    await provider.generate({
      ...PARAMS,
      model: 'model-from-ai-prompt-versions',
      maxOutputTokens: 180,
    });

    const body = sentBody(calls);
    expect(body).toMatchObject({
      // A model id that appears nowhere in source still reaches the wire unchanged, which is
      // the whole point of ADR-006 — and proves no default is being substituted here.
      model: 'model-from-ai-prompt-versions',
      max_output_tokens: 180,
      reasoning: { effort: 'none' },
      text: { format: { type: 'json_schema', name: 'review_draft', strict: true } },
      store: false,
    });
    expect(body['input']).toEqual([
      { role: 'system', content: PARAMS.prompt.system },
      { role: 'user', content: PARAMS.prompt.user },
    ]);
    expect(body).toMatchObject({ text: { format: { schema: PARAMS.outputSchema } } });
  });

  it('posts to the Responses endpoint with the key only in the Authorization header', async () => {
    const { provider, calls } = harness(() => okDraft());

    await provider.generate(PARAMS);

    const [call] = calls;
    if (!call) throw new Error('expected one HTTP call');
    expect(call.url).toBe('https://api.openai.com/v1/responses');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['Authorization']).toBe(`Bearer ${API_KEY}`);
    // AC-030: a key in the URL lands in every proxy access log on the way out.
    expect(call.url).not.toContain(API_KEY);
    expect(call.init.body).not.toContain(API_KEY);
  });

  it('omits reasoning entirely when the stored effort is blank', async () => {
    const { provider, calls } = harness(() => okDraft());

    await provider.generate({ ...PARAMS, reasoningEffort: '  ' });

    expect(sentBody(calls)).not.toHaveProperty('reasoning');
  });

  it('honours a base URL override without doubling the slash', async () => {
    const calls: Call[] = [];
    const provider = new OpenAiProvider({
      apiKey: API_KEY,
      baseUrl: 'https://gateway.internal/openai/v1/',
      fetchImpl: (url, init) => {
        calls.push({ url, init });
        return Promise.resolve(okDraft());
      },
    });

    await provider.generate(PARAMS);

    expect(calls[0]?.url).toBe('https://gateway.internal/openai/v1/responses');
  });
});

describe('OpenAiProvider success parsing', () => {
  it('returns the structured review, token counts and the provider request id', async () => {
    const clock = [1_000, 1_350];
    const { provider } = harness(() => okDraft(), { now: () => clock.shift() ?? 1_350 });

    const result = await provider.generate(PARAMS);

    expect(result.output).toEqual(DRAFT);
    // 14_DevOps_Deployment_Runbook.md: per-generation token telemetry feeds AI spend alerting.
    expect(result.inputTokens).toBe(512);
    expect(result.outputTokens).toBe(118);
    expect(result.providerRequestId).toBe('resp_abc123');
    expect(result.latencyMs).toBe(350);
  });

  it('falls back to the x-request-id header when the body carries no id', async () => {
    const payload = completed(JSON.stringify(DRAFT));
    if (!isRecord(payload)) throw new Error('bad fixture');
    delete payload['id'];

    const { provider } = harness(() => jsonResponse(200, payload, { 'x-request-id': 'req_9' }));

    const result = await provider.generate(PARAMS);

    expect(result.providerRequestId).toBe('req_9');
  });

  it('records null tokens rather than failing when usage is absent', async () => {
    const payload = completed(JSON.stringify(DRAFT));
    if (!isRecord(payload)) throw new Error('bad fixture');
    delete payload['usage'];

    const { provider } = harness(() => jsonResponse(200, payload));

    const result = await provider.generate(PARAMS);

    // A telemetry gap must not cost the customer a draft; the null is what alerting sees.
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(result.output.review_text).toBe(DRAFT.review_text);
  });

  it('drops fields the strict schema never promised', async () => {
    const { provider } = harness(() =>
      jsonResponse(
        200,
        completed(JSON.stringify({ ...DRAFT, star_rating: 5, internal_debug: 'leak me' })),
      ),
    );

    const result = await provider.generate(PARAMS);

    // D-009/AC-006: no rating may reach the customer surface, and the output object is
    // rebuilt from validated fields precisely so an edited prompt schema cannot smuggle one.
    expect(result.output).toEqual(DRAFT);
    expect(Object.keys(result.output)).toEqual([
      'review_text',
      'used_context_terms',
      'claim_risk',
      'internal_quality_notes',
    ]);
  });
});

describe('OpenAiProvider output rejection', () => {
  it('classifies unparseable JSON as INVALID_OUTPUT and allows a retry', async () => {
    const { provider } = harness(() => jsonResponse(200, completed('{"review_text": "truncat')));

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('INVALID_OUTPUT');
    expect(error.retryable).toBe(true);
  });

  it('rejects output whose claim_risk is outside the enum', async () => {
    const { provider } = harness(() => okDraft({ claim_risk: 'excellent' }));

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('INVALID_OUTPUT');
  });

  it('rejects output with a missing required array', async () => {
    const { provider } = harness(() =>
      jsonResponse(
        200,
        completed(JSON.stringify({ review_text: DRAFT.review_text, claim_risk: 'low' })),
      ),
    );

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('INVALID_OUTPUT');
  });

  it('rejects an empty review_text', async () => {
    const { provider } = harness(() => okDraft({ review_text: '   ' }));

    expect((await failureOf(provider.generate(PARAMS))).errorClass).toBe('INVALID_OUTPUT');
  });

  it('treats truncation at max_output_tokens as a config problem, not a retry', async () => {
    const { provider } = harness(() =>
      jsonResponse(200, {
        id: 'resp_trunc',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
        usage: { input_tokens: 500, output_tokens: 220 },
      }),
    );

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('INVALID_OUTPUT');
    // Retrying spends a second paid call for the identical truncated JSON.
    expect(error.retryable).toBe(false);
  });

  it('treats a refusal content part as a non-retryable invalid output', async () => {
    const { provider } = harness(() =>
      jsonResponse(200, {
        id: 'resp_refusal',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
          },
        ],
      }),
    );

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('INVALID_OUTPUT');
    expect(error.retryable).toBe(false);
  });

  it('surfaces a failed response status as an upstream problem', async () => {
    const { provider } = harness(() =>
      jsonResponse(200, { id: 'resp_x', status: 'failed', error: { code: 'server_error' } }),
    );

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('UPSTREAM');
    expect(error.retryable).toBe(true);
  });
});

describe('OpenAiProvider transport failures', () => {
  it('aborts at the timeout budget and reports TIMEOUT', async () => {
    const calls: Call[] = [];
    const provider = new OpenAiProvider({
      apiKey: API_KEY,
      fetchImpl: (url, init) => {
        calls.push({ url, init });
        return new Promise<OpenAiHttpResponse>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const aborted = new Error('The operation was aborted');
            aborted.name = 'AbortError';
            reject(aborted);
          });
        });
      },
    });

    const error = await failureOf(provider.generate({ ...PARAMS, timeoutMs: 20 }));

    expect(error.errorClass).toBe('TIMEOUT');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('20ms');
    expect(calls).toHaveLength(1);
  });

  it('does not report a non-timeout abort as a TIMEOUT', async () => {
    const { provider } = harness(() => {
      const aborted = new Error('aborted by the caller');
      aborted.name = 'AbortError';
      return Promise.reject(aborted);
    });

    const error = await failureOf(provider.generate(PARAMS));

    // The budget never expired, so the latency signal must not be polluted with a fake timeout.
    expect(error.errorClass).toBe('UPSTREAM');
  });

  it('maps 429 to RATE_LIMITED and keeps the retry-after hint', async () => {
    const { provider } = harness(() =>
      jsonResponse(429, { error: { code: 'rate_limit_exceeded' } }, { 'retry-after': '20' }),
    );

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('RATE_LIMITED');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('retry_after=20');
  });

  it('maps 500 to a retryable UPSTREAM failure', async () => {
    const { provider } = harness(() => jsonResponse(500, { error: { code: 'server_error' } }));

    const error = await failureOf(provider.generate(PARAMS));

    expect(error).toMatchObject({ errorClass: 'UPSTREAM', retryable: true });
  });

  it('maps 504 to TIMEOUT so the runbook sees one deadline signal', async () => {
    const { provider } = harness(() => httpResponse(504, 'gateway timeout'));

    expect((await failureOf(provider.generate(PARAMS))).errorClass).toBe('TIMEOUT');
  });

  it('maps a 400 to a non-retryable UPSTREAM failure', async () => {
    const { provider } = harness(() =>
      jsonResponse(400, { error: { code: 'invalid_request_error' } }),
    );

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('UPSTREAM');
    // An identical retry buys an identical rejection; ai_prompt_versions is the fix.
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('code=invalid_request_error');
  });

  it('classifies an HTML error page from a proxy by status, not by parse failure', async () => {
    const { provider } = harness(() => httpResponse(502, '<html><body>Bad gateway</body></html>'));

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('UPSTREAM');
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain('html');
  });

  it('classifies a 200 with a non-JSON body as an upstream problem, not bad model output', async () => {
    const { provider } = harness(() => httpResponse(200, 'not json at all'));

    expect((await failureOf(provider.generate(PARAMS))).errorClass).toBe('UPSTREAM');
  });

  it('reports the errno of a connection failure without any request detail', async () => {
    const { provider } = harness(() => {
      return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
    });

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.errorClass).toBe('UPSTREAM');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('ECONNREFUSED');
  });
});

describe('OpenAiProvider cost and secrecy guardrails', () => {
  /**
   * The commercial invariant. Terra is 10x Luna (~45% of revenue against ~4.6%), so a retry or
   * a failover hidden in this class would be an unbudgeted multiplier on every incident.
   */
  it('makes exactly one call per generate and never substitutes a model', async () => {
    const { provider, calls } = harness(() => jsonResponse(500, { error: { code: 'oops' } }));

    await failureOf(provider.generate(PARAMS));

    expect(calls).toHaveLength(1);
    expect(sentBody(calls)['model']).toBe('gpt-5.6-luna');
  });

  /**
   * AC-030. OpenAI's own 401 body quotes the key that was sent, so echoing an upstream body
   * into an error message is a credential leak with a plausible-looking excuse.
   */
  it('never puts the API key or the upstream body into a 401 error', async () => {
    const { provider } = harness(() =>
      jsonResponse(401, {
        error: {
          code: 'invalid_api_key',
          message: `Incorrect API key provided: ${API_KEY}. You can find your API key at https://platform.openai.com/account/api-keys.`,
        },
      }),
    );

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain('Incorrect API key provided');
    expect(error.message).not.toContain('platform.openai.com');
    expect(error.errorClass).toBe('UPSTREAM');
    expect(error.retryable).toBe(false);
  });

  it('redacts the key even when upstream echoes it in an allowlisted field', async () => {
    const { provider } = harness(() => jsonResponse(403, { error: { code: API_KEY } }));

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.message).not.toContain(API_KEY);
    expect(error.message).toContain('[redacted]');
  });

  it('redacts an OpenAI-shaped secret belonging to someone else', async () => {
    const { provider } = harness(() =>
      jsonResponse(403, { error: { code: 'sk-proj-OTHERTENANTKEY9999' } }),
    );

    const error = await failureOf(provider.generate(PARAMS));

    expect(error.message).not.toContain('OTHERTENANTKEY');
    expect(error.message).toContain('[redacted]');
  });

  it('keeps the key out of every failure mode', async () => {
    const scenarios: Array<() => OpenAiHttpResponse> = [
      () => jsonResponse(429, { error: { code: API_KEY } }, { 'retry-after': API_KEY }),
      () => jsonResponse(500, { error: { type: API_KEY } }),
      () => httpResponse(200, API_KEY),
      () => jsonResponse(200, completed(API_KEY)),
      () => jsonResponse(200, { id: API_KEY, status: 'failed' }),
      () =>
        jsonResponse(200, {
          id: API_KEY,
          status: 'incomplete',
          incomplete_details: { reason: API_KEY },
        }),
    ];

    for (const scenario of scenarios) {
      const { provider } = harness(scenario);
      const error = await failureOf(provider.generate(PARAMS));
      expect(error.message).not.toContain(API_KEY);
    }
  });
});
