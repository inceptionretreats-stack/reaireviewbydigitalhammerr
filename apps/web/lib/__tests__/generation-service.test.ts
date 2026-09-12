import { describe, expect, it } from 'vitest';
import { selectProvider } from '../generation-service';

/**
 * Provider selection — the one branch that decides whether this product has an AI in it.
 *
 * There was no test here, and the function returned the stub down *both* paths: `OpenAiProvider`
 * was written, exported and covered by thirty of its own tests, and no caller could ever reach
 * it. Every gate in the repo passed. A production deployment would have served four canned
 * sentences to real customers, in a product whose entire premise is that the words are the
 * customer's own.
 *
 * That is the failure mode this file exists to prevent, so it asserts the mapping itself rather
 * than anything about how a provider behaves once chosen.
 */
describe('selectProvider', () => {
  it('uses Anthropic when its key is configured', () => {
    expect(selectProvider({ anthropic: 'sk-ant-configured' }).name).toBe('anthropic');
  });

  it('uses OpenAI when only its key is configured', () => {
    expect(selectProvider({ openai: 'sk-configured' }).name).toBe('openai');
  });

  /**
   * Stated precedence, not an accident of ordering. A deployment holding two keys has one it
   * means to use; unsetting the other is how you switch, and that is a configuration change
   * rather than a code change.
   */
  it('prefers Anthropic when both keys are present', () => {
    expect(selectProvider({ anthropic: 'sk-ant-a', openai: 'sk-b' }).name).toBe('anthropic');
  });

  it('uses Gemini when only its key is configured', () => {
    expect(selectProvider({ gemini: 'AIzaSy-configured-key' }).name).toBe('gemini');
  });

  /**
   * Gemini is the free tier. An owner who adds a paid key later has upgraded, and the paid key
   * must win without them remembering to remove the free one.
   */
  it('lets either paid key beat the free Gemini key', () => {
    expect(selectProvider({ gemini: 'AIza-free', openai: 'sk-paid' }).name).toBe('openai');
    expect(selectProvider({ gemini: 'AIza-free', anthropic: 'sk-ant-paid' }).name).toBe(
      'anthropic',
    );
  });

  it('falls back to the stub only when no key is set', () => {
    expect(selectProvider({}).name).toBe('stub');
    expect(
      selectProvider({ anthropic: undefined, openai: undefined, gemini: undefined }).name,
    ).toBe('stub');
  });

  /**
   * An empty string is what an .env writes for a variable that is present but unset, and
   * packages/config already normalises it to undefined. Asserted here too because this function
   * is the last thing standing between that value and a live customer.
   */
  it('treats an empty key as absent rather than as a credential', () => {
    expect(selectProvider({ anthropic: '', openai: '', gemini: '' }).name).toBe('stub');
  });
});
