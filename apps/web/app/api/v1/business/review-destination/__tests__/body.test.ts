import { describe, expect, it } from 'vitest';
import { REVIEW_URL_MAX, readReviewDestinationBody } from '../body';

describe('readReviewDestinationBody', () => {
  it.each([null, undefined, 'https://g.page/r/demo/review', 7, [], { url: 7 }])(
    'rejects a malformed body: %j',
    (raw) => {
      expect(readReviewDestinationBody(raw)).toEqual({
        ok: false,
        message: 'Paste the full Google review link.',
        fields: ['url'],
      });
    },
  );

  it('caps the URL before the Google-specific validator receives it', () => {
    const result = readReviewDestinationBody({ url: `https://google.com/${'x'.repeat(2048)}` });
    expect(result).toEqual({
      ok: false,
      message: `Keep the Google review link to ${REVIEW_URL_MAX} characters or fewer.`,
      fields: ['url'],
    });
  });

  it('preserves the exact string for authoritative normalization in core', () => {
    const url = '  https://g.page/r/demo/review?utm_source=test  ';
    expect(readReviewDestinationBody({ url })).toEqual({ ok: true, url });
  });
});
