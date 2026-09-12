import { DEFAULT_GUIDANCE } from '@ai-review/core';
import { describe, expect, it } from 'vitest';
import {
  DEMO_BUSINESS_ID,
  DEMO_OWNER_EMAIL,
  PLACEHOLDER_REVIEW_URL,
  PLATFORM_ADMIN_EMAIL,
  SeedDataError,
  buildSeedPlan,
  deterministicUuid,
  evaluateSeedSafety,
  loadSpecDocuments,
  parseSeedArgs,
  parseSeedDocument,
  seedId,
  type SeedDocument,
  type SeedPlanInput,
  type SeedPlanResult,
} from '../seed';

/**
 * Covers the two halves of the seed that can be wrong without a database noticing: the safety
 * guard, and the mapping from the delivered spec documents to row shapes.
 *
 * The plan is built from the *real* `docs/spec` files rather than a fixture, so the mapping is
 * pinned to the contract it claims to implement — if the spec pack changes shape, these fail
 * instead of the seed failing halfway through a transaction on somebody's machine.
 */

const NOW = new Date('2026-08-29T06:00:00.000Z');

function planFromSpec(overrides: Partial<SeedPlanInput> = {}): SeedPlanResult {
  const { seed, prompt, currentPrompt } = loadSpecDocuments();
  let issued = 0;

  return buildSeedPlan({
    seed,
    prompt,
    currentPrompt,
    ownerPasswordHash: 'argon2id$owner',
    adminPasswordHash: 'argon2id$admin',
    now: NOW,
    // Stubbed so the only nondeterministic input to a plan is pinned; the real generator is
    // random by design (packages/core/src/qr/code.ts).
    newQrCode: () => `SEEDQR${(issued += 1)}`,
    ...overrides,
  });
}

/** A fresh parse each time, so a test that mutates the document cannot leak into another. */
function specDocument(): SeedDocument {
  return loadSpecDocuments().seed;
}

describe('spec documents', () => {
  it('parses the delivered seed and prompt files', () => {
    const { seed, prompt } = loadSpecDocuments();

    expect(seed.business.slug).toBe('demo-south-cafe');
    expect(seed.customers).toHaveLength(2);
    expect(prompt.version).toBe('1.0.0');
    expect(prompt.default_model).toBe('gpt-5.6-luna');
  });

  /** The parser is bound to the Drizzle enums, so unstorable values fail before any INSERT. */
  it('rejects a contact status the database has no enum member for', () => {
    const document = specDocument() as unknown as Record<string, unknown>;

    expect(() =>
      parseSeedDocument({
        ...document,
        customers: [{ name: 'X', mobile: '+919800000001', status: 'REVIEW_LEFT' }],
      }),
    ).toThrow(SeedDataError);
  });

  it('rejects a link type the database has no enum member for', () => {
    const seed = specDocument();
    seed.business.links = [
      { type: 'TIKTOK', enabled: true, url: 'https://example.com' },
    ] as unknown as SeedDocument['business']['links'];

    expect(() => parseSeedDocument(seed)).toThrow(SeedDataError);
  });
});

describe('safety guard', () => {
  it('allows a development run against a database with no other tenants', () => {
    expect(
      evaluateSeedSafety({ nodeEnv: 'development', force: false, foreignBusinessCount: 0 }),
    ).toEqual({ ok: true });
  });

  /**
   * The headline case. --force must not be a way to reach production, because the flag exists
   * for "yes, this scratch database has rows in it" and nothing more.
   */
  it('refuses production even with --force', () => {
    const decision = evaluateSeedSafety({
      nodeEnv: 'production',
      force: true,
      foreignBusinessCount: 0,
    });

    expect(decision).toMatchObject({ ok: false, reason: 'PRODUCTION_ENVIRONMENT' });
  });

  it('refuses a database that already holds another tenant', () => {
    const decision = evaluateSeedSafety({
      nodeEnv: 'development',
      force: false,
      foreignBusinessCount: 3,
    });

    expect(decision).toMatchObject({ ok: false, reason: 'DATABASE_NOT_EMPTY' });
    if (!decision.ok) expect(decision.message).toContain('--force');
  });

  it('allows a populated database once --force is passed', () => {
    expect(
      evaluateSeedSafety({ nodeEnv: 'development', force: true, foreignBusinessCount: 3 }),
    ).toEqual({ ok: true });
  });

  it('treats an unset NODE_ENV as non-production', () => {
    expect(
      evaluateSeedSafety({ nodeEnv: undefined, force: false, foreignBusinessCount: 0 }),
    ).toEqual({ ok: true });
  });

  /**
   * The guard counts *foreign* businesses, so a second run of an idempotent script is not
   * refused by the tenant it created on the first run. DEMO_BUSINESS_ID is what the query
   * excludes, so it has to be the id the plan actually writes — if the spec slug ever changes,
   * the two diverge and every re-run starts demanding --force.
   */
  it('excludes the demo tenant it seeds itself', () => {
    expect(planFromSpec().plan.businessId).toBe(DEMO_BUSINESS_ID);
  });
});

describe('argument parsing', () => {
  it('defaults to not forcing', () => {
    expect(parseSeedArgs([])).toEqual({ ok: true, force: false });
  });

  it('accepts --force', () => {
    expect(parseSeedArgs(['--force'])).toEqual({ ok: true, force: true });
  });

  /** A near-miss must not be swallowed: the operator would believe a guard had been lifted. */
  it.each([['--Force'], ['-f'], ['force'], ['--yes']])('rejects %s', (arg) => {
    expect(parseSeedArgs([arg])).toMatchObject({ ok: false });
  });
});

describe('deterministic identifiers', () => {
  it('returns the same id for the same name', () => {
    expect(seedId('business:demo-south-cafe')).toBe(seedId('business:demo-south-cafe'));
  });

  it('returns different ids for different names', () => {
    expect(seedId('qr:a')).not.toBe(seedId('qr:b'));
  });

  it('produces a well-formed RFC 4122 v5 uuid', () => {
    const id = deterministicUuid('6f2a1c34-8e5b-4b7a-9c21-3d0e7a1b5f88', 'anything');

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('refuses a namespace that is not a uuid', () => {
    expect(() => deterministicUuid('not-a-uuid', 'x')).toThrow(SeedDataError);
  });

  /** Idempotency rests entirely on this: identical inputs must key identical rows. */
  it('produces identical row ids across two builds of the same plan', () => {
    const first = planFromSpec().plan;
    const second = planFromSpec().plan;

    expect(second.owner.id).toBe(first.owner.id);
    expect(second.business.id).toBe(first.business.id);
    expect(second.links.map((l) => l.id)).toEqual(first.links.map((l) => l.id));
    expect(second.qrCodes.map((q) => q.id)).toEqual(first.qrCodes.map((q) => q.id));
    expect(second.contacts.map((c) => c.id)).toEqual(first.contacts.map((c) => c.id));
  });
});

describe('AMENDMENT-003 — the Google review URL has one owner', () => {
  it('seeds the GOOGLE_REVIEW link with no url', () => {
    const google = planFromSpec().plan.links.find((link) => link.linkType === 'GOOGLE_REVIEW');

    // ck_google_review_has_no_url rejects anything else outright.
    expect(google).toBeDefined();
    expect(google?.url).toBeNull();
    expect(google?.isEnabled).toBe(true);
  });

  it('relocates the url from the seed file onto review_destinations', () => {
    const { plan, warnings } = planFromSpec();

    expect(plan.reviewDestination.url).toBe(PLACEHOLDER_REVIEW_URL);
    expect(plan.reviewDestination.isPrimary).toBe(true);
    expect(plan.reviewDestination.isEnabled).toBe(true);
    expect(warnings.join(' ')).toContain('AMENDMENT-003');
  });

  it('falls back to the reserved-domain placeholder when the document carries no url', () => {
    const seed = specDocument();
    seed.business.links = seed.business.links.map((link) =>
      link.type === 'GOOGLE_REVIEW' ? { ...link, url: undefined } : link,
    );

    expect(planFromSpec({ seed }).plan.reviewDestination.url).toBe(PLACEHOLDER_REVIEW_URL);
  });

  /**
   * 20_Test_Data_Seed.json closes with "never use ... a live Google review URL in automated
   * tests". A fixture pointing at a real listing eventually sends real traffic at a real
   * business, so the default destination must stay on an IANA-reserved domain.
   */
  it('never defaults to a Google host', () => {
    const host = new URL(planFromSpec().plan.reviewDestination.url).hostname;

    expect(['example.com', 'example.net', 'example.org']).toContain(host);
  });

  it('validates an operator-supplied destination and refuses a non-Google one', () => {
    expect(() =>
      planFromSpec({ googleReviewUrlOverride: 'https://example.com/not-google' }),
    ).toThrow(SeedDataError);
  });

  it('accepts and normalizes an operator-supplied Google destination', () => {
    const { plan, warnings } = planFromSpec({
      googleReviewUrlOverride: 'https://G.PAGE/r/demo/review?utm_source=email',
    });

    expect(plan.reviewDestination.url).toBe('https://g.page/r/demo/review');
    expect(warnings.join(' ')).toContain('SEED_GOOGLE_REVIEW_URL');
  });
});

describe('profile links', () => {
  it('keeps the document order as display order (D-015)', () => {
    const links = planFromSpec().plan.links;

    expect(links.map((link) => link.linkType)).toEqual([
      'GOOGLE_REVIEW',
      'WHATSAPP',
      'CALL',
      'INSTAGRAM',
      'FACEBOOK',
    ]);
    expect(links.map((link) => link.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it('normalizes link phone numbers to E.164', () => {
    const call = planFromSpec().plan.links.find((link) => link.linkType === 'CALL');

    expect(call?.phone).toBe('+919999999999');
    expect(call?.url).toBeNull();
  });

  /** ck_enabled_link_has_target / PROFILE-01-02: an enabled button must go somewhere. */
  it('refuses an enabled non-Google link with neither url nor phone', () => {
    const seed = specDocument();
    seed.business.links = [{ type: 'INSTAGRAM', enabled: true }];

    expect(() => planFromSpec({ seed })).toThrow(/neither url nor phone/);
  });

  it('refuses a link phone the platform cannot dial', () => {
    const seed = specDocument();
    seed.business.links = [{ type: 'CALL', enabled: true, phone: '+91123' }];

    expect(() => planFromSpec({ seed })).toThrow(SeedDataError);
  });
});

describe('review modes', () => {
  it('seeds exactly one active, unarchived mode (AI-02-01)', () => {
    const modes = planFromSpec().plan.modes;

    expect(modes).toHaveLength(2);
    expect(modes.filter((mode) => mode.isActive)).toHaveLength(1);
    expect(modes.find((mode) => mode.isActive)?.name).toBe('Balanced');
    expect(modes.every((mode) => mode.isArchived === false)).toBe(true);
  });

  /** uq_one_active_mode would otherwise abort mid-transaction with an opaque error. */
  it('refuses a document with two active modes', () => {
    const seed = specDocument();
    seed.business.modes = seed.business.modes.map((mode) => ({ ...mode, active: true }));

    expect(() => planFromSpec({ seed })).toThrow(/exactly one is required/);
  });

  it('refuses a document with no active mode', () => {
    const seed = specDocument();
    seed.business.modes = seed.business.modes.map((mode) => ({ ...mode, active: false }));

    expect(() => planFromSpec({ seed })).toThrow(/exactly one is required/);
  });

  it('carries context terms through unchanged as hints (D-025, AC-010)', () => {
    const breakfast = planFromSpec().plan.modes.find((mode) => mode.name === 'Breakfast');

    expect(breakfast?.contextTerms).toEqual(['Breakfast', 'Filter Coffee']);
    expect(breakfast?.isActive).toBe(false);
  });
});

describe('tenant rows the seed file does not describe', () => {
  it('seeds an owner that the business points at', () => {
    const { plan } = planFromSpec();

    expect(plan.owner.email).toBe(DEMO_OWNER_EMAIL);
    expect(plan.owner.role).toBe('BUSINESS_OWNER');
    expect(plan.owner.passwordHash).toBe('argon2id$owner');
    expect(plan.business.ownerUserId).toBe(plan.owner.id);
  });

  /** AMENDMENT-005: there is no businesses.slug, so this row is the entire public identity. */
  it('seeds a primary slug row with no redirect expiry', () => {
    const { plan } = planFromSpec();

    expect(plan.primarySlug).toEqual({
      slug: 'demo-south-cafe',
      businessId: plan.businessId,
      isPrimary: true,
      redirectUntil: null,
    });
  });

  it('publishes the business so the public flow can resolve it', () => {
    const { business } = planFromSpec().plan;

    // loadPublicConfig and PostgresQuotaStore both refuse anything but ACTIVE.
    expect(business.status).toBe('ACTIVE');
    expect(business.timezone).toBe('Asia/Kolkata');
    expect(business.countryCode).toBe('IN');
    expect(business.city).toBe('Udaipur');
  });

  it('seeds a Free subscription with the full quota unused (D-004, AC-013)', () => {
    const { subscription, businessId } = planFromSpec().plan;

    expect(subscription.businessId).toBe(businessId);
    expect(subscription.status).toBe('FREE');
    expect(subscription.freeGenerationLimit).toBe(10);
    expect(subscription.freeGenerationsUsed).toBe(0);
    expect(subscription.proGenerationLimit).toBe(2000);
    expect(subscription.proGenerationsUsed).toBe(0);
  });

  /**
   * Without an ACTIVE row here `loadActivePromptVersion` returns null and every generation
   * answers AI_PROVIDER_UNAVAILABLE, so this is what makes the seeded tenant usable at all.
   */
  it('activates 1.1.0 from scripts/prompt-versions and archives the frozen 1.0.0', () => {
    const { promptVersion, archivedPromptVersions, admin } = planFromSpec().plan;
    const { prompt, currentPrompt } = loadSpecDocuments();

    expect(promptVersion.status).toBe('ACTIVE');
    expect(promptVersion.version).toBe('1.1.0');
    expect(promptVersion.version).toBe(currentPrompt.version);
    expect(promptVersion.model).toBe('gpt-5.6-luna');
    // Raised from 220: Roman-script Hindi tokenises worse than English, and a draft cut off at
    // the cap is a non-retryable failure, not a shorter draft (CHANGE-003).
    expect(promptVersion.maxOutputTokens).toBe(320);
    expect(promptVersion.reasoningEffort).toBe('none');
    expect(promptVersion.systemPrompt).toBe(currentPrompt.system_prompt);
    expect(promptVersion.systemPrompt).toMatch(/DRAFT_LANGUAGE/);
    expect(promptVersion.systemPrompt).not.toMatch(/English draft/);
    expect(promptVersion.outputSchema).toEqual(prompt.output_schema);
    expect(promptVersion.rolloutPercent).toBe(100);
    expect(promptVersion.activatedAt).toBe(NOW);
    // AI-01-02: platform prompt configuration is never attributed to a tenant owner.
    expect(promptVersion.createdBy).toBe(admin.id);
    expect(admin.role).toBe('SUPER_ADMIN');
    expect(admin.email).toBe(PLATFORM_ADMIN_EMAIL);

    expect(archivedPromptVersions).toHaveLength(1);
    const [archived] = archivedPromptVersions;
    expect(archived?.version).toBe(prompt.version);
    expect(archived?.status).toBe('ARCHIVED');
    expect(archived?.activatedAt).toBeNull();
    expect(archived?.rolloutPercent).toBe(0);
    expect(archived?.systemPrompt).toBe(prompt.system_prompt);
    expect(archived?.id).not.toBe(promptVersion.id);
  });

  /**
   * The frozen template cannot be edited (docs/spec is a contract), so 1.1.0 is a copy with
   * exactly one sentence changed — and this is what stops it drifting into a rewrite. Everything
   * that follows the language sentence, and the output schema OpenAI's strict mode depends on,
   * must stay byte-identical to 1.0.0.
   */
  it('keeps 1.1.0 verbatim to the frozen 1.0.0 except for the language sentence', () => {
    const { prompt, currentPrompt } = loadSpecDocuments();
    const OLD = 'Produce one editable English draft for a real customer.';
    const NEW =
      'Produce one editable draft for a real customer, written in the language named by DRAFT_LANGUAGE in the user message and following its LANGUAGE_RULES.';

    expect(prompt.system_prompt).toContain(OLD);
    expect(currentPrompt.system_prompt).toBe(prompt.system_prompt.replace(OLD, NEW));
    expect(currentPrompt.output_schema).toEqual(prompt.output_schema);
    expect(currentPrompt.default_model).toBe(prompt.default_model);
    expect(currentPrompt.reasoning_effort).toBe(prompt.reasoning_effort);
  });

  /** CHANGE-004: the rules travel on the version row, and the current template carries them. */
  it('seeds 1.1.0 with the default writing rules as data', () => {
    const { promptVersion, archivedPromptVersions } = planFromSpec().plan;
    expect(promptVersion.guidance).toEqual(DEFAULT_GUIDANCE);
    // The frozen 1.0.0 has no guidance of its own; it is filled with the defaults on the way in.
    expect(archivedPromptVersions[0]?.guidance).toEqual(DEFAULT_GUIDANCE);
  });

  it('seeds the demo tenant as Hinglish (CHANGE-003)', () => {
    expect(planFromSpec().plan.aiContext.draftLanguage).toBe('hinglish');
  });

  it('carries the AI business context through as unranked hints', () => {
    const { aiContext } = planFromSpec().plan;

    expect(aiContext.services).toEqual(['Dosa', 'Idli', 'Filter Coffee']);
    expect(aiContext.contextTerms).toEqual(['South Indian food', 'Udaipur']);
  });
});

describe('QR sources and contacts', () => {
  it('seeds one QR per source label with an opaque code', () => {
    const qrs = planFromSpec().plan.qrCodes;

    expect(qrs.map((qr) => qr.sourceLabel)).toEqual(['Reception', 'Billing Counter']);
    expect(qrs.map((qr) => qr.code)).toEqual(['SEEDQR1', 'SEEDQR2']);
    expect(qrs.every((qr) => qr.status === 'ACTIVE')).toBe(true);
  });

  /** QR-01-01: the id is keyed on the source label, so a re-run cannot re-issue a new code. */
  it('keys a QR row on its source label rather than its code', () => {
    const first = planFromSpec({ newQrCode: () => 'AAAAAAAAAA' }).plan.qrCodes;
    const second = planFromSpec({ newQrCode: () => 'BBBBBBBBBB' }).plan.qrCodes;

    expect(second.map((qr) => qr.id)).toEqual(first.map((qr) => qr.id));
    expect(second.map((qr) => qr.code)).not.toEqual(first.map((qr) => qr.code));
  });

  it('normalizes contact mobiles and preserves their request status', () => {
    const contacts = planFromSpec().plan.contacts;

    expect(contacts.map((contact) => contact.mobile)).toEqual(['+919800000001', '+919800000002']);
    expect(contacts.map((contact) => contact.status)).toEqual([
      'NOT_CONTACTED',
      'MESSAGE_SENT_MANUAL',
    ]);
  });

  it('refuses a contact mobile that is not a usable Indian number', () => {
    const seed = specDocument();
    seed.customers = [
      { name: 'Demo Customer C', mobile: '+911234567890', status: 'NOT_CONTACTED' },
    ];

    expect(() => planFromSpec({ seed })).toThrow(/unusable mobile/);
  });
});

/**
 * D-009 and AC-006: there is no star rating anywhere before Google, so nothing the customer
 * can read on the seeded profile may imply one. The scan is limited to tenant-visible copy —
 * the system prompt legitimately contains "Do not imply 5 stars", which is the rule, not a
 * violation of it.
 */
describe('compliance', () => {
  it('seeds no rating language into anything a customer sees', () => {
    const { plan } = planFromSpec();

    const customerVisible = [
      plan.business.name,
      plan.business.category,
      plan.business.description ?? '',
      plan.reviewDestination.label,
      ...plan.links.map((link) => link.label),
      ...plan.modes.map((mode) => mode.name),
    ];

    for (const copy of customerVisible) {
      expect(copy).not.toMatch(/\bstars?\b|\brating\b|\brate us\b/i);
    }
  });
});
