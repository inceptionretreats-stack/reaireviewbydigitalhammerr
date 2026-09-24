import { describe, expect, it } from 'vitest';
import { generateReviewRequest, generateReviewResponse } from '../public';

describe('public review service selection contracts', () => {
  it('retains selected services rather than stripping them from typed clients', () => {
    expect(
      generateReviewRequest.parse({
        qr_code: 'PUBLICCODE',
        selected_services: ['SEO', 'Website development'],
      }),
    ).toMatchObject({ selected_services: ['SEO', 'Website development'] });
  });

  it('allows omission for businesses without services; the route checks business membership', () => {
    expect(generateReviewRequest.safeParse({ slug: 'test-business' }).success).toBe(true);
    expect(
      generateReviewRequest.safeParse({ slug: 'test-business', selected_services: [] }).success,
    ).toBe(true);
  });

  it.each([
    { selected_services: 'SEO' },
    { selected_services: [''] },
    { selected_services: ['x'.repeat(81)] },
    { selected_services: Array(31).fill('SEO') },
  ])('rejects malformed service payloads (%j)', (value) => {
    expect(generateReviewRequest.safeParse({ qr_code: 'PUBLICCODE', ...value }).success).toBe(
      false,
    );
  });

  it('keeps canonical services in the response without weakening the confirmation gate', () => {
    const payload = {
      generation_id: 'c2a1c0c7-3979-4ad2-a32f-9fcb630c1704',
      review_text: 'An editable customer review.',
      prompt_version: '1.1.0',
      selected_services: ['SEO'],
      requires_experience_confirmation: true,
    };
    expect(generateReviewResponse.parse(payload).selected_services).toEqual(['SEO']);
    expect(
      generateReviewResponse.safeParse({ ...payload, requires_experience_confirmation: false })
        .success,
    ).toBe(false);
  });
});
