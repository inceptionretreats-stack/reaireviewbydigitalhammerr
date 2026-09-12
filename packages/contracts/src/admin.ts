import { z } from 'zod';

/**
 * ADMIN-02 / ADMIN-04 request shapes.
 *
 * Every mutation carries a `reason`, required at the contract as well as by the audit writer:
 * RBAC rule 5 says high-risk admin actions require one, and a request that could omit it would
 * only fail later, after the operator had typed everything else.
 */

const reason = z
  .string()
  .trim()
  .min(3, 'Give a reason — it is written to the audit log.')
  .max(1000);

export const adminBusinessAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('activate_pro'),
    reason,
    /** Whole months; one year by default. */
    months: z.number().int().min(1).max(60).default(12),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('revoke_pro'), reason }),
  z.object({
    action: z.literal('adjust_free_quota'),
    reason,
    free_generation_limit: z.number().int().min(0).max(100_000),
  }),
  z.object({ action: z.literal('reset_free_usage'), reason }),
  z.object({ action: z.literal('suspend'), reason }),
  z.object({ action: z.literal('reactivate'), reason }),
]);
export type AdminBusinessAction = z.infer<typeof adminBusinessAction>;

export const adminBusinessListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  plan: z.enum(['free', 'pro']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
  /** Paid periods ending within 30 days. */
  expiring: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type AdminBusinessListQuery = z.infer<typeof adminBusinessListQuery>;

export const adminSettingsPatch = z.object({
  reason,
  free_generation_limit: z.number().int().min(0).max(100_000).optional(),
  annual_price_paise: z.number().int().min(100).max(10_000_000).optional(),
  pro_generation_limit: z.number().int().min(1).max(1_000_000).optional(),
  fair_use_monthly_soft_limit: z.number().int().min(1).max(1_000_000).nullable().optional(),
});
export type AdminSettingsPatch = z.infer<typeof adminSettingsPatch>;

/** ADMIN-03. One rule per line in the UI; the API carries them as string arrays. */
const ruleLines = z.array(z.string().trim().max(600)).max(40);

export const promptGuidanceInput = z.object({
  language_rules: z.object({ en: ruleLines, hinglish: ruleLines }),
  claim_rules: ruleLines,
  emoji_rules: ruleLines,
  opening_hints: ruleLines.min(1, 'At least one opening angle.'),
  emoji_placements: ruleLines.min(1, 'At least one placement.'),
});

export const promptVersionDraftInput = z.object({
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Use a version like 1.2.0.'),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,80}$/, 'A plain model id, like gemini-3.5-flash-lite.'),
  reasoning_effort: z.string().trim().max(20),
  max_output_tokens: z.number().int().min(64).max(4096),
  system_prompt: z.string().trim().min(40).max(20_000),
  guidance: promptGuidanceInput,
});
export type PromptVersionDraftInput = z.infer<typeof promptVersionDraftInput>;

/** Create: optionally cloned from another version, with any field overridden. */
export const promptVersionCreate = promptVersionDraftInput.partial().extend({
  clone_from: z.string().uuid().optional(),
  version: promptVersionDraftInput.shape.version,
});

export const promptVersionAction = z.object({ reason });
