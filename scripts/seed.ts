import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  aiBusinessContexts,
  aiPromptVersions,
  businessLinks,
  businessSlugs,
  businesses,
  createDatabase,
  customerRequestStatus,
  customers,
  linkType as linkTypeEnum,
  qrCodes,
  reviewDestinations,
  reviewModes,
  subscriptions,
  users,
  type Database,
} from '@ai-review/db';
import {
  parseGuidance,
  PasswordHasher,
  generateQrCode,
  normalizePhone,
  validateGoogleReviewUrl,
  validatePasswordStrength,
  validateSlug,
} from '@ai-review/core';

/**
 * Demo tenant seed (`docs/spec/20_Test_Data_Seed.json`).
 *
 * Produces one working Free tenant — owner login, public slug, links, AI context, review
 * modes, QR sources, contacts — plus the platform rows the delivered seed file does not
 * mention but without which the application cannot serve a single request:
 *
 *  - a `business_slugs` primary row. AMENDMENT-005 removed `businesses.slug`, so a business
 *    with no row here resolves to nothing at all (apps/web/lib/public-business.ts);
 *  - an `ai_prompt_versions` row with status ACTIVE, from `10_AI_Prompt_Templates.json`.
 *    `loadActivePromptVersion` returns null without one and the generate endpoint answers
 *    AI_PROVIDER_UNAVAILABLE for every customer (ADR-006, ADMIN-03-01).
 *
 * Two properties are load-bearing, and everything below is arranged around them:
 *
 *  - **Idempotent.** Every row carries a UUIDv5 derived from a fixed namespace, so a re-run
 *    upserts the same rows rather than accumulating a second demo tenant. Nothing is ever
 *    deleted or truncated, so even a mistaken `--force` can only add or refresh demo rows.
 *  - **Transactional.** One transaction. A half-seeded tenant — a business with no
 *    subscription, or no primary slug — reads as a real support incident, so partial success
 *    is not an outcome this script can produce.
 *
 * Run: `pnpm tsx scripts/seed.ts [--force]`
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** The delivered spec pack is the contract; both documents are read from it, never inlined. */
export const SPEC_DIR = join(HERE, '..', 'docs', 'spec');
/**
 * Prompt versions after 1.0.0 live here, not in docs/spec: the spec pack is frozen, and 1.0.0's
 * text says "English draft", which CHANGE-003 supersedes. Each file has the shape of
 * 10_AI_Prompt_Templates.json; the seed test pins 1.1.0 to 1.0.0 verbatim except one sentence.
 */
export const PROMPT_VERSIONS_DIR = join(HERE, 'prompt-versions');
export const CURRENT_PROMPT_VERSION = '1.1.0';

/**
 * Namespace for every seeded UUID. Changing it re-keys the whole demo tenant: the next run
 * inserts a parallel copy instead of updating it, so treat this value as frozen.
 */
const SEED_NAMESPACE = '6f2a1c34-8e5b-4b7a-9c21-3d0e7a1b5f88';

/**
 * RFC 2606 reserves `example.com`, so these addresses can never reach a real mailbox — which
 * is what keeps them inside the seed file's closing rule ("never use real customer PII").
 */
export const DEMO_OWNER_EMAIL = 'demo-owner@example.com';
export const PLATFORM_ADMIN_EMAIL = 'demo-admin@example.com';

/**
 * Documented dev credential, overridable with SEED_OWNER_PASSWORD. Validated against the
 * product's own strength rules either way: an account the application itself would refuse to
 * create is a trap for whoever later tries to change its password.
 */
export const DEMO_OWNER_PASSWORD = 'demo-owner-Password1!';

/**
 * The seed file's Google destination, kept exactly as delivered on an IANA-reserved domain.
 * Its closing line forbids a live Google review URL in automated tests, and the reason is not
 * hypothetical: a real review link in a fixture eventually sends real traffic, or a real
 * review, at a real business.
 *
 * It deliberately does not satisfy `validateGoogleReviewUrl`, which requires a Google host
 * (ONB-02-02). Only an operator-supplied SEED_GOOGLE_REVIEW_URL is validated, so pointing the
 * demo tenant at a genuine destination remains possible but cannot happen by default.
 */
export const PLACEHOLDER_REVIEW_URL = 'https://example.com/test-google-review';

/** Default labels for the profile buttons (D-014, D-015); the seed file supplies none. */
const LINK_LABELS: Record<(typeof linkTypeEnum.enumValues)[number], string> = {
  GOOGLE_REVIEW: 'Review us on Google',
  WHATSAPP: 'WhatsApp',
  CALL: 'Call us',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  WEBSITE: 'Website',
  DIRECTIONS: 'Directions',
  CUSTOM: 'More',
};

export class SeedDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedDataError';
  }
}

// ---------------------------------------------------------------------------------------------
// Spec documents
// ---------------------------------------------------------------------------------------------

/**
 * Enum members come from the Drizzle enums rather than being retyped here, so a seed document
 * naming a link type or contact status the database cannot store fails at parse time with a
 * readable message instead of mid-transaction with a Postgres enum error.
 */
const seedDocumentSchema = z.object({
  business: z.object({
    name: z.string().min(1).max(160),
    slug: z.string().min(1),
    category: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    links: z.array(
      z.object({
        type: z.enum(linkTypeEnum.enumValues),
        enabled: z.boolean(),
        url: z.string().optional(),
        phone: z.string().optional(),
      }),
    ),
    ai_context: z.object({
      services: z.array(z.string()),
      context_terms: z.array(z.string()),
    }),
    modes: z.array(
      z.object({
        name: z.string().min(1).max(80),
        active: z.boolean(),
        context_terms: z.array(z.string()),
      }),
    ),
    qrs: z.array(z.object({ source_label: z.string().min(1).max(120) })),
  }),
  customers: z.array(
    z.object({
      name: z.string().min(1).max(120),
      mobile: z.string().min(1),
      status: z.enum(customerRequestStatus.enumValues),
    }),
  ),
  notes: z.string().optional(),
});

const promptTemplateSchema = z.object({
  version: z.string().min(1).max(40),
  default_model: z.string().min(1).max(80),
  reasoning_effort: z.string().min(1).max(20),
  max_output_tokens: z.number().int().positive(),
  system_prompt: z.string().min(1),
  output_schema: z.record(z.string(), z.unknown()),
  /** The writing rules (CHANGE-004). Absent on the frozen 1.0.0; parseGuidance fills defaults. */
  guidance: z.record(z.string(), z.unknown()).optional(),
});

export type SeedDocument = z.infer<typeof seedDocumentSchema>;
export type PromptTemplateDocument = z.infer<typeof promptTemplateSchema>;

export function parseSeedDocument(raw: unknown): SeedDocument {
  const result = seedDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new SeedDataError(`20_Test_Data_Seed.json is not usable:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

export function parsePromptTemplate(
  raw: unknown,
  sourceName = '10_AI_Prompt_Templates.json',
): PromptTemplateDocument {
  const result = promptTemplateSchema.safeParse(raw);
  if (!result.success) {
    throw new SeedDataError(`${sourceName} is not usable:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

export function loadSpecDocuments(
  specDir: string = SPEC_DIR,
  promptVersionsDir: string = PROMPT_VERSIONS_DIR,
): {
  seed: SeedDocument;
  /** The frozen 1.0.0 template. Seeded ARCHIVED — history, and the row old generations reference. */
  prompt: PromptTemplateDocument;
  /** The version that actually runs. */
  currentPrompt: PromptTemplateDocument;
} {
  const currentFile = `${CURRENT_PROMPT_VERSION}.json`;
  return {
    seed: parseSeedDocument(readJson(join(specDir, '20_Test_Data_Seed.json'))),
    prompt: parsePromptTemplate(readJson(join(specDir, '10_AI_Prompt_Templates.json'))),
    currentPrompt: parsePromptTemplate(
      readJson(join(promptVersionsDir, currentFile)),
      `scripts/prompt-versions/${currentFile}`,
    ),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

// ---------------------------------------------------------------------------------------------
// Deterministic identifiers
// ---------------------------------------------------------------------------------------------

/**
 * RFC 4122 v5 (SHA-1, name-based). Every seeded row's primary key is derived this way, which
 * is what lets each write be a plain upsert on the primary key: no lookup round-trip, no way
 * to end up with a second demo tenant, and stable ids that fixtures and E2E specs can pin.
 *
 * Bytes are read and written through readUInt8/writeUInt8 rather than indexed, so the version
 * and variant bits are set without a non-null assertion under noUncheckedIndexedAccess.
 */
export function deterministicUuid(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (namespaceBytes.length !== 16) {
    throw new SeedDataError(`namespace is not a UUID: ${namespace}`);
  }

  const digest = createHash('sha1').update(namespaceBytes).update(name, 'utf8').digest();
  const bytes = digest.subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function seedId(name: string): string {
  return deterministicUuid(SEED_NAMESPACE, name);
}

/** Pinned so the safety guard can tell the demo tenant apart from somebody's real one. */
export const DEMO_BUSINESS_ID = seedId('business:demo-south-cafe');

// ---------------------------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------------------------

export type SeedRefusalReason = 'PRODUCTION_ENVIRONMENT' | 'DATABASE_NOT_EMPTY';

export interface SeedSafetyInput {
  nodeEnv: string | undefined;
  force: boolean;
  /**
   * Businesses that are **not** the demo tenant. Counting the demo row itself would make the
   * second run of an idempotent script refuse itself, and what this guard actually protects is
   * somebody else's data — not the presence of rows as such.
   */
  foreignBusinessCount: number;
}

export type SeedSafetyDecision =
  { ok: true } | { ok: false; reason: SeedRefusalReason; message: string };

/**
 * Two refusals, and the order between them is deliberate.
 *
 * Production is checked first and `--force` does not lift it. A flag that can be typed at 2am
 * is not an adequate control over a live tenant table, and there is no legitimate reason to
 * seed demo data into production at all — so the escape hatch is absent rather than merely
 * discouraged.
 */
export function evaluateSeedSafety(input: SeedSafetyInput): SeedSafetyDecision {
  if (input.nodeEnv === 'production') {
    return {
      ok: false,
      reason: 'PRODUCTION_ENVIRONMENT',
      message:
        'Refusing to seed: NODE_ENV is production. This is not overridable by --force. ' +
        'If that is unexpected, check which DATABASE_URL is loaded before retrying.',
    };
  }

  if (input.foreignBusinessCount > 0 && !input.force) {
    return {
      ok: false,
      reason: 'DATABASE_NOT_EMPTY',
      message:
        `Refusing to seed: the target database already holds ${input.foreignBusinessCount} ` +
        'business(es) that are not the demo tenant. Confirm this is a disposable database, ' +
        'then re-run with --force. (The seed only inserts and updates demo rows; it never ' +
        'deletes anything.)',
    };
  }

  return { ok: true };
}

export type SeedArgs = { ok: true; force: boolean } | { ok: false; message: string };

/**
 * Unknown arguments are rejected rather than ignored: a silently dropped `--Force` would leave
 * an operator believing a guard had been lifted when it had not.
 */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  let force = false;

  for (const arg of argv) {
    if (arg === '--force') {
      force = true;
      continue;
    }
    return { ok: false, message: `Unknown argument: ${arg}. Usage: seed.ts [--force]` };
  }

  return { ok: true, force };
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

export interface SeedPlan {
  businessId: string;
  owner: typeof users.$inferInsert;
  admin: typeof users.$inferInsert;
  business: typeof businesses.$inferInsert;
  primarySlug: typeof businessSlugs.$inferInsert;
  subscription: typeof subscriptions.$inferInsert;
  aiContext: typeof aiBusinessContexts.$inferInsert;
  reviewDestination: typeof reviewDestinations.$inferInsert;
  links: (typeof businessLinks.$inferInsert)[];
  modes: (typeof reviewModes.$inferInsert)[];
  qrCodes: (typeof qrCodes.$inferInsert)[];
  contacts: (typeof customers.$inferInsert)[];
  /** True when SEED_ADMIN_PASSWORD was set, so a reseed may overwrite the admin's password. */
  adminPasswordProvided: boolean;
  /** The ACTIVE prompt version. */
  promptVersion: typeof aiPromptVersions.$inferInsert;
  /**
   * Earlier versions, seeded ARCHIVED. Never deleted: ai_generations.prompt_version_id points
   * at whichever version wrote each draft, and that history is what ADR-006's rollback reads.
   */
  archivedPromptVersions: (typeof aiPromptVersions.$inferInsert)[];
}

export interface SeedPlanInput {
  /** Whether an admin password was explicitly supplied (SEED_ADMIN_PASSWORD). Default false. */
  adminPasswordProvided?: boolean;
  seed: SeedDocument;
  /** The frozen 1.0.0 template — archived. */
  prompt: PromptTemplateDocument;
  /** The version to activate. */
  currentPrompt: PromptTemplateDocument;
  ownerPasswordHash: string;
  adminPasswordHash: string;
  now: Date;
  /** Injected: QR codes are random in a real run, and a plan has to be assertable in a test. */
  newQrCode: () => string;
  /** SEED_GOOGLE_REVIEW_URL. Validated; the built-in placeholder is not — see its docblock. */
  googleReviewUrlOverride?: string | undefined;
}

export interface SeedPlanResult {
  plan: SeedPlan;
  /** Corrections applied to the delivered seed file, surfaced so that none of them is silent. */
  warnings: string[];
}

/**
 * Pure mapping from the spec documents to row shapes. Every decision the seed makes is made
 * here, so the interesting behaviour is testable without a database.
 */
export function buildSeedPlan(input: SeedPlanInput): SeedPlanResult {
  const { seed, prompt, currentPrompt, now } = input;
  const warnings: string[] = [];
  const doc = seed.business;

  const slugCheck = validateSlug(doc.slug);
  if (!slugCheck.ok) {
    throw new SeedDataError(`seed business slug "${doc.slug}" is invalid: ${slugCheck.reason}`);
  }
  const slug = slugCheck.slug;

  const ownerId = seedId(`user:${DEMO_OWNER_EMAIL}`);
  const adminId = seedId(`user:${PLATFORM_ADMIN_EMAIL}`);
  const businessId = seedId(`business:${slug}`);

  const owner: typeof users.$inferInsert = {
    id: ownerId,
    email: DEMO_OWNER_EMAIL,
    fullName: 'Demo Owner',
    passwordHash: input.ownerPasswordHash,
    role: 'BUSINESS_OWNER',
    // Pre-verified: AUTH-02's verification mail has nowhere to go on a reserved domain, and an
    // account that can never finish verification is not a usable demo account.
    emailVerifiedAt: now,
    updatedAt: now,
  };

  /**
   * ai_prompt_versions.created_by is NOT NULL, and AI-01-02 forbids a business owner from ever
   * reaching prompt configuration — attributing the platform's live prompt to a tenant would
   * contradict that in the audit trail. The prompt version is therefore authored by a
   * SUPER_ADMIN row, which is the correct owner of platform configuration in any case.
   */
  const admin: typeof users.$inferInsert = {
    id: adminId,
    email: PLATFORM_ADMIN_EMAIL,
    fullName: 'Demo Platform Admin',
    passwordHash: input.adminPasswordHash,
    role: 'SUPER_ADMIN',
    emailVerifiedAt: now,
    updatedAt: now,
  };

  const business: typeof businesses.$inferInsert = {
    id: businessId,
    ownerUserId: ownerId,
    name: doc.name,
    category: doc.category,
    description: doc.description ?? null,
    city: doc.city ?? null,
    state: doc.state ?? null,
    countryCode: 'IN',
    // AMENDMENT-004 default. Every analytics_daily_business day boundary is cut here.
    timezone: 'Asia/Kolkata',
    // ACTIVE or nothing: loadPublicConfig refuses a DRAFT tenant and PostgresQuotaStore
    // resolves any non-ACTIVE business to BLOCKED, so a DRAFT demo tenant would serve an
    // unavailable page and generate nothing.
    status: 'ACTIVE',
    publishedAt: now,
    updatedAt: now,
  };

  const primarySlug: typeof businessSlugs.$inferInsert = {
    slug,
    businessId,
    isPrimary: true,
    // Required, not incidental: ck_alias_has_expiry permits a null expiry only on the primary
    // row, because a retired alias without one would redirect forever (AMENDMENT-005).
    redirectUntil: null,
  };

  // D-004/D-005: the demo tenant is Free, which is what makes the AC-013 quota path
  // exercisable at all. 10 is the FREE_AI_GENERATION_LIMIT bootstrap default.
  const subscription: typeof subscriptions.$inferInsert = {
    id: seedId(`subscription:${slug}`),
    businessId,
    status: 'FREE',
    freeGenerationLimit: 10,
    freeGenerationsUsed: 0,
    proGenerationLimit: 2000,
    proGenerationsUsed: 0,
    updatedAt: now,
  };

  const destination = resolveReviewDestinationUrl(
    doc.links.find((link) => link.type === 'GOOGLE_REVIEW')?.url,
    input.googleReviewUrlOverride,
  );
  if (destination.warning) warnings.push(destination.warning);

  const reviewDestination: typeof reviewDestinations.$inferInsert = {
    id: seedId(`review-destination:${slug}:GOOGLE`),
    businessId,
    platform: 'GOOGLE',
    label: 'Google',
    url: destination.url,
    isPrimary: true,
    isEnabled: true,
    sortOrder: 0,
    updatedAt: now,
  };

  const links = doc.links.map((link, index) => buildLinkRow(link, index, businessId, now));

  const aiContext: typeof aiBusinessContexts.$inferInsert = {
    businessId,
    summary: doc.description ?? null,
    // D-025, AC-010: services and terms are hints for the model. Nothing downstream may treat
    // them as mandatory output, which is why they are stored flat and unranked — there is no
    // "required term" to express here.
    services: doc.ai_context.services,
    contextTerms: doc.ai_context.context_terms,
    // CHANGE-003. Stated rather than left to the column default, so the demo tenant's language
    // is a decision in the seed and not an accident of the schema.
    draftLanguage: 'hinglish',
    updatedBy: ownerId,
    updatedAt: now,
  };

  const modes = doc.modes.map((mode) => ({
    id: seedId(`review-mode:${slug}:${mode.name}`),
    businessId,
    name: mode.name,
    // A mode shifts context emphasis only, never sentiment (D-025). The seed carries terms and
    // nothing else, so there is no field here that could smuggle a tone or a rating in.
    contextTerms: mode.context_terms,
    isActive: mode.active,
    isArchived: false,
    updatedAt: now,
  }));

  // AI-02-01 and the uq_one_active_mode partial index both require exactly one. Checked here
  // because the alternative is an opaque constraint violation halfway through the transaction.
  const activeModes = modes.filter((mode) => mode.isActive).length;
  if (activeModes !== 1) {
    throw new SeedDataError(
      `seed defines ${activeModes} active review modes; exactly one is required (AI-02-01)`,
    );
  }

  const qrRows = doc.qrs.map((qr) => ({
    id: seedId(`qr:${slug}:${qr.source_label}`),
    businessId,
    code: input.newQrCode(),
    sourceLabel: qr.source_label,
    status: 'ACTIVE' as const,
    updatedAt: now,
  }));

  const contacts = seed.customers.map((customer) => {
    const phone = normalizePhone(customer.mobile);
    if (!phone.ok) {
      throw new SeedDataError(
        `seed contact "${customer.name}" has an unusable mobile ` +
          `(${customer.mobile}): ${phone.reason}`,
      );
    }
    return {
      id: seedId(`customer:${slug}:${phone.e164}`),
      businessId,
      name: customer.name,
      mobile: phone.e164,
      status: customer.status,
      updatedAt: now,
    };
  });

  /**
   * One row shape for every prompt version, live or archived.
   *
   * AI_DEFAULT_MODEL wins over the template's default_model: the DB row is what the generator
   * reads (ADR-006), so the model is a per-environment choice. The template default,
   * `gpt-5.6-luna`, is a real OpenAI model — verified against the live catalogue on
   * 11 September 2026 at $0.20/$1.20 per million tokens, the price the unit economics in
   * SPEC_AMENDMENTS.md were built on. (An earlier revision of this comment called it fiction;
   * it was wrong.)
   *
   * Reasoning effort is blank when the model takes no such field. The Anthropic adapter ignores
   * it outright; the OpenAI one sends it only when non-empty, and sending 'none' to a model that
   * does not accept it is a 400 on every request.
   *
   * max_output_tokens is carried from the template rather than defaulted. It is a cost control:
   * output tokens cost 6x input on Luna, and the cap bounds the worst case per draft.
   */
  const promptVersionRow = (
    template: PromptTemplateDocument,
    status: 'ACTIVE' | 'ARCHIVED',
  ): typeof aiPromptVersions.$inferInsert => ({
    id: seedId(`prompt-version:${template.version}`),
    version: template.version,
    status,
    model: process.env['AI_DEFAULT_MODEL']?.trim() || template.default_model,
    reasoningEffort: process.env['AI_REASONING_EFFORT_OVERRIDE'] ?? template.reasoning_effort,
    systemPrompt: template.system_prompt,
    outputSchema: template.output_schema,
    guidance: parseGuidance(template.guidance),
    maxOutputTokens: template.max_output_tokens,
    rolloutPercent: status === 'ACTIVE' ? 100 : 0,
    createdBy: adminId,
    activatedAt: status === 'ACTIVE' ? now : null,
  });

  // CHANGE-003: 1.1.0 runs, and the frozen 1.0.0 is kept as history rather than edited.
  const promptVersion = promptVersionRow(currentPrompt, 'ACTIVE');
  const archivedPromptVersions = [promptVersionRow(prompt, 'ARCHIVED')];

  return {
    plan: {
      businessId,
      owner,
      admin,
      business,
      primarySlug,
      subscription,
      aiContext,
      reviewDestination,
      links,
      modes,
      qrCodes: qrRows,
      contacts,
      promptVersion,
      archivedPromptVersions,
      adminPasswordProvided: input.adminPasswordProvided ?? false,
    },
    warnings,
  };
}

/**
 * AMENDMENT-003 in action.
 *
 * `20_Test_Data_Seed.json` still hangs the Google URL off its GOOGLE_REVIEW link, which the
 * amendment resolved in favour of `review_destinations` and which `ck_google_review_has_no_url`
 * now rejects outright. The url is therefore *relocated* rather than dropped: the demo tenant
 * ends up with the destination the seed file intended, stored in the one place that owns it.
 */
function resolveReviewDestinationUrl(
  documentUrl: string | undefined,
  override: string | undefined,
): { url: string; warning: string | null } {
  if (override) {
    const checked = validateGoogleReviewUrl(override);
    if (!checked.ok) {
      throw new SeedDataError(
        `SEED_GOOGLE_REVIEW_URL is not a usable Google review link (${checked.reason}).`,
      );
    }
    return {
      url: checked.url,
      warning:
        'SEED_GOOGLE_REVIEW_URL is set, so the demo tenant points at a real Google ' +
        'destination. Do not use this database for automated tests.',
    };
  }

  if (documentUrl) {
    return {
      url: documentUrl,
      warning:
        'AMENDMENT-003: 20_Test_Data_Seed.json still puts a url on its GOOGLE_REVIEW link. ' +
        'Seeded into review_destinations instead; the link row carries no url.',
    };
  }

  return {
    url: PLACEHOLDER_REVIEW_URL,
    warning: 'Seed file supplied no Google destination; used the reserved-domain placeholder.',
  };
}

function buildLinkRow(
  link: SeedDocument['business']['links'][number],
  index: number,
  businessId: string,
  now: Date,
): typeof businessLinks.$inferInsert {
  const label = LINK_LABELS[link.type];

  let phone: string | null = null;
  if (link.phone) {
    const normalized = normalizePhone(link.phone);
    if (!normalized.ok) {
      throw new SeedDataError(
        `seed ${link.type} link has an unusable phone (${link.phone}): ${normalized.reason}`,
      );
    }
    phone = normalized.e164;
  }

  // ck_google_review_has_no_url. The presentation row owns only whether and where the button
  // renders (D-015); review_destinations owns where it goes.
  const url = link.type === 'GOOGLE_REVIEW' ? null : (link.url ?? null);

  // ck_enabled_link_has_target / PROFILE-01-02: an enabled non-Google button with nothing
  // behind it is a dead control on a real customer's screen.
  if (link.enabled && link.type !== 'GOOGLE_REVIEW' && !url && !phone) {
    throw new SeedDataError(`seed ${link.type} link is enabled but has neither url nor phone`);
  }

  return {
    id: seedId(`link:${businessId}:${link.type}:${label}`),
    businessId,
    linkType: link.type,
    label,
    url,
    phone,
    isEnabled: link.enabled,
    // Document order is display order (D-015). Deliberately not re-sorted or grouped: the seed
    // file's ordering is the intended one.
    sortOrder: index,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------

type SeedTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Writes the plan. Insert order follows the foreign keys: users, then the business, then
 * everything hanging off it, then the prompt version (which references the admin user).
 *
 * Every statement is an upsert keyed on the deterministic primary key, except where a natural
 * key is unambiguously better: `business_slugs` is keyed by slug because the slug *is* its
 * primary key, and `subscriptions` by business because at most one may exist per business.
 *
 * Returns any notes worth printing — things the seed decided not to overwrite.
 */
async function applySeedPlan(tx: SeedTransaction, plan: SeedPlan): Promise<string[]> {
  const notes: string[] = [];

  for (const user of [plan.owner, plan.admin]) {
    // The owner's password is restored on every run — documented demo credentials are the
    // point of a seed. The admin's is not, unless SEED_ADMIN_PASSWORD asked for one: the seed's
    // own admin password is deliberately unusable, and rewriting a password that
    // `pnpm admin:create` set would lock the operator out on every reseed. That happened.
    const keepExistingPassword = user === plan.admin && !plan.adminPasswordProvided;
    await tx
      .insert(users)
      .values(user)
      .onConflictDoUpdate({
        target: users.id,
        // `email` is absent from the set: it is this row's identity, and rewriting it would
        // silently rename an existing account instead of creating one.
        set: {
          fullName: user.fullName,
          ...(keepExistingPassword ? {} : { passwordHash: user.passwordHash }),
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt,
          updatedAt: user.updatedAt,
        },
      });
  }

  await tx
    .insert(businesses)
    .values(plan.business)
    .onConflictDoUpdate({
      target: businesses.id,
      set: {
        name: plan.business.name,
        category: plan.business.category,
        description: plan.business.description,
        city: plan.business.city,
        state: plan.business.state,
        timezone: plan.business.timezone,
        status: plan.business.status,
        publishedAt: plan.business.publishedAt,
        updatedAt: plan.business.updatedAt,
      },
    });

  await tx
    .insert(businessSlugs)
    .values(plan.primarySlug)
    .onConflictDoUpdate({
      target: businessSlugs.slug,
      set: { businessId: plan.primarySlug.businessId, isPrimary: true, redirectUntil: null },
    });

  await tx
    .insert(subscriptions)
    .values(plan.subscription)
    .onConflictDoUpdate({
      target: subscriptions.businessId,
      set: {
        status: plan.subscription.status,
        freeGenerationLimit: plan.subscription.freeGenerationLimit,
        // Reset on purpose: re-running the seed returns the demo tenant to a full free quota,
        // which is what makes the Free-tier flow repeatable during development.
        freeGenerationsUsed: 0,
        proGenerationLimit: plan.subscription.proGenerationLimit,
        proGenerationsUsed: 0,
        updatedAt: plan.subscription.updatedAt,
      },
    });

  // uq_one_primary_review_destination is a partial unique index, so a stale primary row left
  // behind by manual poking would abort the upsert below. Demote first, then claim.
  await tx
    .update(reviewDestinations)
    .set({ isPrimary: false })
    .where(eq(reviewDestinations.businessId, plan.businessId));

  await tx
    .insert(reviewDestinations)
    .values(plan.reviewDestination)
    .onConflictDoUpdate({
      target: reviewDestinations.id,
      set: {
        url: plan.reviewDestination.url,
        label: plan.reviewDestination.label,
        isPrimary: true,
        isEnabled: true,
        updatedAt: plan.reviewDestination.updatedAt,
      },
    });

  for (const link of plan.links) {
    await tx
      .insert(businessLinks)
      .values(link)
      .onConflictDoUpdate({
        target: businessLinks.id,
        set: {
          label: link.label,
          url: link.url,
          phone: link.phone,
          isEnabled: link.isEnabled,
          sortOrder: link.sortOrder,
          updatedAt: link.updatedAt,
        },
      });
  }

  await tx
    .insert(aiBusinessContexts)
    .values(plan.aiContext)
    .onConflictDoUpdate({
      target: aiBusinessContexts.businessId,
      set: {
        summary: plan.aiContext.summary,
        services: plan.aiContext.services,
        contextTerms: plan.aiContext.contextTerms,
        draftLanguage: plan.aiContext.draftLanguage,
        updatedAt: plan.aiContext.updatedAt,
      },
    });

  // Same reasoning as the review destination: uq_one_active_mode is partial-unique, so any
  // other active mode has to stand down before the seeded one is written.
  await tx
    .update(reviewModes)
    .set({ isActive: false })
    .where(eq(reviewModes.businessId, plan.businessId));

  for (const mode of plan.modes) {
    await tx
      .insert(reviewModes)
      .values(mode)
      .onConflictDoUpdate({
        target: reviewModes.id,
        set: {
          contextTerms: mode.contextTerms,
          isActive: mode.isActive,
          isArchived: false,
          updatedAt: mode.updatedAt,
        },
      });
  }

  for (const qr of plan.qrCodes) {
    await tx
      .insert(qrCodes)
      .values(qr)
      .onConflictDoUpdate({
        target: qrCodes.id,
        // `code` is deliberately absent from the set. QR-01-01: the code is printed on a
        // physical standee and is immutable for the life of the row, so re-seeding must never
        // invalidate one that is already on a counter somewhere.
        set: { sourceLabel: qr.sourceLabel, status: qr.status, updatedAt: qr.updatedAt },
      });
  }

  for (const contact of plan.contacts) {
    await tx
      .insert(customers)
      .values(contact)
      .onConflictDoUpdate({
        target: customers.id,
        set: {
          name: contact.name,
          status: contact.status,
          deletedAt: null,
          updatedAt: contact.updatedAt,
        },
      });
  }

  /**
   * ADMIN-03-01 allows exactly one ACTIVE version, enforced by uq_one_active_prompt_version.
   * If the platform already has a live prompt that is not this one, the application already
   * works and replacing its prompt is not a seed script's decision — so the seeded version
   * lands as DRAFT and says so, rather than aborting on the unique index.
   */
  // Retire our own earlier versions first, inside the same transaction, so the partial unique
  // index on ACTIVE is free for the current one by the time it is written. `activatedAt` is
  // deliberately not in the update set: the date a version went live is history, and history
  // is what an archived row is for.
  for (const archived of plan.archivedPromptVersions) {
    await tx
      .insert(aiPromptVersions)
      .values(archived)
      .onConflictDoUpdate({
        target: aiPromptVersions.id,
        set: {
          status: 'ARCHIVED',
          model: archived.model,
          reasoningEffort: archived.reasoningEffort,
          systemPrompt: archived.systemPrompt,
          outputSchema: archived.outputSchema,
          guidance: archived.guidance,
          maxOutputTokens: archived.maxOutputTokens,
          rolloutPercent: archived.rolloutPercent,
        },
      });
  }

  const [liveVersion] = await tx
    .select({ id: aiPromptVersions.id, version: aiPromptVersions.version })
    .from(aiPromptVersions)
    .where(eq(aiPromptVersions.status, 'ACTIVE'))
    .limit(1);

  let promptRow = plan.promptVersion;
  if (liveVersion !== undefined && liveVersion.id !== plan.promptVersion.id) {
    promptRow = { ...plan.promptVersion, status: 'DRAFT', activatedAt: null };
    notes.push(
      `prompt version ${liveVersion.version} is already ACTIVE, so ${plan.promptVersion.version} ` +
        'was seeded as DRAFT rather than replacing the live prompt (ADMIN-03-01).',
    );
  }

  await tx
    .insert(aiPromptVersions)
    .values(promptRow)
    .onConflictDoUpdate({
      target: aiPromptVersions.id,
      set: {
        status: promptRow.status,
        model: promptRow.model,
        reasoningEffort: promptRow.reasoningEffort,
        systemPrompt: promptRow.systemPrompt,
        outputSchema: promptRow.outputSchema,
        guidance: promptRow.guidance,
        maxOutputTokens: promptRow.maxOutputTokens,
        rolloutPercent: promptRow.rolloutPercent,
        activatedAt: promptRow.activatedAt,
      },
    });

  return notes;
}

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

/** eslint's no-console allows warn/error only; packages/db/src/migrate.ts sets the precedent. */
function report(line: string): void {
  console.warn(line);
}

export async function run(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const args = parseSeedArgs(argv);
  if (!args.ok) {
    console.error(args.message);
    return 2;
  }

  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    return 2;
  }

  // Deliberately not loadEnv(): the full contract demands a session secret, an OpenAI key and
  // an S3 bucket, none of which seeding touches. Refusing to seed a local database because no
  // payment provider is configured would be a worse failure than the one it prevents.
  const nodeEnv = env.NODE_ENV;

  // Checked before a pool is opened, so a production refusal never costs a connection to the
  // very database it is refusing to touch.
  const earlyGuard = evaluateSeedSafety({ nodeEnv, force: args.force, foreignBusinessCount: 0 });
  if (!earlyGuard.ok) {
    console.error(earlyGuard.message);
    return 2;
  }

  const { seed, prompt, currentPrompt } = loadSpecDocuments();

  const ownerPassword = env.SEED_OWNER_PASSWORD ?? DEMO_OWNER_PASSWORD;
  const strength = validatePasswordStrength(ownerPassword);
  if (!strength.ok) {
    console.error(`SEED_OWNER_PASSWORD is rejected by the product's own rules: ${strength.reason}`);
    return 2;
  }

  // Refuse to seed without the pepper the application verifies against.
  //
  // PasswordHasher mixes HASH_PEPPER into every hash, so a seed run without it writes hashes the
  // app can never verify: the rows look perfectly valid, and every seeded login fails with
  // "that password is not correct". Nothing about the failure points at the cause. This actually
  // happened — the seed was run without loading .env while the web app had one — and the only
  // symptom was an unopenable demo account.
  //
  // A missing pepper is also not a safe default in its own right: it silently weakens every hash
  // it writes.
  if (!env.HASH_PEPPER) {
    console.error(
      'HASH_PEPPER is not set. Seeded passwords would be hashed without the pepper the app ' +
        'verifies with, so every seeded login would fail. Load the same environment the web ' +
        'app uses before seeding.',
    );
    return 2;
  }

  const hasher = new PasswordHasher({ pepper: env.HASH_PEPPER });

  /**
   * The platform admin gets an unusable password unless one is asked for explicitly. A
   * SUPER_ADMIN crosses every tenant boundary (RBAC rule 5) and MFA enrolment does not exist
   * yet (AMENDMENT-007, built in E13), so a well-known default password on that account is a
   * larger risk than the inconvenience of it having none.
   */
  const adminPassword = env.SEED_ADMIN_PASSWORD;
  const adminPasswordHash = await hasher.hash(
    adminPassword ?? `unusable:${randomUUID()}:${randomUUID()}`,
  );

  const { plan, warnings } = buildSeedPlan({
    seed,
    prompt,
    currentPrompt,
    adminPasswordProvided: adminPassword !== undefined,
    ownerPasswordHash: await hasher.hash(ownerPassword),
    adminPasswordHash,
    now: new Date(),
    newQrCode: () => generateQrCode(),
    googleReviewUrlOverride: env.SEED_GOOGLE_REVIEW_URL,
  });

  const db = createDatabase({ connectionString, poolMin: 1, poolMax: 4 });

  try {
    const foreignBusinessCount = await db.$count(businesses, ne(businesses.id, plan.businessId));

    const guard = evaluateSeedSafety({ nodeEnv, force: args.force, foreignBusinessCount });
    if (!guard.ok) {
      console.error(guard.message);
      return 2;
    }

    const notes = await db.transaction((tx) => applySeedPlan(tx, plan));

    for (const note of [...warnings, ...notes]) report(`note: ${note}`);

    report('');
    report(`Seeded demo tenant "${plan.business.name}".`);
    report(`  public slug     /${plan.primarySlug.slug}`);
    report(`  owner login     ${DEMO_OWNER_EMAIL} / ${ownerPassword}`);
    report(`  platform admin  ${PLATFORM_ADMIN_EMAIL}${adminPassword ? '' : ' (no password set)'}`);
    report(`  plan            FREE, ${plan.subscription.freeGenerationLimit} generations`);
    report(`  prompt version  ${plan.promptVersion.version} (${plan.promptVersion.model})`);
    // Read back rather than reported from the plan.
    //
    // The upsert deliberately never overwrites `code` (QR-01-01: a printed standee must stay
    // valid), so on a re-seed the planned codes are freshly generated values that were discarded.
    // Printing those sent anyone following the output to a 404 while the real codes still worked.
    const storedQrCodes = await db
      .select({ code: qrCodes.code })
      .from(qrCodes)
      .where(eq(qrCodes.businessId, plan.business.id!))
      .orderBy(qrCodes.createdAt);
    report(`  QR codes        ${storedQrCodes.map((qr) => `/r/${qr.code}`).join('  ')}`);
    report('');

    return 0;
  } finally {
    await db.$client.end();
  }
}

/**
 * Direct-run guard, so importing this module from a test seeds nothing.
 *
 * Compared as filesystem paths rather than URLs, case-insensitively on Windows: `argv[1]` and
 * `import.meta.url` can disagree there on drive-letter case, and a mismatch would silently
 * turn the script into a no-op that reports success.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;

  const invoked = resolve(entry);
  const self = resolve(fileURLToPath(import.meta.url));
  return process.platform === 'win32'
    ? invoked.toLowerCase() === self.toLowerCase()
    : invoked === self;
}

if (isDirectRun()) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
    });
}
