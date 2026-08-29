import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../env';

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'https://review.digitalhammerr.com',
  API_BASE_URL: 'https://review.digitalhammerr.com/api/v1',
  SESSION_SECRET: 'a'.repeat(32),
  APP_ENCRYPTION_KEY: 'b'.repeat(32),
  HASH_PEPPER: 'c'.repeat(32),
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/ai_review',
  REDIS_URL: 'redis://localhost:6379',
  OPENAI_API_KEY: 'd'.repeat(32),
  OPENAI_DEFAULT_MODEL: 'gpt-5.6-luna',
  S3_BUCKET: 'ai-review-assets',
  EMAIL_FROM: 'no-reply@digitalhammerr.com',
};

describe('loadEnv', () => {
  it('accepts a complete configuration and applies documented defaults', () => {
    const env = loadEnv(valid);

    expect(env.SESSION_COOKIE_NAME).toBe('dh_session');
    expect(env.FREE_AI_GENERATION_LIMIT).toBe(10);
    expect(env.PRO_ANNUAL_PRICE_PAISE).toBe(99900);
    expect(env.DEFAULT_TIMEZONE).toBe('Asia/Kolkata');
    expect(env.AI_MAX_OUTPUT_TOKENS).toBe(220);
  });

  it('coerces numeric strings from the environment', () => {
    const env = loadEnv({ ...valid, DATABASE_POOL_MAX: '30' });
    expect(env.DATABASE_POOL_MAX).toBe(30);
  });

  /**
   * The delivered 15_Environment_Variables.example ships CHANGE_ME placeholders. Booting
   * production with one still in place would mean a predictable session secret, so it is
   * rejected outright rather than warned about.
   */
  it('rejects unreplaced CHANGE_ME placeholders', () => {
    expect(() => loadEnv({ ...valid, SESSION_SECRET: 'CHANGE_ME' })).toThrow(EnvValidationError);
  });

  it('reports every problem at once rather than one per restart', () => {
    try {
      loadEnv({ ...valid, DATABASE_URL: 'mysql://x', REDIS_URL: 'http://x', EMAIL_FROM: 'nope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toHaveLength(3);
    }
  });

  it('does not require Razorpay or Cloudflare credentials before E10/E11', () => {
    expect(() => loadEnv(valid)).not.toThrow();
  });
});
