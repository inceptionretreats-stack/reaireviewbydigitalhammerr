import { z } from 'zod';

/**
 * Configuration contract, mirroring 15_Environment_Variables.example.
 *
 * Validated once at process start so a missing or malformed secret fails the boot rather than
 * surfacing as a runtime error on a customer request. Values that 19_Admin_Panel_Spec.md puts
 * under admin control (free quota, annual price) appear here only as bootstrap defaults —
 * platform_settings in the database is the source of truth once seeded.
 */

const nonEmpty = z.string().min(1);
const secret = z
  .string()
  .min(16, 'secrets must be at least 16 characters')
  .refine((v) => !v.startsWith('CHANGE_ME'), 'placeholder secret must be replaced');

/**
 * A secret that may legitimately be absent.
 *
 * An .env file spells "not set" as `KEY=`, which arrives as an empty string rather than as a
 * missing variable, so `.optional()` on its own would still put it through the length check and
 * reject it. Treating empty as absent is what makes the blank OPENAI_API_KEY in .env.example mean
 * what it plainly looks like.
 */
const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  secret.optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // App
    APP_BASE_URL: z.url(),
    API_BASE_URL: z.url(),
    SESSION_COOKIE_NAME: nonEmpty.default('dh_session'),
    SESSION_SECRET: secret,
    APP_ENCRYPTION_KEY: secret.min(32, 'encryption key must be at least 32 bytes'),
    HASH_PEPPER: secret,

    // Database
    DATABASE_URL: z.string().startsWith('postgres'),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(20),
    // Managed Postgres mandates TLS; local docker has no certificate. Defaults are resolved
    // per-host in createDatabase, so this only needs setting to override that.
    DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).optional(),
    DATABASE_SSL_ROOT_CERT: z.string().optional(),

    // Redis
    REDIS_URL: z.string().startsWith('redis'),
    /**
     * Multiplies every rate-limit allowance. Defaults to 1, so production behaviour is exactly the
     * calibrated policy in packages/core/src/rate-limit/policies.ts.
     *
     * It exists because an automated end-to-end run is indistinguishable from a bot loop by design:
     * the suite drives the real generation flow dozens of times from one address, trips the
     * IP-prefix rule, and every later assertion then fails on a throttle message rather than on its
     * own subject. Raising the ceiling for a test environment is honest; disabling the limiter
     * would remove the very thing AC-032 asks us to prove.
     *
     * 19_Admin_Panel_Spec.md already lists generation rate limits as platform configuration, so
     * these becoming settings rather than constants is the intended direction.
     */
    RATE_LIMIT_MULTIPLIER: z.coerce.number().positive().max(1000).default(1),

    // AI. The model is a bootstrap default only: ADR-006 puts the live model and prompt in
    // ai_prompt_versions so quality can be rolled back without an application deploy.
    /**
     * Optional so local development and CI run against the deterministic stub provider without
     * holding a paid credential — the condition selectProvider branches on. Production is not
     * given that latitude: the check below turns a missing key into a boot failure there, because
     * the alternative is a real customer being handed a canned stub draft that reads like a
     * genuine review and was written by nothing.
     */
    OPENAI_API_KEY: optionalSecret,
    OPENAI_DEFAULT_MODEL: nonEmpty,
    OPENAI_FALLBACK_MODEL: nonEmpty.optional(),
    OPENAI_REASONING_EFFORT: nonEmpty.default('none'),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(220),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

    // Razorpay — not required until E10, so optional at boot.
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    RAZORPAY_ANNUAL_PLAN_ID: z.string().optional(),

    // Cloudflare — not required until E11.
    CLOUDFLARE_API_TOKEN: z.string().optional(),
    CLOUDFLARE_ZONE_ID: z.string().optional(),
    CLOUDFLARE_SAAS_FALLBACK_ORIGIN: z.string().optional(),

    // Object storage
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: nonEmpty.default('ap-south-1'),
    S3_BUCKET: nonEmpty,
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PUBLIC_BASE_URL: z.url().optional(),

    // Email
    EMAIL_FROM: z.email(),
    SES_REGION: nonEmpty.default('ap-south-1'),

    // Observability
    SENTRY_DSN: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // Bootstrap defaults; platform_settings takes over once seeded (ADMIN-04).
    FREE_AI_GENERATION_LIMIT: z.coerce.number().int().positive().default(10),
    PRO_ANNUAL_PRICE_PAISE: z.coerce.number().int().positive().default(99900),
    DEFAULT_TIMEZONE: nonEmpty.default('Asia/Kolkata'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message:
          'required in production — without it the stub provider would serve canned drafts to real customers',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses and validates process environment. Throws with every problem listed at once, rather
 * than one per restart.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }

  return result.data;
}
