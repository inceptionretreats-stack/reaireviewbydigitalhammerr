import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODE_NAME,
  EMPTY_PREVIEW_MESSAGE,
  SUMMARY_ANNOUNCE_AT,
  SUMMARY_COUNTER_FROM,
  SUMMARY_MAX,
  contextSignature,
  defaultModeCopy,
  previewFromPayload,
  previewIsStale,
  readFailure,
  sendJson,
  summaryAnnouncement,
  summaryCounterText,
  toStringArray,
  type PreviewState,
} from '../ai-context';

/**
 * ONB-04's decisions, none of which were covered before.
 *
 * The failure mode this file guards against is not a crash: it is the step showing an owner
 * something untrue — an empty quotation presented as a customer draft, a preview that silently
 * looks current after an edit, a promise about a mode the save will not create, or a rejection
 * message replaced by "something went wrong".
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readFailure', () => {
  /** The envelope 23_API_Error_Codes.md specifies, as apiError actually emits it. */
  it('unpacks a real error envelope including details.fields', () => {
    expect(
      readFailure({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Please check the details you entered.',
          request_id: 'e2f5c4e0-0000-4000-8000-000000000000',
          details: { fields: ['summary', 'context_terms'] },
        },
      }),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Please check the details you entered.',
      fields: ['summary', 'context_terms'],
    });
  });

  it('keeps a 429 message verbatim so "wait and retry" is not remapped away', () => {
    const failure = readFailure({
      error: {
        code: 'FAIR_USE_THROTTLED',
        message:
          'You have generated several previews just now. Please wait a moment and try again.',
      },
    });

    expect(failure.code).toBe('FAIR_USE_THROTTLED');
    expect(failure.message).toContain('wait a moment');
    expect(failure.fields).toEqual([]);
  });

  it('falls back on a malformed body rather than throwing', () => {
    const fallback = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };

    // A proxy's HTML 502 page, read as {} by readJsonBody.
    expect(readFailure({})).toEqual({ ...fallback, fields: [] });
    // `error` present but not an object — the shape a hand-rolled endpoint gets wrong.
    expect(readFailure({ error: 'nope' })).toEqual({ ...fallback, fields: [] });
    expect(readFailure({ error: null })).toEqual({ ...fallback, fields: [] });
    // Right shape, wrong types.
    expect(readFailure({ error: { code: 7, message: false } })).toEqual({
      ...fallback,
      fields: [],
    });
  });

  it('treats a missing or non-array details.fields as no field attribution', () => {
    expect(readFailure({ error: { code: 'X', message: 'm' } }).fields).toEqual([]);
    expect(readFailure({ error: { code: 'X', message: 'm', details: {} } }).fields).toEqual([]);
    expect(
      readFailure({ error: { code: 'X', message: 'm', details: { fields: 'summary' } } }).fields,
    ).toEqual([]);
  });

  /** A non-string entry must not reach `fields.includes(name)` as an object. */
  it('drops non-string entries from details.fields', () => {
    expect(
      readFailure({
        error: { code: 'X', message: 'm', details: { fields: ['summary', 3, null, 'services'] } },
      }).fields,
    ).toEqual(['summary', 'services']);
  });
});

describe('previewFromPayload', () => {
  const SIGNATURE = contextSignature('A salon.', ['Haircut'], ['Family friendly']);

  it('reports a draft with the compliance flag the endpoint sent', () => {
    expect(
      previewFromPayload({ review_text: 'Lovely haircut.', compliance_passed: true }, SIGNATURE),
    ).toEqual({
      status: 'ready',
      draft: 'Lovely haircut.',
      compliancePassed: true,
      signature: SIGNATURE,
    });
  });

  /** AC-011/AC-012: a draft a customer would never be shown is not a fair sample. */
  it('carries compliance_passed: false through rather than hiding it', () => {
    const state = previewFromPayload(
      { review_text: 'Draft.', compliance_passed: false },
      SIGNATURE,
    );
    expect(state.status === 'ready' && state.compliancePassed).toBe(false);
  });

  it('treats an absent compliance flag as passed, so a shape change raises no false alarm', () => {
    const state = previewFromPayload({ review_text: 'Draft.' }, SIGNATURE);
    expect(state.status === 'ready' && state.compliancePassed).toBe(true);
  });

  /**
   * The empty-draft transition. An empty blockquote under "Example draft" reads as "this is what
   * your customers get", which is the one thing this screen must never imply.
   */
  it('turns an empty, blank or non-string draft into the error state', () => {
    for (const payload of [
      {},
      { review_text: '' },
      { review_text: '   \n  ' },
      { review_text: 42 },
      { review_text: null },
    ]) {
      expect(previewFromPayload(payload, SIGNATURE)).toEqual({
        status: 'error',
        message: EMPTY_PREVIEW_MESSAGE,
      });
    }
  });

  it('does not trim the draft it shows', () => {
    const state = previewFromPayload({ review_text: ' Two lines.\n\nSecond. ' }, SIGNATURE);
    expect(state.status === 'ready' && state.draft).toBe(' Two lines.\n\nSecond. ');
  });
});

describe('contextSignature and previewIsStale', () => {
  it('ignores surrounding whitespace in the summary, as the save does', () => {
    expect(contextSignature('  A salon.  ', [], [])).toBe(contextSignature('A salon.', [], []));
  });

  it('distinguishes term order, term splits and term content', () => {
    expect(contextSignature('', ['a', 'b'], [])).not.toBe(contextSignature('', ['b', 'a'], []));
    expect(contextSignature('', ['ab'], [])).not.toBe(contextSignature('', ['a', 'b'], []));
    // Services and context terms are separate fields and must not be interchangeable.
    expect(contextSignature('', ['a'], [])).not.toBe(contextSignature('', [], ['a']));
  });

  it('marks a ready preview stale once the context it was written from changes', () => {
    const before = contextSignature('A salon.', ['Haircut'], []);
    const preview = previewFromPayload({ review_text: 'Draft.' }, before);

    expect(previewIsStale(preview, before)).toBe(false);
    expect(previewIsStale(preview, contextSignature('A salon.', ['Haircut', 'Beard'], []))).toBe(
      true,
    );
  });

  it('never claims staleness for a state that is not showing a draft', () => {
    const signature = contextSignature('x', [], []);
    const states: PreviewState[] = [
      { status: 'idle' },
      { status: 'loading' },
      { status: 'error', message: EMPTY_PREVIEW_MESSAGE },
    ];

    for (const state of states) {
      expect(previewIsStale(state, signature)).toBe(false);
    }
  });
});

describe('summary counter and its announcement', () => {
  it('shows nothing until the limit is near, then the exact count', () => {
    expect(summaryCounterText(SUMMARY_COUNTER_FROM + 1)).toBe('');
    expect(summaryCounterText(SUMMARY_COUNTER_FROM)).toBe(
      `${SUMMARY_COUNTER_FROM} characters left of ${SUMMARY_MAX}.`,
    );
    expect(summaryCounterText(7)).toBe(`7 characters left of ${SUMMARY_MAX}.`);
  });

  /** A stored value longer than the current cap must not render "-3 characters left". */
  it('never shows a negative count', () => {
    expect(summaryCounterText(-3)).toBe(`0 characters left of ${SUMMARY_MAX}.`);
  });

  /**
   * The point of the milestone bucket: the announced text must be *stable* across keystrokes, or a
   * polite live region queues one utterance per character typed.
   */
  it('announces once per bucket rather than once per character', () => {
    const announced = new Set<string>();
    for (let remaining = 200; remaining >= 0; remaining -= 1) {
      announced.add(summaryAnnouncement(remaining));
    }

    // '' above the first threshold, one string per threshold, plus the "full" message.
    expect(announced.size).toBe(SUMMARY_ANNOUNCE_AT.length + 2);
  });

  it('stays silent far from the limit and is exact at the boundaries', () => {
    expect(summaryAnnouncement(SUMMARY_MAX)).toBe('');
    expect(summaryAnnouncement(101)).toBe('');
    expect(summaryAnnouncement(100)).toBe(`100 characters or fewer left of ${SUMMARY_MAX}.`);
    expect(summaryAnnouncement(51)).toBe(`100 characters or fewer left of ${SUMMARY_MAX}.`);
    expect(summaryAnnouncement(50)).toBe(`50 characters or fewer left of ${SUMMARY_MAX}.`);
    expect(summaryAnnouncement(20)).toBe(`20 characters or fewer left of ${SUMMARY_MAX}.`);
    expect(summaryAnnouncement(1)).toBe(`20 characters or fewer left of ${SUMMARY_MAX}.`);
    expect(summaryAnnouncement(0)).toBe(`Business summary is full at ${SUMMARY_MAX} characters.`);
  });

  /** Every announcement must be true of the remainder it describes. */
  it('never announces a threshold the remainder exceeds', () => {
    for (const threshold of SUMMARY_ANNOUNCE_AT) {
      expect(summaryAnnouncement(threshold + 1)).not.toContain(`${threshold} characters or fewer`);
    }
  });
});

describe('defaultModeCopy', () => {
  it('reports the active mode by name and promises nothing', () => {
    expect(defaultModeCopy({ activeModeName: 'Warm', hasAnyMode: true })).toEqual({
      title: 'Warm',
      note: null,
    });
  });

  /** The one case PUT /ai/context actually creates Balanced in: no review_modes rows at all. */
  it('promises Balanced only when the tenant has no modes whatsoever', () => {
    expect(defaultModeCopy({ activeModeName: null, hasAnyMode: false })).toEqual({
      title: DEFAULT_MODE_NAME,
      note: 'Set up for you when you save this step.',
    });
  });

  /**
   * The bug this function exists for: modes exist but none is active, so the save will NOT create
   * Balanced (route.ts checks `existingModes.length === 0`, not "no active mode"). The card must
   * not promise it, and must not name Balanced as the default either.
   */
  it('makes no promise when modes exist but none is switched on', () => {
    const copy = defaultModeCopy({ activeModeName: null, hasAnyMode: true });

    expect(copy.title).not.toBe(DEFAULT_MODE_NAME);
    expect(copy.note).not.toBeNull();
    expect(copy.note).not.toContain('when you save');
    expect(copy.note).toContain('AI settings');
  });

  /** D-009/AC-006 and AI-02: a mode shifts emphasis, never sentiment, and never asks for a rating. */
  it('never implies a rating, a sentiment gate or a guarantee', () => {
    const strings = [
      { activeModeName: 'Warm', hasAnyMode: true },
      { activeModeName: null, hasAnyMode: false },
      { activeModeName: null, hasAnyMode: true },
    ].flatMap((state) => {
      const copy = defaultModeCopy(state);
      return [copy.title, copy.note ?? ''];
    });

    for (const value of strings) {
      expect(value.toLowerCase()).not.toMatch(/star|rating|positive|guarantee|always include/);
    }
  });
});

describe('toStringArray', () => {
  it('returns an empty list for anything that is not an array', () => {
    for (const value of [undefined, null, 'Haircut', 42, {}, { 0: 'Haircut' }]) {
      expect(toStringArray(value)).toEqual([]);
    }
  });

  it('keeps only the string members of a mixed jsonb value', () => {
    expect(toStringArray(['Haircut', 7, null, { name: 'Shave' }, ['Beard'], 'Colour'])).toEqual([
      'Haircut',
      'Colour',
    ]);
  });

  it('passes a well-formed value through unchanged', () => {
    expect(toStringArray(['Haircut', 'Colour'])).toEqual(['Haircut', 'Colour']);
  });
});

describe('sendJson', () => {
  function stubFetch(handler: (input: string, init: RequestInit) => Response | Promise<Response>) {
    const spy = vi.fn(handler);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('sends the body as JSON and returns the parsed payload', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ saved: true }), { status: 200 }));

    const result = await sendJson('/api/v1/ai/context', 'PUT', { services: ['Haircut'] });

    expect(result).toEqual({ ok: true, payload: { saved: true } });
    const [endpoint, init] = spy.mock.calls[0] ?? [];
    expect(endpoint).toBe('/api/v1/ai/context');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ services: ['Haircut'] }));
  });

  it('reports a network failure as such rather than as a rejected entry', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const result = await sendJson('/api/v1/ai/test-preview', 'POST', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('NETWORK');
      expect(result.failure.message).toContain('Check your connection');
    }
  });

  it('unpacks a failure envelope into the field-attributed failure', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'VALIDATION_FAILED', message: 'Too long.', details: { fields: ['x'] } },
          }),
          { status: 422 },
        ),
    );

    const result = await sendJson('/api/v1/ai/context', 'PUT', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual({
        code: 'VALIDATION_FAILED',
        message: 'Too long.',
        fields: ['x'],
      });
    }
  });

  it('survives an error response whose body is not JSON', async () => {
    stubFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    const result = await sendJson('/api/v1/ai/test-preview', 'POST', {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('INTERNAL_ERROR');
  });

  it('treats a 204 as a successful empty payload', async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    expect(await sendJson('/api/v1/ai/context', 'PUT', {})).toEqual({ ok: true, payload: {} });
  });

  /** A 200 whose body is a bare array or string must not be handed on as a payload object. */
  it('normalises a non-object success body to an empty payload', async () => {
    stubFetch(() => new Response(JSON.stringify(['unexpected']), { status: 200 }));

    const result = await sendJson('/api/v1/ai/test-preview', 'POST', {});
    expect(result).toEqual({ ok: true, payload: {} });
  });
});
