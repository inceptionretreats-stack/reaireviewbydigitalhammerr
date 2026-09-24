import { describe, expect, it } from 'vitest';
import { readJsonObject, stripUnstorable } from '../request-body';

function post(body: string): Request {
  return new Request('http://localhost/api/v1/public/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

/**
 * Two unauthenticated one-liners used to answer HTTP 500 with a zero-length body — no error
 * envelope, no request_id, nothing traceable — on the two public endpoints.
 */
describe('readJsonObject', () => {
  it('refuses a body of literal null instead of letting the handler dereference it', async () => {
    const result = await readJsonObject(post('null'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(422);
    expect(await result.response.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it.each([
    ['an array', '[]'],
    ['a string', '"x"'],
    ['a number', '7'],
    ['a boolean', 'true'],
    ['nothing at all', ''],
    ['unparseable text', 'not json'],
  ])('refuses %s with the same 422', async (_label, body) => {
    const result = await readJsonObject(post(body));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(422);
  });

  it('accepts an object and hands back its fields', async () => {
    const result = await readJsonObject(post('{"slug":"demo","n":3,"nested":{"a":[1,2]}}'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual({ slug: 'demo', n: 3, nested: { a: [1, 2] } });
  });

  it('strips an escaped NUL that PostgreSQL would reject mid-INSERT', async () => {
    const result = await readJsonObject(post(JSON.stringify({ message: 'hi\u0000there' })));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.message).toBe('hithere');
  });

  it('strips NUL from nested values and from keys', async () => {
    const result = await readJsonObject(
      post(JSON.stringify({ outer: { 'ke\u0000y': ['a\u0000b', 'c'] } })),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual({ outer: { key: ['ab', 'c'] } });
  });
});

describe('stripUnstorable', () => {
  it('leaves ordinary text untouched', () => {
    expect(stripUnstorable('A normal review, with punctuation!')).toBe(
      'A normal review, with punctuation!',
    );
  });

  it('keeps emoji and Devanagari intact (AMENDMENT-026)', () => {
    // Emoji are surrogate PAIRS: stripping surrogates indiscriminately would eat them.
    const text = 'Great filter coffee ☕😋 — बहुत बढ़िया 🙌';
    expect(stripUnstorable(text)).toBe(text);
  });

  it('removes an unpaired surrogate, which has no valid UTF-8 encoding', () => {
    expect(stripUnstorable('before\uD800after')).toBe('beforeafter');
    expect(stripUnstorable('before\uDC00after')).toBe('beforeafter');
  });

  it('keeps other control characters, which PostgreSQL stores happily', () => {
    expect(stripUnstorable('line one\nline two\ttabbed')).toBe('line one\nline two\ttabbed');
  });
});
