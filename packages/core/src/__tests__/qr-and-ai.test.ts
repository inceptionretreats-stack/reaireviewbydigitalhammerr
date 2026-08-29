import { describe, expect, it } from 'vitest';
import { buildQrUrl, generateQrCode, isValidQrCodeFormat, normalizeQrCode } from '../qr/code';
import {
  checkVariation,
  normalizeForComparison,
  similarity,
  maxSimilarity,
} from '../ai/similarity';

describe('qr codes', () => {
  it('generates codes of the requested length from the safe alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateQrCode();
      expect(code).toHaveLength(10);
      expect(isValidQrCodeFormat(code)).toBe(true);
    }
  });

  /** These end up printed on standees and read aloud over the phone. */
  it('never emits a confusable character', () => {
    const codes = Array.from({ length: 300 }, () => generateQrCode()).join('');
    expect(codes).not.toMatch(/[01OIL]/);
  });

  it('produces distinct codes', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateQrCode()));
    expect(codes.size).toBe(1000);
  });

  it('rejects malformed codes', () => {
    expect(isValidQrCodeFormat('abc')).toBe(false);
    expect(isValidQrCodeFormat('ABCD0EFGHI')).toBe(false);
    expect(isValidQrCodeFormat('')).toBe(false);
  });

  it('uppercases hand-typed input', () => {
    expect(normalizeQrCode('  abcdefghjk ')).toBe('ABCDEFGHJK');
  });

  /** ADR-002: the printed URL resolves through Digital Hammerr, never straight to Google. */
  it('builds a platform-owned resolve URL', () => {
    expect(buildQrUrl('https://review.digitalhammerr.com', 'ABC234DEFG')).toBe(
      'https://review.digitalhammerr.com/r/ABC234DEFG',
    );
  });
});

describe('regeneration variation gate', () => {
  const draft =
    'Had a really pleasant visit to this place. The team was welcoming and the whole experience felt easy.';

  it('normalizes case, punctuation and whitespace before comparing', () => {
    expect(normalizeForComparison('Hello,   WORLD!!')).toBe('hello world');
  });

  it('scores an identical draft as 1', () => {
    expect(similarity(draft, draft)).toBe(1);
  });

  it('treats punctuation-only differences as identical', () => {
    expect(similarity('Great visit, really.', 'great visit really')).toBe(1);
  });

  it('scores unrelated text near 0', () => {
    expect(similarity(draft, 'The quick brown fox jumps over the lazy dog.')).toBeLessThan(0.2);
  });

  /**
   * AC-009: a regeneration must differ materially and "not simply synonym-swap". Swapping a
   * couple of words leaves the sentence structure intact, so the gate should still catch it.
   */
  it('catches a synonym swap as too similar', () => {
    const swapped =
      'Had a really nice visit to this place. The team was friendly and the whole experience felt easy.';
    expect(checkVariation(swapped, [draft]).passed).toBe(false);
  });

  it('passes a genuinely restructured draft', () => {
    const rewritten =
      'Dropped in on a weekday morning. Service moved along without fuss and I left happy with how it went.';
    expect(checkVariation(rewritten, [draft]).passed).toBe(true);
  });

  it('compares against every previous draft, not just the newest', () => {
    const others = ['Completely different text about something else entirely.', draft];
    expect(maxSimilarity(draft, others)).toBe(1);
    expect(checkVariation(draft, others).passed).toBe(false);
  });

  it('reports the score and threshold for storage on the generation row', () => {
    const result = checkVariation('anything', [draft]);
    expect(result.threshold).toBe(0.45);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('treats a first generation with no history as passing', () => {
    expect(checkVariation(draft, []).passed).toBe(true);
  });

  /**
   * Pins the calibration the threshold was chosen from (AMENDMENT-014). If the metric changes,
   * these bands move and CI fails, forcing a deliberate re-calibration rather than a silent
   * drift in how strict regeneration is.
   */
  it.each([
    ['identical', draft, 0.95, 1.0],
    [
      'clauses reordered',
      'The team was welcoming and the whole experience felt easy. Had a really pleasant visit to this place.',
      0.9,
      1.0,
    ],
    [
      'one word swapped',
      'Had a really pleasant visit to this place. The team was friendly and the whole experience felt easy.',
      0.75,
      0.9,
    ],
    [
      'two words swapped',
      'Had a really nice visit to this place. The team was friendly and the whole experience felt easy.',
      0.6,
      0.8,
    ],
    [
      'genuine rewrite',
      'Dropped in on a weekday morning. Service moved along without fuss and I left happy with how it went.',
      0.0,
      0.2,
    ],
  ])('scores %s within its calibrated band', (_label, text, low, high) => {
    const score = similarity(draft, text);
    expect(score).toBeGreaterThanOrEqual(low);
    expect(score).toBeLessThanOrEqual(high);
  });
});
