import { describe, expect, it, vi } from 'vitest';
import {
  GeminiProvider,
  redactGeminiSecrets,
  thinkingLevelFor,
  type GeminiFetchInit,
  type GeminiHttpResponse,
} from '../gemini-provider';
import { AiProviderError, type GenerationParams } from '../provider';

/**
 * The Gemini adapter, driven entirely through an injected fetch — no network, no key, no
 * quota. Pins the contract the generator relies on: one call per generate, the admin-owned
 * schema forwarded verbatim, the key only ever in a header, thinking mapped from the stored
 * effort, and every failure sorted into the class ReviewGenerator branches on.
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
  model: 'gemini-3.5-flash-lite',
  maxOutputTokens: 320,
  reasoningEffort: 'none',
  timeoutMs: 8000,
  outputSchema: SCHEMA,
};

const DRAFT = {
  review_text:
    'Pichhle hafte yahan gaya tha aur experience accha raha. Staff ne dhyan se baat suni. Dobara aana chahunga.',
  used_context_terms: ['filter coffee'],
  claim_risk: 'low',
  internal_quality_notes: [],
};

const KEY = 'AIzaSyA-test-key-0123456789abcdefghijk';

function completed(overrides: Record<string, unknown> = {}) {
  return {
    responseId: 'resp_01',
    candidates: [
      {
        content: { role: 'model', parts: [{ text: JSON.stringify(DRAFT) }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 512, candidatesTokenCount: 96, thoughtsTokenCount: 12 },
    ...overrides,
  };
}

function httpResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): GeminiHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** The rejection, typed — a resolved generate here is itself the failure. */
async function failureOf(promise: Promise<unknown>): Promise<AiProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiProviderError) return error;
    throw error;
  }
  throw new Error('expected the provider to reject');
}

function providerWith(response: GeminiHttpResponse | Error) {
  const fetchImpl = vi.fn((_url: string, _init: GeminiFetchInit) =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  return { provider: new GeminiProvider({ apiKey: KEY, fetchImpl }), fetchImpl };
}

describe('GeminiProvider request', () => {
  it('posts the prompt, cap and schema to generateContent with the key only in a header', async () => {
    const { provider, fetchImpl } = providerWith(httpResponse(200, completed()));

    await provider.generate(PARAMS);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(url).not.toContain(KEY);
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe(KEY);

    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: PARAMS.prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: PARAMS.prompt.user }] }],
      generationConfig: {
        maxOutputTokens: 320,
        responseMimeType: 'application/json',
        responseJsonSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    });
  });

  /**
   * Thinking tokens count against maxOutputTokens on Gemini, so the effort mapping is what
   * keeps a 320-token cap from truncating every draft. `none` is the spec's word for "spend
   * nothing on reasoning"; Gemini's floor for that is `minimal`.
   */
  it.each([
    ['none', 'minimal'],
    ['minimal', 'minimal'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['HIGH', 'high'],
    ['', null],
    ['   ', null],
    ['xhigh', null],
  ])('maps a stored effort of %j to thinkingLevel %j', (effort, level) => {
    expect(thinkingLevelFor(effort)).toBe(level);
  });

  it('sends no thinking config at all when the stored effort is blank', async () => {
    const { provider, fetchImpl } = providerWith(httpResponse(200, completed()));
    await provider.generate({ ...PARAMS, reasoningEffort: '' });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body) as {
      generationConfig: Record<string, unknown>;
    };
    expect(body.generationConfig).not.toHaveProperty('thinkingConfig');
  });

  it('honours a base URL override without doubling the slash', async () => {
    const fetchImpl = vi.fn((_url: string, _init: GeminiFetchInit) =>
      Promise.resolve(httpResponse(200, completed())),
    );
    await new GeminiProvider({
      apiKey: KEY,
      fetchImpl,
      baseUrl: 'https://proxy.test/v1beta/',
    }).generate(PARAMS);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://proxy.test/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
  });

  it('refuses a model id that is not a plain model name, before any request', async () => {
    const { provider, fetchImpl } = providerWith(httpResponse(200, completed()));
    await expect(
      provider.generate({ ...PARAMS, model: 'gemini-3.5-flash-lite:generateContent?key=x' }),
    ).rejects.toMatchObject({ errorClass: 'UPSTREAM', retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GeminiProvider success parsing', () => {
  it('returns the structured review, billed token counts and the response id', async () => {
    const { provider } = providerWith(httpResponse(200, completed()));
    const result = await provider.generate(PARAMS);

    expect(result.output).toEqual(DRAFT);
    expect(result.inputTokens).toBe(512);
    // Thinking tokens are billed as output, so they are output here too.
    expect(result.outputTokens).toBe(108);
    expect(result.providerRequestId).toBe('resp_01');
  });

  it('falls back to the x-request-id header when the body carries no id', async () => {
    const { provider } = providerWith(
      httpResponse(200, completed({ responseId: undefined }), { 'x-request-id': 'hdr_7' }),
    );
    expect((await provider.generate(PARAMS)).providerRequestId).toBe('hdr_7');
  });

  it('records null tokens rather than failing when usage is absent', async () => {
    const { provider } = providerWith(httpResponse(200, completed({ usageMetadata: undefined })));
    const result = await provider.generate(PARAMS);
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it('ignores thought-summary parts and joins the remaining text parts', async () => {
    const json = JSON.stringify(DRAFT);
    const { provider } = providerWith(
      httpResponse(
        200,
        completed({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'thinking about it', thought: true },
                  { text: json.slice(0, 30) },
                  { text: json.slice(30) },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
      ),
    );
    expect((await provider.generate(PARAMS)).output.review_text).toBe(DRAFT.review_text);
  });

  it('drops fields the schema never promised', async () => {
    const { provider } = providerWith(
      httpResponse(
        200,
        completed({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify({ ...DRAFT, secret: 'leak' }) }] },
              finishReason: 'STOP',
            },
          ],
        }),
      ),
    );
    expect((await provider.generate(PARAMS)).output).not.toHaveProperty('secret');
  });
});

describe('GeminiProvider output rejection', () => {
  const candidate = (parts: unknown[], finishReason = 'STOP') =>
    completed({ candidates: [{ content: { parts }, finishReason }] });

  it.each([
    ['unparseable JSON', candidate([{ text: 'not json' }]), true],
    ['a missing required field', candidate([{ text: JSON.stringify({ review_text: 'x' }) }]), true],
    [
      'an empty review_text',
      candidate([{ text: JSON.stringify({ ...DRAFT, review_text: '' }) }]),
      true,
    ],
    ['no text part at all', candidate([{ thought: true, text: 'only thoughts' }]), true],
    ['no candidate at all', completed({ candidates: [] }), true],
    ['truncation at the cap', candidate([{ text: '{"review_' }], 'MAX_TOKENS'), false],
    ['a safety stop', candidate([], 'SAFETY'), false],
    ['a recitation stop', candidate([], 'RECITATION'), true],
    [
      'a blocked prompt',
      completed({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } }),
      false,
    ],
  ])('classifies %s as INVALID_OUTPUT (retryable: %s)', async (_name, body, retryable) => {
    const { provider } = providerWith(httpResponse(200, body));
    await expect(provider.generate(PARAMS)).rejects.toMatchObject({
      errorClass: 'INVALID_OUTPUT',
      retryable,
    });
  });
});

describe('GeminiProvider transport and status failures', () => {
  it('aborts at the timeout budget and reports TIMEOUT', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: GeminiFetchInit) =>
        new Promise<GeminiHttpResponse>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const provider = new GeminiProvider({ apiKey: KEY, fetchImpl });
    await expect(provider.generate({ ...PARAMS, timeoutMs: 20 })).rejects.toMatchObject({
      errorClass: 'TIMEOUT',
      retryable: true,
    });
  });

  it('maps 429 RESOURCE_EXHAUSTED to RATE_LIMITED and keeps the retry-after hint', async () => {
    const { provider } = providerWith(
      httpResponse(
        429,
        { error: { code: 429, message: 'quota', status: 'RESOURCE_EXHAUSTED' } },
        { 'retry-after': '30' },
      ),
    );
    const error = await failureOf(provider.generate(PARAMS));
    expect(error).toMatchObject({ errorClass: 'RATE_LIMITED', retryable: true });
    expect(error.message).toContain('code=RESOURCE_EXHAUSTED');
    expect(error.message).toContain('retry_after=30');
  });

  it('maps 503 UNAVAILABLE (model overloaded) to a retryable UPSTREAM failure', async () => {
    const { provider } = providerWith(
      httpResponse(503, { error: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' } }),
    );
    await expect(provider.generate(PARAMS)).rejects.toMatchObject({
      errorClass: 'UPSTREAM',
      retryable: true,
    });
  });

  it('maps 504 to TIMEOUT', async () => {
    const { provider } = providerWith(httpResponse(504, 'gateway timeout'));
    await expect(provider.generate(PARAMS)).rejects.toMatchObject({ errorClass: 'TIMEOUT' });
  });

  /**
   * The cases that matter operationally: a bad key (403), an unknown model (404), a thinking
   * level the model does not take (400). Retrying pays for the same rejection.
   */
  it.each([
    [400, 'INVALID_ARGUMENT'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
  ])('maps %s %s to a non-retryable configuration failure', async (status, code) => {
    const { provider } = providerWith(
      httpResponse(status, { error: { code: status, message: 'nope', status: code } }),
    );
    const error = await failureOf(provider.generate(PARAMS));
    expect(error).toMatchObject({ errorClass: 'UPSTREAM', retryable: false });
    expect(error.message).toContain(`status=${status} code=${code}`);
  });

  it('classifies an HTML error page from a proxy by status, not by parse failure', async () => {
    const { provider } = providerWith(httpResponse(502, '<html>Bad Gateway</html>'));
    await expect(provider.generate(PARAMS)).rejects.toMatchObject({
      errorClass: 'UPSTREAM',
      retryable: true,
    });
  });

  it('classifies a 200 with a non-JSON body as an upstream problem, not bad model output', async () => {
    const { provider } = providerWith(httpResponse(200, '<html>login</html>'));
    await expect(provider.generate(PARAMS)).rejects.toMatchObject({ errorClass: 'UPSTREAM' });
  });

  it('reports the errno of a connection failure without any request detail', async () => {
    const failure = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    const { provider } = providerWith(failure);
    const error = await failureOf(provider.generate(PARAMS));
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error.message).toContain('cause=ECONNRESET');
  });
});

describe('GeminiProvider secrecy guardrails (AC-030)', () => {
  it('never puts the API key into an error, even when upstream echoes it', async () => {
    const { provider } = providerWith(
      httpResponse(403, {
        error: { code: 403, message: `API key not valid: ${KEY}`, status: 'PERMISSION_DENIED' },
      }),
    );
    const error = await failureOf(provider.generate(PARAMS));
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain('API key not valid');
  });

  it('redacts any Google-shaped key, not only its own', () => {
    expect(redactGeminiSecrets('leaked AIzaSyB-someone-elses-key-1234567890 here')).toBe(
      'leaked [redacted] here',
    );
    expect(redactGeminiSecrets('status=403 code=PERMISSION_DENIED')).toBe(
      'status=403 code=PERMISSION_DENIED',
    );
    // The shape AI Studio issues now.
    expect(
      redactGeminiSecrets('key AQ.Ab8RN6I42ar2xHOdsySzBcVOQpECuggjG3wQy8P-Oq1VK5sKBQ here'),
    ).toBe('key [redacted] here');
  });
});
